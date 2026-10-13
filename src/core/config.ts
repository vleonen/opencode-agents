import fs from "node:fs"
import path from "node:path"

import type { Scope } from "./paths"
import { isRecord, nonEmptyString } from "./util"

export const ROLES = ["designer", "qa", "reviewer"] as const
export type Role = (typeof ROLES)[number]

export const CONFIG_VERSION = 1

export type PermissionEffect = "allow" | "ask" | "deny"

/** Where the fallback twin may run: `subagent` (not selectable, still launchable) or `all`. */
export type TwinMode = "subagent" | "all"

/** Extra permission rules appended to an agent's template; last match wins. */
export interface PermissionRule {
  action: string
  resource: string
  effect: PermissionEffect
}

export interface AgentChoice {
  /** Model for the primary agent, `provider/model` (optional `#variant`). */
  model: string
  /** Model for the fallback twin. */
  fallback: string
  /** Project/user rules rendered into the template's override slot (never overwritten by upgrades). */
  permissions: PermissionRule[]
  /** Mode for the fallback twin. Default `subagent`: excluded from the agent selector, still launchable. */
  twinMode: TwinMode
  /** Hide the fallback twin from listings (`hidden: true`). Default false. */
  twinHidden: boolean
}

export interface AgentsConfig {
  version: number
  scope: Scope
  agents: Record<Role, AgentChoice>
}

const PERMISSION_EFFECTS = new Set<PermissionEffect>(["allow", "ask", "deny"])

/** Defensive parse: keep well-formed rules, drop the rest. */
function parsePermissions(raw: unknown): PermissionRule[] {
  if (!Array.isArray(raw)) return []
  const out: PermissionRule[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const action = nonEmptyString(item.action)
    const resource = typeof item.resource === "string" ? item.resource : undefined
    const effect = item.effect
    if (!action || resource === undefined || typeof effect !== "string") continue
    if (!PERMISSION_EFFECTS.has(effect as PermissionEffect)) continue
    out.push({ action, resource, effect: effect as PermissionEffect })
  }
  return out
}

/** Built-in recommendations, keyed off the primary provider (z.ai) and a different-provider twin. */
export function defaultChoices(): Record<Role, AgentChoice> {
  const twin = { twinMode: "subagent" as const, twinHidden: false }
  return {
    designer: { model: "zai-coding-plan/glm-5.3", fallback: "deepseek/deepseek-v4-pro", permissions: [], ...twin },
    reviewer: { model: "zai-coding-plan/glm-5.3", fallback: "deepseek/deepseek-v4-pro", permissions: [], ...twin },
    qa: { model: "zai-coding-plan/glm-5.3-flash", fallback: "deepseek/deepseek-flash", permissions: [], ...twin },
  }
}

export function defaultConfig(scope: Scope): AgentsConfig {
  return { version: CONFIG_VERSION, scope, agents: defaultChoices() }
}

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v)
}

/** Structural, defensive parse. Returns null when the shape is unusable. */
export function parseConfig(data: unknown): AgentsConfig | null {
  if (!isRecord(data)) return null
  const scope: Scope | null = data.scope === "project" ? "project" : data.scope === "global" ? "global" : null
  if (!scope) return null
  const agentsRaw = isRecord(data.agents) ? data.agents : {}
  const agents = {} as Record<Role, AgentChoice>
  for (const role of ROLES) {
    const raw = isRecord(agentsRaw[role]) ? (agentsRaw[role] as Record<string, unknown>) : {}
    const model = nonEmptyString(raw.model)
    const fallback = nonEmptyString(raw.fallback)
    if (!model || !fallback) return null
    const twinMode: TwinMode = raw.twinMode === "all" ? "all" : "subagent"
    const twinHidden = raw.twinHidden === true
    agents[role] = { model, fallback, permissions: parsePermissions(raw.permissions), twinMode, twinHidden }
  }
  const version = typeof data.version === "number" && Number.isFinite(data.version) ? data.version : CONFIG_VERSION
  return { version, scope, agents }
}

export function readConfig(configPath: string): AgentsConfig | null {
  try {
    return parseConfig(JSON.parse(fs.readFileSync(configPath, "utf8")))
  } catch {
    return null
  }
}

export function writeConfig(configPath: string, config: AgentsConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

function providerOf(ref: string): string {
  const i = ref.indexOf("/")
  return i < 0 ? ref : ref.slice(0, i)
}

/**
 * Non-fatal configuration warnings. The fallback twin is only useful when it
 * runs on a different provider than the primary, so flag a twin that does not.
 */
export function configWarnings(config: AgentsConfig): string[] {
  const out: string[] = []
  for (const role of ROLES) {
    const { model, fallback } = config.agents[role]
    if (model === fallback) {
      out.push(`${role}: fallback equals model (${model}) — the twin will hit the same limits`)
    } else if (providerOf(model) === providerOf(fallback)) {
      out.push(
        `${role}: model and fallback share provider "${providerOf(model)}" — a provider-wide limit would fail both`,
      )
    }
    if (config.agents[role].twinHidden) {
      out.push(
        `${role}: twinHidden is set — OpenCode may drop a hidden agent from the subagent catalog, breaking the fallback; prefer twinMode: "subagent"`,
      )
    }
  }
  return out
}
