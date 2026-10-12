#!/usr/bin/env node
/**
 * opencode-agents CLI — install the bundled subagents + fallback twins.
 *
 * Usage:
 *   opencode-agents init [options]        install (default command)
 *   opencode-agents inspect [options]     dry-run: show what init would do
 *   opencode-agents uninstall [options]   remove owned files + policy block
 *
 * Options:
 *   --scope global|project    install target (default: global)
 *   --dir <path>              project directory for --scope project (default: cwd)
 *   --set <agent>[.<field>]=<model>
 *                             set a model; field is `model`/`primary` (default) or `fallback`
 *                             e.g. --set designer=zai-coding-plan/glm-5.3
 *                                  --set designer.fallback=deepseek/deepseek-v4-pro
 *   --config <file>           base JSON config to start from
 *   --yes, -y                 accept defaults without prompting
 *   --non-interactive         never prompt (same as --yes)
 *   --force                   overwrite files not owned by opencode-agents
 *   --adopt                   take ownership of existing files whose content already matches
 *   --no-policy               do not merge the AGENTS.md policy block
 *   --keep-config             on uninstall, keep opencode-agents.json
 *   --help, -h
 */
import { execFileSync } from "node:child_process"
import readline from "node:readline/promises"
import process from "node:process"

import {
  type AgentsConfig,
  type Role,
  ROLES,
  configWarnings,
  defaultConfig,
  isRole,
  readConfig,
  writeConfig,
} from "../src/core/config"
import { findExistingConfig } from "../src/core/discover"
import { type FileAction, type InstallOptions, install, inspect, uninstall } from "../src/core/install"
import { type Scope, type Targets, resolveTargets } from "../src/core/paths"

type Command = "init" | "inspect" | "uninstall" | "help"

interface Args {
  command: Command
  scope?: Scope
  dir?: string
  sets: string[]
  configFile?: string
  nonInteractive: boolean
  force: boolean
  adopt: boolean
  writePolicy: boolean
  keepConfig: boolean
}

function usage(): string {
  return [
    "opencode-agents — install reusable subagents (designer, qa, reviewer) + fallback twins",
    "",
    "Usage:",
    "  opencode-agents init [options]        install (default)",
    "  opencode-agents inspect [options]     dry-run",
    "  opencode-agents uninstall [options]   remove owned files + policy block",
    "",
    "Options:",
    "  --scope global|project    install target (default: global)",
    "  --dir <path>              project directory for --scope project (default: cwd)",
    "  --set <agent>[.<field>]=<model>   field: model|primary (default) or fallback",
    "  --config <file>           base JSON config",
    "  --yes, -y                 accept defaults, no prompts",
    "  --non-interactive         never prompt",
    "  --force                   overwrite files not owned by opencode-agents",
    "  --adopt                   take ownership of identical existing files",
    "  --no-policy               skip the AGENTS.md policy block",
    "  --keep-config             on uninstall, keep opencode-agents.json",
    "  --help, -h                show this help",
    "",
    "Examples:",
    "  opencode-agents init",
    "  opencode-agents init --scope project --dir .",
    "  opencode-agents init --yes --set qa.fallback=deepseek/deepseek-flash",
  ].join("\n")
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "init",
    sets: [],
    nonInteractive: false,
    force: false,
    adopt: false,
    writePolicy: true,
    keepConfig: false,
  }
  const rest = [...argv]
  const first = rest[0]
  if (first === "init" || first === "inspect" || first === "uninstall") {
    args.command = first
    rest.shift()
  } else if (first === "help" || first === "--help" || first === "-h") {
    args.command = "help"
    return args
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    switch (a) {
      case "--help":
      case "-h":
        args.command = "help"
        return args
      case "--scope": {
        const v = rest[++i]
        if (v !== "global" && v !== "project") throw new Error(`--scope must be global or project (got ${v ?? "nothing"})`)
        args.scope = v
        break
      }
      case "--dir":
        args.dir = rest[++i] ?? ""
        break
      case "--set":
        args.sets.push(rest[++i] ?? "")
        break
      case "--config":
        args.configFile = rest[++i] ?? ""
        break
      case "--yes":
      case "-y":
        args.nonInteractive = true
        break
      case "--non-interactive":
        args.nonInteractive = true
        break
      case "--force":
        args.force = true
        break
      case "--adopt":
        args.adopt = true
        break
      case "--no-policy":
        args.writePolicy = false
        break
      case "--keep-config":
        args.keepConfig = true
        break
      default:
        throw new Error(`unknown argument: ${a}`)
    }
  }
  return args
}

function applySet(config: AgentsConfig, expr: string): void {
  const eq = expr.indexOf("=")
  if (eq < 0) throw new Error(`--set expects <agent>[.<field>]=<model> (got "${expr}")`)
  const key = expr.slice(0, eq).trim()
  const value = expr.slice(eq + 1).trim()
  if (value === "") throw new Error(`--set has an empty model (got "${expr}")`)
  const parts = key.split(".")
  if (parts.length > 2) throw new Error(`--set key has too many segments (expected <agent> or <agent>.<field>): ${key}`)
  const [rolePart, fieldPart] = parts
  if (!rolePart || !isRole(rolePart)) throw new Error(`--set references an unknown agent: ${key}`)
  const role: Role = rolePart
  const field = fieldPart ?? "model"
  if (field === "model" || field === "primary") config.agents[role].model = value
  else if (field === "fallback") config.agents[role].fallback = value
  else throw new Error(`--set field must be model|primary|fallback (got "${field}")`)
}

/** Registered models from the running opencode, as `provider/model`. */
function listModels(): string[] {
  try {
    const out = execFileSync("opencode", ["models"], { encoding: "utf8", timeout: 20_000 })
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.includes("/"))
  } catch {
    return []
  }
}

function groupByProvider(models: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const m of models) {
    const provider = m.slice(0, m.indexOf("/"))
    const list = groups.get(provider) ?? []
    list.push(m)
    groups.set(provider, list)
  }
  return groups
}

function printModels(models: string[]): void {
  const groups = groupByProvider(models)
  let i = 0
  for (const [provider, list] of groups) {
    process.stdout.write(`  ${provider}\n`)
    for (const m of list) process.stdout.write(`    ${String(++i).padStart(3)}  ${m}\n`)
  }
}

async function pick(
  rl: readline.Interface,
  label: string,
  models: string[],
  current: string,
): Promise<string> {
  for (;;) {
    const ans = (await rl.question(`${label} [${current}]: `)).trim()
    if (ans === "") return current
    if (/^\d+$/.test(ans)) {
      const idx = Number(ans)
      if (models.length > 0 && idx >= 1 && idx <= models.length) return models[idx - 1] as string
      process.stdout.write(`  ! enter a number between 1 and ${models.length}\n`)
      continue
    }
    if (ans.includes("/")) return ans
    process.stdout.write("  ! enter a list number, a provider/model, or blank to keep the default\n")
  }
}

async function promptModels(config: AgentsConfig): Promise<void> {
  const models = listModels()
  if (models.length === 0) {
    process.stdout.write("! `opencode models` returned nothing — using defaults (edit opencode-agents.json later).\n\n")
    return
  }
  process.stdout.write("\nAvailable models:\n")
  printModels(models)
  process.stdout.write("\nPress Enter to accept the default in brackets.\n\n")

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (const role of ROLES) {
      const choice = config.agents[role]
      choice.model = await pick(rl, `${role} model`, models, choice.model)
      choice.fallback = await pick(rl, `${role} fallback`, models, choice.fallback)
    }
  } finally {
    rl.close()
  }
  process.stdout.write("\n")
}

function printReport(title: string, targets: Targets, files: FileAction[], policy: string): void {
  process.stdout.write(`${title} — scope ${targets.scope}\n`)
  process.stdout.write(`  agents dir : ${targets.agentDir}\n`)
  process.stdout.write(`  AGENTS.md  : ${targets.agentsMdPath}\n`)
  process.stdout.write(`  config     : ${targets.configPath}\n\n`)
  for (const f of files) {
    const extra = f.reason ? `  (${f.reason})` : ""
    process.stdout.write(`  ${f.action.padEnd(9)} ${f.fileName}${extra}\n`)
  }
  process.stdout.write(`  policy: ${policy}\n`)
}

function printInspectReport(report: ReturnType<typeof inspect>): void {
  process.stdout.write(`Inspect — scope ${report.targets.scope}\n`)
  process.stdout.write(`  agents dir : ${report.targets.agentDir}\n`)
  process.stdout.write(`  AGENTS.md  : ${report.targets.agentsMdPath}\n`)
  process.stdout.write(`  config     : ${report.targets.configPath}\n\n`)
  for (const e of report.entries) {
    process.stdout.write(
      `  ${e.action.padEnd(9)} ${e.fileName}  (exists=${e.exists} owned=${e.owned})\n`,
    )
  }
  process.stdout.write(`  policy block present: ${report.policyPresent}\n`)
}

async function run(): Promise<number> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n\n${usage()}\n`)
    return 2
  }

  if (args.command === "help") {
    process.stdout.write(`${usage()}\n`)
    return 0
  }

  const projectDir = args.dir && args.dir.trim() !== "" ? args.dir : process.cwd()

  // Build the base config: an explicit file, else any existing config (so a
  // re-run keeps the user's model choices), else built-in defaults.
  let config: AgentsConfig
  if (args.configFile) {
    const loaded = readConfig(args.configFile)
    if (!loaded) {
      process.stderr.write(`error: could not read a valid config from ${args.configFile}\n`)
      return 2
    }
    config = loaded
  } else {
    const found = findExistingConfig({ projectDir })
    config = found ? found.config : defaultConfig(args.scope ?? "global")
  }
  // The effective scope: --scope wins, else the existing config's, else global.
  // Everything (targets, projectDir, config write) uses this single value.
  const scope: Scope = args.scope ?? config.scope
  config.scope = scope
  const projectDirOpt = scope === "project" ? { projectDir } : {}
  const targets = resolveTargets({ scope, ...projectDirOpt })

  for (const set of args.sets) {
    try {
      applySet(config, set)
    } catch (err) {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
      return 2
    }
  }

  for (const warning of configWarnings(config)) process.stderr.write(`warning: ${warning}\n`)

  const installOpts: InstallOptions = {
    config,
    ...projectDirOpt,
    force: args.force,
    adopt: args.adopt,
    writePolicy: args.writePolicy,
  }

  if (args.command === "uninstall") {
    const report = uninstall({ ...installOpts, removeConfig: !args.keepConfig })
    printReport("Uninstall", report.targets, report.files, report.policy)
    process.stdout.write(`  config: ${report.config}\n`)
    return 0
  }

  if (args.command === "inspect") {
    printInspectReport(inspect(installOpts))
    return 0
  }

  // init
  const interactive = !args.nonInteractive && process.stdin.isTTY === true
  if (interactive) await promptModels(config)

  const report = install(installOpts)
  // Persist the config only after the install succeeded.
  writeConfig(targets.configPath, config)
  printReport("Install", report.targets, report.files, report.policy)
  process.stdout.write(
    "\nVerify:  opencode debug agents | grep -E 'designer|qa|reviewer'\n",
  )
  return 0
}

run()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
