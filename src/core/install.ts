import fs from "node:fs"
import path from "node:path"

import { ROLES, type AgentsConfig } from "./config"
import { mergePolicyFile, POLICY_BEGIN, stripPolicyFile } from "./docs"
import { MANIFEST_NAME, readManifest, removeManifest, sha256, writeManifest } from "./manifest"
import type { Env, Targets } from "./paths"
import { resolveTargets } from "./paths"
import { renderPolicy, renderTemplates } from "./templates"

export type FileActionKind = "created" | "updated" | "unchanged" | "skipped" | "removed" | "kept" | "orphaned"

export interface FileAction {
  fileName: string
  action: FileActionKind
  reason?: string
}

export interface InstallOptions {
  config: AgentsConfig
  projectDir?: string
  env?: Env
  homedir?: string
  /** Overwrite files we do not own. */
  force?: boolean
  /** Take ownership of an existing unowned file when its content already matches. */
  adopt?: boolean
  /** Merge the AGENTS.md policy block (default true). */
  writePolicy?: boolean
  /** Override the policy text (defaults to the bundled AGENTS.agents.md). */
  policyText?: string
}

export interface InstallReport {
  targets: Targets
  files: FileAction[]
  policy: "created" | "updated" | "unchanged" | "removed" | "noop"
  /** Owned `-fallback.md` twins whose role no longer has a fallback (left in place). */
  orphaned: string[]
}

function orphanedTwins(config: AgentsConfig, agentDir: string): string[] {
  return ROLES.filter((role) => config.agents[role].fallback === undefined)
    .map((role) => `${role}-fallback.md`)
    .filter((file) => fs.existsSync(path.join(agentDir, file)))
}

function resolve(opts: { config: AgentsConfig; projectDir?: string; env?: Env; homedir?: string }): Targets {
  return resolveTargets({
    scope: opts.config.scope,
    ...(opts.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.homedir !== undefined ? { homedir: opts.homedir } : {}),
  })
}

export function install(opts: InstallOptions): InstallReport {
  const targets = resolve(opts)
  const manifest = readManifest(targets.agentDir)
  const rendered = renderTemplates(opts.config)
  const files: FileAction[] = []
  // Create the agent dir lazily, so an all-skipped run leaves no stray directory.
  let dirReady = false
  const ensureDir = (): void => {
    if (!dirReady) {
      fs.mkdirSync(targets.agentDir, { recursive: true })
      dirReady = true
    }
  }

  for (const r of rendered) {
    const target = path.join(targets.agentDir, r.fileName)
    const newHash = sha256(r.content)
    const exists = fs.existsSync(target)
    const owned = manifest.files[r.fileName] !== undefined

    if (!exists) {
      ensureDir()
      fs.writeFileSync(target, r.content)
      manifest.files[r.fileName] = newHash
      files.push({ fileName: r.fileName, action: "created" })
      continue
    }

    const existing = fs.readFileSync(target, "utf8")
    const same = sha256(existing) === newHash

    if (owned) {
      if (same) {
        files.push({ fileName: r.fileName, action: "unchanged" })
      } else {
        ensureDir()
      fs.writeFileSync(target, r.content)
        files.push({ fileName: r.fileName, action: "updated" })
      }
      manifest.files[r.fileName] = newHash
      continue
    }

    if (same && opts.adopt) {
      manifest.files[r.fileName] = newHash
      files.push({ fileName: r.fileName, action: "unchanged", reason: "adopted existing identical file" })
      continue
    }

    if (opts.force) {
      ensureDir()
      fs.writeFileSync(target, r.content)
      manifest.files[r.fileName] = newHash
      files.push({ fileName: r.fileName, action: "updated", reason: "overwrote unowned file (--force)" })
      continue
    }

    files.push({
      fileName: r.fileName,
      action: "skipped",
      reason: "existing file is not owned by opencode-agents; use --force to overwrite or --adopt to take over an identical file",
    })
  }

  writeManifest(targets.agentDir, manifest)

  let policy: InstallReport["policy"] = "noop"
  if (opts.writePolicy !== false) {
    const text = opts.policyText ?? renderPolicy(opts.config)
    if (text.trim() === "") {
      // No role has a fallback: remove any previously written policy block.
      policy = stripPolicyFile(targets.agentsMdPath) ? "removed" : "noop"
    } else {
      policy = mergePolicyFile(targets.agentsMdPath, text)
    }
  }

  return { targets, files, policy, orphaned: orphanedTwins(opts.config, targets.agentDir) }
}

export interface UninstallOptions {
  config: AgentsConfig
  projectDir?: string
  env?: Env
  homedir?: string
  /** Remove the AGENTS.md policy block (default true). */
  removePolicy?: boolean
  /** Remove the opencode-agents.json config (default true). */
  removeConfig?: boolean
}

export interface UninstallReport {
  targets: Targets
  files: FileAction[]
  policy: "removed" | "noop"
  config: "removed" | "kept" | "absent"
}

export function uninstall(opts: UninstallOptions): UninstallReport {
  const targets = resolve(opts)
  const manifest = readManifest(targets.agentDir)
  const files: FileAction[] = []

  for (const [fileName, recordedHash] of Object.entries(manifest.files)) {
    const target = path.join(targets.agentDir, fileName)
    if (!fs.existsSync(target)) {
      files.push({ fileName, action: "kept", reason: "already absent" })
      continue
    }
    if (sha256(fs.readFileSync(target, "utf8")) === recordedHash) {
      fs.rmSync(target)
      files.push({ fileName, action: "removed" })
    } else {
      files.push({ fileName, action: "kept", reason: "modified since install" })
    }
  }
  removeManifest(targets.agentDir)

  const policy = opts.removePolicy !== false && stripPolicyFile(targets.agentsMdPath) ? "removed" : "noop"

  let config: UninstallReport["config"] = "absent"
  if (fs.existsSync(targets.configPath)) {
    if (opts.removeConfig === false) {
      config = "kept"
    } else {
      fs.rmSync(targets.configPath)
      config = "removed"
    }
  }

  return { targets, files, policy, config }
}

export interface InspectEntry {
  fileName: string
  target: string
  exists: boolean
  owned: boolean
  action: FileActionKind
}

export interface InspectReport {
  targets: Targets
  entries: InspectEntry[]
  manifestPresent: boolean
  policyPresent: boolean
  /** Owned `-fallback.md` twins whose role no longer has a fallback (left in place). */
  orphaned: string[]
}

/** Dry run: report what install would do without touching the filesystem. */
export function inspect(opts: InstallOptions): InspectReport {
  const targets = resolve(opts)
  const manifest = readManifest(targets.agentDir)
  const rendered = renderTemplates(opts.config)

  const entries: InspectEntry[] = rendered.map((r) => {
    const target = path.join(targets.agentDir, r.fileName)
    const exists = fs.existsSync(target)
    const owned = manifest.files[r.fileName] !== undefined
    const same = exists && sha256(fs.readFileSync(target, "utf8")) === sha256(r.content)
    let action: FileActionKind
    if (!exists) action = "created"
    else if (owned) action = same ? "unchanged" : "updated"
    else if (same && opts.adopt) action = "unchanged"
    else if (opts.force) action = "updated"
    else action = "skipped"
    return { fileName: r.fileName, target, exists, owned, action }
  })

  const policyPresent =
    fs.existsSync(targets.agentsMdPath) && fs.readFileSync(targets.agentsMdPath, "utf8").includes(POLICY_BEGIN)

  return {
    targets,
    entries,
    manifestPresent: fs.existsSync(path.join(targets.agentDir, MANIFEST_NAME)),
    policyPresent,
    orphaned: orphanedTwins(opts.config, targets.agentDir),
  }
}
