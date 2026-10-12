/** Small defensive helpers shared by the installer core. */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Trimmed non-empty string, or null. */
export function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}
