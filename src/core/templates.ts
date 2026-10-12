import { AGENT_TEMPLATES, type AgentTemplateKind } from "../generated/agents"
import type { AgentsConfig, Role } from "./config"
import { isRole } from "./config"

export interface RenderedAgent {
  fileName: string
  role: Role
  kind: AgentTemplateKind
  content: string
}

const PRIMARY_TOKEN = "{{MODEL}}"
const FALLBACK_TOKEN = "{{FALLBACK_MODEL}}"

/** Substitute the chosen models into the bundled templates. */
export function renderTemplates(config: AgentsConfig): RenderedAgent[] {
  return AGENT_TEMPLATES.map((t) => {
    if (!isRole(t.role)) throw new Error(`unknown agent role in template: ${t.role}`)
    const choice = config.agents[t.role]
    const token = t.kind === "primary" ? PRIMARY_TOKEN : FALLBACK_TOKEN
    const model = t.kind === "primary" ? choice.model : choice.fallback
    const content = t.content.split(token).join(model)
    if (content.includes(PRIMARY_TOKEN) || content.includes(FALLBACK_TOKEN)) {
      throw new Error(`unsubstituted model placeholder in template: ${t.fileName}`)
    }
    return { fileName: t.fileName, role: t.role, kind: t.kind, content }
  })
}
