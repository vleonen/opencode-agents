import fs from "node:fs"
import path from "node:path"

export const POLICY_BEGIN = "<!-- BEGIN opencode-agents -->"
export const POLICY_END = "<!-- END opencode-agents -->"

export function policyBlock(policyText: string): string {
  return `${POLICY_BEGIN}\n${policyText.replace(/\s+$/, "")}\n${POLICY_END}`
}

export function hasPolicy(content: string): boolean {
  const { begins, ends } = markerLines(content)
  return begins.length > 0 && ends.length > 0
}

/**
 * Line indices (0-based) of the markers. A marker only counts as such when it is
 * a standalone line, so prose that merely *mentions* the markers (e.g. docs that
 * quote them in backticks) is never treated as a block.
 */
function markerLines(content: string): { begins: number[]; ends: number[] } {
  const begins: number[] = []
  const ends: number[] = []
  content.split("\n").forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed === POLICY_BEGIN) begins.push(index)
    else if (trimmed === POLICY_END) ends.push(index)
  })
  return { begins, ends }
}

/** Insert or replace the policy block. Idempotent, even for malformed markers. */
export function upsertPolicy(content: string, policyText: string): string {
  const block = policyBlock(policyText)
  const lines = content.split("\n")
  const { begins, ends } = markerLines(content)

  // Well-formed, single, in order: replace in place.
  if (begins.length === 1 && ends.length === 1 && (ends[0] as number) > (begins[0] as number)) {
    const before = lines.slice(0, begins[0] as number)
    const after = lines.slice((ends[0] as number) + 1)
    return [...before, ...block.split("\n"), ...after].join("\n")
  }

  // Absent, duplicated, or out of order: drop everything from the first BEGIN to
  // the last END (plus any orphan markers), then append a single fresh block.
  const firstBegin = begins.length > 0 ? (begins[0] as number) : -1
  const lastEnd = ends.length > 0 ? (ends[ends.length - 1] as number) : -1
  const kept =
    firstBegin !== -1 && lastEnd !== -1 && lastEnd > firstBegin
      ? [...lines.slice(0, firstBegin), ...lines.slice(lastEnd + 1)]
      : lines.filter((_, index) => !begins.includes(index) && !ends.includes(index))
  const trimmed = kept.join("\n").replace(/\s+$/, "")
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : ""
  return `${prefix}${block}\n`
}

/** Remove the policy block, touching only whitespace at the seam. */
export function stripPolicy(content: string): string {
  const lines = content.split("\n")
  const { begins, ends } = markerLines(content)
  const begin = begins[0]
  const end = ends[0]
  if (begin === undefined || end === undefined || end < begin) return content
  const left = lines.slice(0, begin).join("\n").replace(/\s+$/, "")
  const right = lines.slice(end + 1).join("\n").replace(/^\s+/, "")
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
