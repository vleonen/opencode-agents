import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { defaultConfig } from "../src/core/config"
import { install, uninstall } from "../src/core/install"
import { resolveTargets } from "../src/core/paths"

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-agents-int-"))
}

describe("project-scope round trip", () => {
  it("installs into .opencode/agents and the project AGENTS.md, then reverts", () => {
    const projectDir = tmp()
    const config = defaultConfig("project")
    const report = install({ config, projectDir })

    expect(report.files).toHaveLength(6)
    expect(report.policy).toBe("created")

    const t = resolveTargets({ scope: "project", projectDir })
    expect(fs.existsSync(path.join(t.agentDir, "qa-fallback.md"))).toBe(true)
    expect(fs.readFileSync(t.agentsMdPath, "utf8")).toContain("## Subagent model fallback")

    const un = uninstall({ config, projectDir })
    expect(un.policy).toBe("removed")
    expect(fs.existsSync(path.join(t.agentDir, "qa-fallback.md"))).toBe(false)
    expect(fs.existsSync(t.agentsMdPath)).toBe(false)
  })
})
