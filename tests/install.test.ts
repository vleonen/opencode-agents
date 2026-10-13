import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { defaultConfig, writeConfig } from "../src/core/config"
import { POLICY_BEGIN } from "../src/core/docs"
import { install, inspect, uninstall } from "../src/core/install"
import { resolveTargets } from "../src/core/paths"
import { renderTemplates } from "../src/core/templates"

const FILES = [
  "designer.md",
  "designer-fallback.md",
  "qa.md",
  "qa-fallback.md",
  "reviewer.md",
  "reviewer-fallback.md",
]

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-agents-inst-"))
}

function globalEnv(): { env: { OPENCODE_CONFIG_DIR: string } } {
  return { env: { OPENCODE_CONFIG_DIR: tmp() } }
}

describe("install", () => {
  it("installs all six agents, the policy block, and a manifest", () => {
    const { env } = globalEnv()
    const report = install({ config: defaultConfig("global"), env })
    expect(report.files).toHaveLength(6)
    expect(report.files.every((f) => f.action === "created")).toBe(true)
    expect(report.policy).toBe("created")

    const t = resolveTargets({ scope: "global", env })
    for (const name of FILES) expect(fs.existsSync(path.join(t.agentDir, name))).toBe(true)
    expect(fs.readFileSync(t.agentsMdPath, "utf8")).toContain(POLICY_BEGIN)
    expect(fs.existsSync(path.join(t.agentDir, ".opencode-agents.manifest.json"))).toBe(true)
  })

  it("is idempotent on re-run", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    install({ config, env })
    const second = install({ config, env })
    expect(second.files.every((f) => f.action === "unchanged")).toBe(true)
    expect(second.policy).toBe("unchanged")
  })

  it("updates owned files when the model changes", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    install({ config, env })
    config.agents.designer.model = "zai-coding-plan/glm-5.2"
    const report = install({ config, env })
    expect(report.files.find((f) => f.fileName === "designer.md")?.action).toBe("updated")
    const t = resolveTargets({ scope: "global", env })
    expect(fs.readFileSync(path.join(t.agentDir, "designer.md"), "utf8")).toContain("model: zai-coding-plan/glm-5.2")
    expect(report.files.find((f) => f.fileName === "qa.md")?.action).toBe("unchanged")
  })

  it("skips unowned files and overwrites them only with --force", () => {
    const { env } = globalEnv()
    const t = resolveTargets({ scope: "global", env })
    fs.mkdirSync(t.agentDir, { recursive: true })
    fs.writeFileSync(path.join(t.agentDir, "designer.md"), "custom\n")

    const config = defaultConfig("global")
    const skipped = install({ config, env })
    expect(skipped.files.find((f) => f.fileName === "designer.md")?.action).toBe("skipped")
    expect(fs.readFileSync(path.join(t.agentDir, "designer.md"), "utf8")).toBe("custom\n")

    const forced = install({ config, env, force: true })
    expect(forced.files.find((f) => f.fileName === "designer.md")?.action).toBe("updated")
  })

  it("adopts an identical unowned file, then manages it", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    const t = resolveTargets({ scope: "global", env })
    fs.mkdirSync(t.agentDir, { recursive: true })
    const rendered = renderTemplates(config).find((r) => r.fileName === "designer.md")
    expect(rendered).toBeDefined()
    fs.writeFileSync(path.join(t.agentDir, "designer.md"), rendered?.content ?? "")

    const report = install({ config, env, adopt: true })
    expect(report.files.find((f) => f.fileName === "designer.md")?.action).toBe("unchanged")

    config.agents.designer.model = "zai-coding-plan/glm-5.2"
    const next = install({ config, env })
    expect(next.files.find((f) => f.fileName === "designer.md")?.action).toBe("updated")
  })

  it("creates five files for a primary-only role", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    config.agents.qa.fallback = undefined
    const report = install({ config, env })
    expect(report.files).toHaveLength(5)
    const t = resolveTargets({ scope: "global", env })
    expect(fs.existsSync(path.join(t.agentDir, "qa-fallback.md"))).toBe(false)
  })

  it("orphans a twin when its fallback is cleared and drops it from the policy", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    install({ config, env })
    const t = resolveTargets({ scope: "global", env })

    config.agents.qa.fallback = undefined
    const report = install({ config, env })

    // The twin file stays on disk, is reported orphaned, and is not rewritten.
    expect(report.orphaned).toContain("qa-fallback.md")
    expect(fs.existsSync(path.join(t.agentDir, "qa-fallback.md"))).toBe(true)
    expect(report.files.some((f) => f.fileName === "qa-fallback.md")).toBe(false)

    // The policy no longer references the removed twin, but the roles section stays.
    const agentsMd = fs.readFileSync(t.agentsMdPath, "utf8")
    expect(agentsMd).toContain("## Agent roles")
    expect(agentsMd).not.toContain("qa-fallback")
    expect(agentsMd).toContain("designer-fallback")
  })
})

describe("uninstall", () => {
  it("removes owned files and the policy, keeps edited files", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    install({ config, env })
    const t = resolveTargets({ scope: "global", env })
    writeConfig(t.configPath, config)
    fs.appendFileSync(path.join(t.agentDir, "designer.md"), "\n# user edit\n")

    const report = uninstall({ config, env })
    expect(report.files.find((f) => f.fileName === "designer.md")?.action).toBe("kept")
    expect(report.files.find((f) => f.fileName === "qa.md")?.action).toBe("removed")
    expect(fs.existsSync(path.join(t.agentDir, "designer.md"))).toBe(true)
    expect(fs.existsSync(path.join(t.agentDir, "qa.md"))).toBe(false)
    expect(report.policy).toBe("removed")
    expect(fs.existsSync(path.join(t.agentDir, ".opencode-agents.manifest.json"))).toBe(false)
    expect(report.config).toBe("removed")
  })

  it("keeps the config on uninstall with removeConfig: false", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    install({ config, env })
    const t = resolveTargets({ scope: "global", env })
    writeConfig(t.configPath, config)
    const report = uninstall({ config, env, removeConfig: false })
    expect(report.config).toBe("kept")
    expect(fs.existsSync(t.configPath)).toBe(true)
  })
})

describe("inspect", () => {
  it("reports planned actions without writing", () => {
    const { env } = globalEnv()
    const config = defaultConfig("global")
    const t = resolveTargets({ scope: "global", env })

    const before = inspect({ config, env })
    expect(before.entries.every((e) => e.action === "created")).toBe(true)
    expect(fs.existsSync(t.agentDir)).toBe(false)

    install({ config, env })
    const after = inspect({ config, env })
    expect(after.entries.every((e) => e.action === "unchanged")).toBe(true)
    expect(after.policyPresent).toBe(true)
  })
})
