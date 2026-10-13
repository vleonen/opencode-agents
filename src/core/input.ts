import type { Scope } from "./paths"

/** Pure parsers for interactive CLI input (kept out of `bin/` so they are unit-testable). */

/** `p`/`project`, `g`/`global`; blank or anything else keeps the fallback. */
export function parseScopeInput(text: string, fallback: Scope): Scope {
  const value = text.trim().toLowerCase()
  if (value === "p" || value === "project") return "project"
  if (value === "g" || value === "global") return "global"
  return fallback
}

/** Split a comma/whitespace separated list of directories, dropping empties. `.` is kept. */
export function parseModifyRootsInput(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
}
