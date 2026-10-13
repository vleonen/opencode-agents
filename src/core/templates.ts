import { AGENT_TEMPLATES, type AgentTemplateKind } from "../generated/agents"
import type { AgentsConfig, PermissionRule, Role } from "./config"
import { isRole } from "./config"

export interface RenderedAgent {
  fileName: string
  role: Role
  kind: AgentTemplateKind
  content: string
}

const PRIMARY_TOKEN = "{{MODEL}}"
const FALLBACK_TOKEN = "{{FALLBACK_MODEL}}"
// A YAML comment line where project/user permission rules are injected.
const OVERRIDES_LINE = /^[ \t]*#[ \t]*\{\{PERMISSION_OVERRIDES\}\}[ \t]*\n/m

function renderRule(rule: PermissionRule): string {
  return `  - {action: ${JSON.stringify(rule.action)}, resource: ${JSON.stringify(rule.resource)}, effect: ${rule.effect}}`
}

/** Replace the override slot with the configured rules; an empty slot removes the line. */
function injectOverrides(content: string, rules: readonly PermissionRule[]): string {
  if (!OVERRIDES_LINE.test(content)) {
    if (rules.length > 0) throw new Error("agent template has no {{PERMISSION_OVERRIDES}} slot")
    return content
  }
  return content.replace(OVERRIDES_LINE, () => (rules.length === 0 ? "" : `${rules.map(renderRule).join("\n")}\n`))
}

/** Substitute the chosen models and permission overlays into the bundled templates. */
export function renderTemplates(config: AgentsConfig): RenderedAgent[] {
  return AGENT_TEMPLATES.map((t) => {
    if (!isRole(t.role)) throw new Error(`unknown agent role in template: ${t.role}`)
    const choice = config.agents[t.role]
    const token = t.kind === "primary" ? PRIMARY_TOKEN : FALLBACK_TOKEN
    const model = t.kind === "primary" ? choice.model : choice.fallback
    const content = injectOverrides(t.content.split(token).join(model), choice.permissions)
    if (content.includes(PRIMARY_TOKEN) || content.includes(FALLBACK_TOKEN)) {
      throw new Error(`unsubstituted model placeholder in template: ${t.fileName}`)
    }
    return { fileName: t.fileName, role: t.role, kind: t.kind, content }
  })
}
