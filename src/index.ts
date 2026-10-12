/**
 * opencode-agents — server plugin.
 *
 * On load it reads `opencode-agents.json` (project first, then global) and
 * installs/heals the bundled subagents + fallback twins and the AGENTS.md
 * policy block. It never prompts and never uninstalls.
 *
 * Contract (probe-verified in opencode-quotas / opencode-session-tags):
 * - opencode 2.x calls `setup(ctx)`.
 * - opencode 1.x calls `server(input, options)`.
 * - opencode 1.18.x's internal v2-config loader calls `setup(input)` with a
 *   V1-shaped input — `isV2Context` detects that and routes to the V1 shell.
 * - The default export is a plain object; every other runtime export must stay
 *   a function or type-only, because the 1.x loader aborts otherwise.
 *
 * There are NO runtime imports from `@opencode/plugin`: opencode cannot resolve
 * it from bare directory plugins. Types are structural on purpose.
 */
import { type AgentsConfig, ROLES, configWarnings } from "./core/config"
import { findExistingConfig } from "./core/discover"
import { type FileAction, install } from "./core/install"

type Level = "info" | "warn" | "error"

function log(level: Level, message: string, extra?: unknown): void {
  try {
    console[level === "info" ? "log" : level](`[opencode-agents] ${message}`, extra ?? "")
  } catch {
    /* logging must never throw */
  }
}

/* ------------------------------------------------------------------------------------------------
 * Structural context types (only the fields this plugin reads)
 * ---------------------------------------------------------------------------------------------- */

export interface AgentsPluginOptions {
  /** Skip any install/heal work. */
  disabled?: boolean
}

interface V2ModelRef {
  providerID?: string
  id?: string
}

/** `ctx.model.list()` returns the client API envelope, not a bare array. */
interface V2ModelListOutput {
  data?: readonly V2ModelRef[]
}

/** The subset of the real v2 `Plugin.Context` this plugin uses. */
export interface AgentsV2Context {
  options?: unknown
  location?: { directory?: string; project?: { directory?: string; id?: string } }
  model?: { list?: () => Promise<V2ModelListOutput> }
}

interface V1Input {
  directory?: string
  options?: unknown
}

/* ------------------------------------------------------------------------------------------------
 * Options
 * ---------------------------------------------------------------------------------------------- */

function parseEnvOptions(): AgentsPluginOptions | undefined {
  // opencode 2.0.16 delivers ctx.options = {} to directory-discovered plugins,
  // so env + a config file are the reliable channels.
  const disabledEnv = process.env.OPENCODE_AGENTS_DISABLE
  const raw = process.env.OPENCODE_AGENTS_OPTIONS
  let parsed: AgentsPluginOptions | undefined
  if (raw && raw.trim() !== "") {
    try {
      const v = JSON.parse(raw) as unknown
      if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as AgentsPluginOptions
      else log("warn", "OPENCODE_AGENTS_OPTIONS must be a JSON object; ignoring")
    } catch {
      log("warn", "OPENCODE_AGENTS_OPTIONS is not valid JSON; ignoring")
    }
  }
  const fromEnvBool = disabledEnv ? !["0", "false", "off", "no"].includes(disabledEnv.toLowerCase()) : undefined
  if (parsed === undefined && fromEnvBool === undefined) return undefined
  return { ...parsed, ...(fromEnvBool !== undefined ? { disabled: fromEnvBool } : {}) }
}

function mergeOptions(...sources: Array<AgentsPluginOptions | undefined>): AgentsPluginOptions {
  const out: AgentsPluginOptions = {}
  for (const s of sources) {
    if (!s || typeof s !== "object") continue
    if (s.disabled !== undefined) out.disabled = s.disabled
  }
  return out
}

/* ------------------------------------------------------------------------------------------------
 * Heal: install/update from an existing config
 * ---------------------------------------------------------------------------------------------- */

function summarizeReport(files: FileAction[], policy: string): string {
  const counts = new Map<string, number>()
  for (const f of files) counts.set(f.action, (counts.get(f.action) ?? 0) + 1)
  const parts = [...counts.entries()].map(([k, v]) => `${v} ${k}`)
  return `${parts.join(", ")}; policy ${policy}`
}

async function warnUnavailable(ctx: AgentsV2Context, config: AgentsConfig): Promise<void> {
  const list = ctx.model?.list
  if (typeof list !== "function") return
  try {
    const output = await list()
    const models = output?.data ?? []
    const available = new Set(models.map((m) => `${m.providerID}/${m.id}`))
    if (available.size === 0) return
    for (const role of ROLES) {
      const choice = config.agents[role]
      const fields: Array<[string, string]> = [
        ["model", choice.model],
        ["fallback", choice.fallback],
      ]
      for (const [field, model] of fields) {
        const base = model.split("#")[0] ?? model
        if (!available.has(base)) {
          log("warn", `configured ${role}.${field} "${model}" is not currently available`)
        }
      }
    }
  } catch {
    /* model availability is best-effort */
  }
}

async function heal(projectDir: string | undefined, ctx?: AgentsV2Context): Promise<void> {
  const found = findExistingConfig(projectDir !== undefined ? { projectDir } : {})
  if (!found) {
    log("info", "no opencode-agents.json found — run `opencode-agents init` to install the bundled agents")
    return
  }
  for (const warning of configWarnings(found.config)) log("warn", warning)
  const report = install({
    config: found.config,
    ...(projectDir !== undefined ? { projectDir } : {}),
    force: false,
    writePolicy: true,
  })
  const changed = report.files.some((f) => f.action !== "unchanged") || report.policy !== "unchanged"
  if (changed) log("info", `installed from ${found.path}: ${summarizeReport(report.files, report.policy)}`)
  if (ctx) await warnUnavailable(ctx, found.config)
}

/* ------------------------------------------------------------------------------------------------
 * Shells
 * ---------------------------------------------------------------------------------------------- */

/** True only for a genuine opencode 2.x context (V1 input carries `client`, not `location`). */
function isV2Context(input: unknown): boolean {
  if (input === null || typeof input !== "object") return false
  const c = input as Record<string, unknown>
  if ("client" in c) return false
  const loc = c.location
  return loc !== null && typeof loc === "object" && typeof (loc as { directory?: unknown }).directory === "string"
}

async function setupV2(input: unknown): Promise<() => void> {
  const ctx = input as AgentsV2Context
  const opts = mergeOptions(ctx.options as AgentsPluginOptions | undefined, parseEnvOptions())
  if (opts.disabled) return () => {}
  try {
    await heal(ctx.location?.directory, ctx)
  } catch (err) {
    log("error", "install failed", err instanceof Error ? err.message : err)
  }
  return () => {}
}

async function serverV1(input: unknown, options?: unknown): Promise<Record<string, never>> {
  const opts = mergeOptions(options as AgentsPluginOptions | undefined, parseEnvOptions())
  if (opts.disabled) return {}
  const projectDir = input && typeof input === "object" ? (input as V1Input).directory : undefined
  try {
    await heal(projectDir)
  } catch (err) {
    log("error", "install failed", err instanceof Error ? err.message : err)
  }
  return {}
}

export default {
  id: "opencode-agents",
  setup: async (input: unknown): Promise<() => void> => {
    if (isV2Context(input)) return setupV2(input)
    // opencode 1.18.x internal v2-config loader: V1-shaped input -> V1 shell.
    await serverV1(input, (input as V1Input | undefined)?.options)
    return () => {}
  },
  server: serverV1,
}
