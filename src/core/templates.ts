import { AGENT_TEMPLATES, POLICY_TEMPLATE, type AgentTemplateKind } from "../generated/agents"
import { ROLES, isRole, type AgentChoice, type AgentsConfig, type PermissionRule, type Role } from "./config"

export interface RenderedAgent {
  fileName: string
  role: Role
  kind: AgentTemplateKind
  content: string
}

const PRIMARY_TOKEN = "{{MODEL}}"
const FALLBACK_TOKEN = "{{FALLBACK_MODEL}}"
const TWIN_MODE_TOKEN = "{{TWIN_MODE}}"
const TWIN_HIDDEN_TOKEN = "{{TWIN_HIDDEN}}"
// A YAML comment line where project/user permission rules are injected.
const OVERRIDES_LINE = /^[ \t]*#[ \t]*\{\{PERMISSION_OVERRIDES\}\}[ \t]*\n/m
// A single permission rule line, as emitted by renderRule (quoted action) or
// authored in the templates (bare action). One shape keeps the parser exact.
const RULE_LINE = /^[ \t]*-[ \t]*\{action: "?([A-Za-z_][A-Za-z0-9_-]*)"?, resource: ("(?:[^"\\]|\\.)*"), effect: (allow|ask|deny)\}[ \t]*$/

function renderRule(rule: PermissionRule): string {
  return `  - {action: ${JSON.stringify(rule.action)}, resource: ${JSON.stringify(rule.resource)}, effect: ${rule.effect}}`
}

/**
 * V2 renames several permission actions relative to V1's tool keys. Installed
 * agent files are read by both runtimes, so rules are emitted as a V1
 * `permission:` map (V1 native; V2 migrates it, see ConfigMigrateV1.migrateAgent).
 */
const V1_ACTION_KEY: Record<string, string> = { shell: "bash", subagent: "task", write: "edit", patch: "edit" }

function v1PermissionKey(action: string): string {
  return V1_ACTION_KEY[action] ?? action
}

/**
 * Map a configured modification directory onto an `edit` permission resource.
 * Entries are project-relative (opencode matches edit permissions against a
 * worktree-relative path); `.` means the whole project.
 */
function modifyRootToResource(root: string): string {
  const trimmed = root.trim().replace(/^\.\//, "").replace(/\/+$/, "")
  if (trimmed === "" || trimmed === ".") return "**"
  if (trimmed.endsWith("/**") || trimmed.endsWith("*")) return trimmed
  return `${trimmed}/**`
}

/**
 * Rewrite the frontmatter's V2-style `permissions:` array into a V1-native
 * `permission:` map, grouping rules by tool key. Within a tool key the original
 * order is preserved (last-match-wins), and a repeated resource keeps its last
 * effect at the last position. A comment line is emitted just before the rule
 * that follows it; trailing comments stay at the end of the map.
 */
function toPermissionMap(content: string): string {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") return content
  let frontmatterEnd = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      frontmatterEnd = i
      break
    }
  }
  if (frontmatterEnd === -1) return content
  const start = lines.findIndex((line, i) => i > 0 && i < frontmatterEnd && /^permissions:[ \t]*$/.test(line))
  if (start === -1) return content

  interface Entry {
    effect: string
    comments: string[]
  }
  const groups = new Map<string, Map<string, Entry>>()
  let pending: string[] = []
  for (let i = start + 1; i < frontmatterEnd; i++) {
    const line = lines[i] as string
    const trimmed = line.trim()
    if (trimmed === "") continue
    if (trimmed.startsWith("#")) {
      if (trimmed !== "# {{PERMISSION_OVERRIDES}}") pending.push(trimmed)
      continue
    }
    const match = RULE_LINE.exec(line)
    if (!match) throw new Error(`agent template has an unparseable permission rule: ${line}`)
    const action = v1PermissionKey(match[1] as string)
    const resource = JSON.parse(match[2] as string) as string
    const effect = match[3] as string
    let group = groups.get(action)
    if (!group) {
      group = new Map()
      groups.set(action, group)
    }
    // A repeated resource resolves to its last occurrence, which must keep the
    // last position so ordering relative to other matching patterns is stable.
    group.delete(resource)
    group.set(resource, { effect, comments: pending })
    pending = []
  }
  const trailing = pending

  const out: string[] = ["permission:"]
  for (const [action, rules] of groups) {
    out.push(`  ${action}:`)
    for (const [resource, entry] of rules) {
      for (const comment of entry.comments) out.push(`    ${comment}`)
      out.push(`    ${JSON.stringify(resource)}: ${entry.effect}`)
    }
  }
  for (const comment of trailing) out.push(`  ${comment}`)
  return [...lines.slice(0, start), ...out, ...lines.slice(frontmatterEnd)].join("\n")
}

/** Replace the override slot with the configured rules; an empty slot removes the line. */
function injectOverrides(content: string, rules: readonly PermissionRule[]): string {
  if (!OVERRIDES_LINE.test(content)) {
    if (rules.length > 0) throw new Error("agent template has no {{PERMISSION_OVERRIDES}} slot")
    return content
  }
  return content.replace(OVERRIDES_LINE, () => (rules.length === 0 ? "" : `${rules.map(renderRule).join("\n")}\n`))
}

/** Substitute the twin's mode/hidden slots (present only in fallback templates). */
function renderTwinSlots(content: string, choice: AgentChoice): string {
  return content
    .split(TWIN_MODE_TOKEN)
    .join(choice.twinMode)
    .split(TWIN_HIDDEN_TOKEN)
    .join(String(choice.twinHidden))
}

/**
 * Substitute the chosen models, twin visibility, and permission overlays into the
 * bundled templates. A role with no fallback model renders only its primary
 * agent (no `-fallback` twin).
 */
export function renderTemplates(config: AgentsConfig): RenderedAgent[] {
  return AGENT_TEMPLATES.flatMap((t) => {
    if (!isRole(t.role)) throw new Error(`unknown agent role in template: ${t.role}`)
    const choice = config.agents[t.role]
    if (t.kind === "fallback" && choice.fallback === undefined) return []
    const token = t.kind === "primary" ? PRIMARY_TOKEN : FALLBACK_TOKEN
    const model = t.kind === "primary" ? choice.model : (choice.fallback as string)
    let content = t.content.split(token).join(model)
    if (t.kind === "fallback") content = renderTwinSlots(content, choice)
    // Modification directories first so explicit `permissions` rules can override them.
    const overrides: PermissionRule[] = [
      ...choice.modifyRoots.map((root) => ({ action: "edit", resource: modifyRootToResource(root), effect: "allow" as const })),
      ...choice.permissions,
    ]
    content = injectOverrides(content, overrides)
    content = toPermissionMap(content)
    if (content.includes("{{")) throw new Error(`unsubstituted placeholder in template: ${t.fileName}`)
    return [{ fileName: t.fileName, role: t.role, kind: t.kind, content }]
  })
}

/** Roles that have a fallback twin configured. */
export function rolesWithFallback(config: AgentsConfig): Role[] {
  return ROLES.filter((role) => config.agents[role].fallback !== undefined)
}

/** Separates the always-present role guidance from the optional fallback section. */
const FALLBACK_SECTION_MARKER = "<!-- fallback-section -->"

/**
 * Render the AGENTS.md policy from the config. The agent-role section is always
 * present (the agents are always installed); the model-fallback section is
 * included only when at least one role has a fallback twin, and its table/rules
 * list exactly those roles.
 */
export function renderPolicy(config: AgentsConfig, template: string = POLICY_TEMPLATE): string {
  const [workflow = "", fallback = ""] = template.split(FALLBACK_SECTION_MARKER)
  const head = workflow.trimEnd()
  const roles = rolesWithFallback(config)
  if (roles.length === 0) return `${head}\n`
  const rows = roles.map((role) => `| \`${role}\` | \`${role}-fallback\` |`).join("\n")
  const rules = roles.map((role) => `- ${role} -> ${role}-fallback`).join("\n")
  const body = fallback
    .split("{{FALLBACK_TABLE_ROWS}}")
    .join(rows)
    .split("{{FALLBACK_RULES}}")
    .join(rules)
    .trim()
  return body === "" ? `${head}\n` : `${head}\n\n${body}\n`
}
