import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const MANIFEST_NAME = ".opencode-agents.manifest.json"

export interface Manifest {
  version: number
  /** fileName -> sha256 of the content we wrote. */
  files: Record<string, string>
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function emptyManifest(): Manifest {
  return { version: 1, files: {} }
}

export function readManifest(agentDir: string): Manifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(agentDir, MANIFEST_NAME), "utf8")) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as { version?: unknown; files?: unknown }
      const files: Record<string, string> = {}
      if (rec.files && typeof rec.files === "object" && !Array.isArray(rec.files)) {
        for (const [k, v] of Object.entries(rec.files as Record<string, unknown>)) {
          if (typeof v === "string") files[k] = v
        }
      }
      return { version: typeof rec.version === "number" ? rec.version : 1, files }
    }
  } catch {
    /* missing or malformed -> treat as empty */
  }
  return emptyManifest()
}

export function writeManifest(agentDir: string, manifest: Manifest): void {
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
}

export function removeManifest(agentDir: string): void {
  try {
    fs.rmSync(path.join(agentDir, MANIFEST_NAME))
  } catch {
    /* already gone */
  }
}
