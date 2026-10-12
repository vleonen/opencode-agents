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

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/** Insert or replace the policy block. Idempotent, even for malformed markers. */
export function upsertPolicy(content: string, policyText: string): string {
  const block = policyBlock(policyText)
  const bi = content.indexOf(POLICY_BEGIN)
  const ei = content.indexOf(POLICY_END)

  // Well-formed, single, in order: replace in place.
  if (bi !== -1 && ei !== -1 && ei > bi && countOccurrences(content, POLICY_BEGIN) === 1 && countOccurrences(content, POLICY_END) === 1) {
    return content.slice(0, bi) + block + content.slice(ei + POLICY_END.length)
  }

  // Absent, duplicated, or out of order: drop everything from the first BEGIN to
  // the last END (plus any orphan markers), then append a single fresh block.
  const firstBegin = content.indexOf(POLICY_BEGIN)
  const lastEnd = content.lastIndexOf(POLICY_END)
  let cleaned: string
  if (firstBegin !== -1 && lastEnd !== -1 && lastEnd > firstBegin) {
    cleaned = content.slice(0, firstBegin) + content.slice(lastEnd + POLICY_END.length)
  } else {
    cleaned = content.split(POLICY_BEGIN).join("").split(POLICY_END).join("")
  }
  const trimmed = cleaned.replace(/\s+$/, "")
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : ""
  return `${prefix}${block}\n`
}

/** Remove the policy block, touching only whitespace at the seam. */
export function stripPolicy(content: string): string {
  const bi = content.indexOf(POLICY_BEGIN)
  const ei = content.indexOf(POLICY_END)
  if (bi === -1 || ei === -1 || ei < bi) return content
  const left = content.slice(0, bi).replace(/\s+$/, "")
  const right = content.slice(ei + POLICY_END.length).replace(/^\s+/, "")
  if (left === "" && right === "") return ""
  if (left === "") return `${right.replace(/\s+$/, "")}\n`
  if (right === "") return `${left}\n`
  return `${left}\n\n${right.replace(/\s+$/, "")}\n`
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
