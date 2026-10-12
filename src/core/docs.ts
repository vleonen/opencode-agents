import fs from "node:fs"
import path from "node:path"

export const POLICY_BEGIN = "<!-- BEGIN opencode-agents -->"
export const POLICY_END = "<!-- END opencode-agents -->"

export function policyBlock(policyText: string): string {
  return `${POLICY_BEGIN}\n${policyText.replace(/\s+$/, "")}\n${POLICY_END}`
}

export function hasPolicy(content: string): boolean {
  return content.includes(POLICY_BEGIN) && content.includes(POLICY_END)
}

/** Insert or replace the policy block. Idempotent. */
export function upsertPolicy(content: string, policyText: string): string {
  const block = policyBlock(policyText)
  const bi = content.indexOf(POLICY_BEGIN)
  const ei = content.indexOf(POLICY_END)
  if (bi !== -1 && ei !== -1 && ei > bi) {
    return content.slice(0, bi) + block + content.slice(ei + POLICY_END.length)
  }
  const trimmed = content.replace(/\s+$/, "")
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : ""
  return `${prefix}${block}\n`
}

/** Remove the policy block and collapse the blank lines it left behind. */
export function stripPolicy(content: string): string {
  const bi = content.indexOf(POLICY_BEGIN)
  const ei = content.indexOf(POLICY_END)
  if (bi === -1 || ei === -1 || ei < bi) return content
  const joined = content.slice(0, bi) + content.slice(ei + POLICY_END.length)
  const compact = joined.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "")
  return compact.length > 0 ? `${compact}\n` : ""
}

export type PolicyAction = "created" | "updated" | "unchanged"

export function mergePolicyFile(agentsMdPath: string, policyText: string): PolicyAction {
  const exists = fs.existsSync(agentsMdPath)
  const current = exists ? fs.readFileSync(agentsMdPath, "utf8") : ""
  const next = upsertPolicy(current, policyText)
  if (!exists) {
    fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true })
    fs.writeFileSync(agentsMdPath, next)
    return "created"
  }
  if (next === current) return "unchanged"
  fs.writeFileSync(agentsMdPath, next)
  return "updated"
}

/** Remove the policy block. Returns true when something changed. Deletes AGENTS.md when it becomes empty. */
export function stripPolicyFile(agentsMdPath: string): boolean {
  if (!fs.existsSync(agentsMdPath)) return false
  const current = fs.readFileSync(agentsMdPath, "utf8")
  if (!hasPolicy(current)) return false
  const next = stripPolicy(current)
  if (next === current) return false
  if (next === "") fs.rmSync(agentsMdPath)
  else fs.writeFileSync(agentsMdPath, next)
  return true
}
