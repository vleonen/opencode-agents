import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

describe("generated agents module", () => {
  it("is in sync with agents/*.md and AGENTS.agents.md", () => {
    expect(() =>
      execFileSync("node", [path.join(root, "scripts", "gen-agents.mjs"), "--check"], {
        cwd: root,
        stdio: "pipe",
      }),
    ).not.toThrow()
  })
})
