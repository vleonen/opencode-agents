import path from "node:path"

import { describe, expect, it } from "vitest"

import { resolveGlobalConfigDir, resolveTargets } from "../src/core/paths"

describe("resolveGlobalConfigDir", () => {
  it("prefers OPENCODE_CONFIG_DIR", () => {
    expect(resolveGlobalConfigDir({ OPENCODE_CONFIG_DIR: "/x/oc", XDG_CONFIG_HOME: "/x/xdg" }, "/home/u")).toBe("/x/oc")
  })

  it("falls back to XDG_CONFIG_HOME/opencode", () => {
    expect(resolveGlobalConfigDir({ XDG_CONFIG_HOME: "/x/xdg" }, "/home/u")).toBe(path.join("/x/xdg", "opencode"))
  })

  it("falls back to ~/.config/opencode", () => {
    expect(resolveGlobalConfigDir({}, "/home/u")).toBe(path.join("/home/u", ".config", "opencode"))
  })

  it("ignores blank values", () => {
    expect(resolveGlobalConfigDir({ OPENCODE_CONFIG_DIR: "   ", XDG_CONFIG_HOME: "" }, "/home/u")).toBe(
      path.join("/home/u", ".config", "opencode"),
    )
  })
})

describe("resolveTargets", () => {
  it("resolves global targets under the config dir", () => {
    const t = resolveTargets({ scope: "global", env: { OPENCODE_CONFIG_DIR: "/cfg" } })
    expect(t.agentDir).toBe(path.join("/cfg", "agent"))
    expect(t.agentsMdPath).toBe(path.join("/cfg", "AGENTS.md"))
    expect(t.configPath).toBe(path.join("/cfg", "opencode-agents.json"))
  })

  it("resolves project targets", () => {
    const t = resolveTargets({ scope: "project", projectDir: "/proj" })
    expect(t.agentDir).toBe(path.join("/proj", ".opencode", "agents"))
    expect(t.agentsMdPath).toBe(path.join("/proj", "AGENTS.md"))
    expect(t.configPath).toBe(path.join("/proj", ".opencode", "opencode-agents.json"))
  })

  it("requires a project directory for project scope", () => {
    expect(() => resolveTargets({ scope: "project" })).toThrow()
  })
})
