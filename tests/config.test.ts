import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CONFIG_VERSION,
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
        agents: { designer: { model: "a/b", fallback: "c/d" }, qa: { model: "a/b" }, reviewer: { model: "a/b", fallback: "c/d" } },
      }),
    ).toBeNull()
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
})
