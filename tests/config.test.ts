import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CONFIG_VERSION,
  configWarnings,
  defaultChoices,
  defaultConfig,
  parseConfig,
  readConfig,
  writeConfig,
} from "../src/core/config"

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-agents-cfg-"))
}

describe("config", () => {
  it("builds sane defaults", () => {
    const c = defaultConfig("global")
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.scope).toBe("global")
    expect(c.agents.designer.model).toBe(defaultChoices().designer.model)
    expect(Object.keys(c.agents).sort()).toEqual(["designer", "qa", "reviewer"])
  })

  it("round-trips through parseConfig", () => {
    const c = defaultConfig("project")
    expect(parseConfig(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })

  it("rejects malformed shapes", () => {
    expect(parseConfig(null)).toBeNull()
    expect(parseConfig({})).toBeNull()
    expect(parseConfig({ scope: "global" })).toBeNull()
    expect(parseConfig({ scope: "nope", agents: {} })).toBeNull()
    expect(
      parseConfig({
        scope: "global",
        agents: { designer: { model: "a/b", fallback: "c/d" }, qa: { fallback: "c/d" }, reviewer: { model: "a/b", fallback: "c/d" } },
      }),
    ).toBeNull()
  })

  it("supports a primary-only agent (missing/empty fallback)", () => {
    const c = parseConfig({
      scope: "global",
      agents: {
        designer: { model: "a/b" },
        reviewer: { model: "a/b", fallback: "" },
        qa: { model: "a/b", fallback: "c/d" },
      },
    })
    expect(c).not.toBeNull()
    expect(c?.agents.designer.fallback).toBeUndefined()
    expect(c?.agents.reviewer.fallback).toBeUndefined()
    expect(c?.agents.qa.fallback).toBe("c/d")
  })

  it("warns when twin knobs are set without a fallback", () => {
    const c = defaultConfig("global")
    c.agents.qa.fallback = undefined
    c.agents.qa.twinHidden = true
    expect(configWarnings(c).some((w) => w.includes("ignored because no fallback"))).toBe(true)
  })

  it("parses and preserves permission overlays, dropping malformed rules", () => {
    const c = parseConfig({
      scope: "project",
      agents: {
        designer: { model: "a/b", fallback: "c/d" },
        reviewer: { model: "a/b", fallback: "c/d" },
        qa: {
          model: "a/b",
          fallback: "c/d",
          permissions: [
            { action: "shell", resource: "vm/vm-ssh.sh *", effect: "allow" },
            { action: "shell", resource: "x", effect: "nope" },
            { action: "", resource: "y", effect: "ask" },
            "not-an-object",
          ],
        },
      },
    })
    expect(c?.agents.qa.permissions).toEqual([{ action: "shell", resource: "vm/vm-ssh.sh *", effect: "allow" }])
    expect(c?.agents.designer.permissions).toEqual([])
  })

  it("parses and preserves modifyRoots, dropping malformed entries", () => {
    const c = parseConfig({
      scope: "project",
      agents: {
        designer: { model: "a/b", fallback: "c/d" },
        reviewer: { model: "a/b", fallback: "c/d" },
        qa: { model: "a/b", fallback: "c/d", modifyRoots: ["src", "", "  ", 5, "./tests/"] },
      },
    })
    expect(c?.agents.qa.modifyRoots).toEqual(["src", "./tests/"])
    expect(c?.agents.designer.modifyRoots).toEqual([])
    expect(parseConfig(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })

  it("warns when a modifyRoots entry is absolute or home-anchored", () => {
    const c = defaultConfig("global")
    c.agents.qa.modifyRoots = ["/home/x/proj", "~/dev", "src"]
    const warnings = configWarnings(c)
    expect(warnings.some((w) => w.includes('"/home/x/proj"'))).toBe(true)
    expect(warnings.some((w) => w.includes('"~/dev"'))).toBe(true)
    expect(warnings.some((w) => w.includes('"src"'))).toBe(false)
  })

  it("defaults twin visibility to subagent-only and visible", () => {
    const c = defaultConfig("global")
    expect(c.agents.qa.twinMode).toBe("subagent")
    expect(c.agents.qa.twinHidden).toBe(false)
  })

  it("parses twinMode and twinHidden, defaulting unknown modes", () => {
    const c = parseConfig({
      scope: "project",
      agents: {
        designer: { model: "a/b", fallback: "c/d", twinMode: "all", twinHidden: true },
        reviewer: { model: "a/b", fallback: "c/d", twinMode: "nonsense" },
        qa: { model: "a/b", fallback: "c/d" },
      },
    })
    expect(c?.agents.designer.twinMode).toBe("all")
    expect(c?.agents.designer.twinHidden).toBe(true)
    expect(c?.agents.reviewer.twinMode).toBe("subagent")
    expect(c?.agents.qa.twinHidden).toBe(false)
  })

  it("warns when a twin is hidden", () => {
    const c = defaultConfig("global")
    c.agents.qa.twinHidden = true
    expect(configWarnings(c).some((w) => w.includes("twinHidden"))).toBe(true)
  })

  it("strictly types twinMode and twinHidden", () => {
    const c = parseConfig({
      scope: "global",
      agents: {
        designer: { model: "a/b", fallback: "c/d", twinMode: 5, twinHidden: "true" },
        reviewer: { model: "a/b", fallback: "c/d", twinMode: "subagent", twinHidden: 0 },
        qa: { model: "a/b", fallback: "c/d" },
      },
    })
    expect(c?.agents.designer.twinMode).toBe("subagent")
    expect(c?.agents.designer.twinHidden).toBe(false)
    expect(c?.agents.reviewer.twinHidden).toBe(false)
  })

  it("reads and writes a file", () => {
    const dir = tmp()
    const file = path.join(dir, "opencode-agents.json")
    expect(readConfig(file)).toBeNull()
    const c = defaultConfig("global")
    writeConfig(file, c)
    expect(readConfig(file)).toEqual(c)
    expect(fs.readFileSync(file, "utf8").endsWith("\n")).toBe(true)
  })

  it("warns when a twin is not on an independent provider", () => {
    expect(configWarnings(defaultConfig("global"))).toEqual([])

    const same = defaultConfig("global")
    same.agents.qa.fallback = same.agents.qa.model
    expect(configWarnings(same).some((w) => w.startsWith("qa:"))).toBe(true)

    const sameProvider = defaultConfig("global")
    sameProvider.agents.reviewer.fallback = "zai-coding-plan/glm-5.2"
    expect(configWarnings(sameProvider).some((w) => w.includes("share provider"))).toBe(true)
  })
})
