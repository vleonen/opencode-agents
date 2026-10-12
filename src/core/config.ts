import fs from "node:fs"
import path from "node:path"

import type { Scope } from "./paths"
import { isRecord, nonEmptyString } from "./util"

export const ROLES = ["designer", "qa", "reviewer"] as const
export type Role = (typeof ROLES)[number]

export const CONFIG_VERSION = 1

export interface AgentChoice {
  /** Model for the primary agent, `provider/model` (optional `#variant`). */
  model: string
  /** Model for the fallback twin. */
  fallback: string
}

export interface AgentsConfig {
  version: number
  scope: Scope
  agents: Record<Role, AgentChoice>
}

/** Built-in recommendations, keyed off the primary provider (z.ai) and a different-provider twin. */
export function defaultChoices(): Record<Role, AgentChoice> {
  return {
    designer: { model: "zai-coding-plan/glm-5.3", fallback: "deepseek/deepseek-v4-pro" },
    reviewer: { model: "zai-coding-plan/glm-5.3", fallback: "deepseek/deepseek-v4-pro" },
    qa: { model: "zai-coding-plan/glm-5.3-flash", fallback: "deepseek/deepseek-flash" },
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
    agents[role] = { model, fallback }
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
  }
  return out
}
