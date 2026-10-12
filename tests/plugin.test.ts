import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { defaultConfig, writeConfig } from "../src/core/config"
import plugin from "../src/index"

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-agents-plugin-"))
}

async function withConfigDir(dir: string, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = dir
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = prev
  }
}

describe("plugin shell", () => {
  it("V2 setup installs from a project config", async () => {
    const projectDir = tmp()
    const cfgDir = tmp()
    writeConfig(path.join(projectDir, ".opencode", "opencode-agents.json"), defaultConfig("project"))

    await withConfigDir(cfgDir, async () => {
      const cleanup = await plugin.setup({
        location: { directory: projectDir },
        model: { list: async () => [] },
      })
      expect(typeof cleanup).toBe("function")
      expect(fs.existsSync(path.join(projectDir, ".opencode", "agents", "reviewer.md"))).toBe(true)
      expect(fs.readFileSync(path.join(projectDir, "AGENTS.md"), "utf8")).toContain("opencode-agents")
    })
  })

  it("V2 setup is a no-op without any config", async () => {
    const projectDir = tmp()
    const cfgDir = tmp()
    await withConfigDir(cfgDir, async () => {
      const cleanup = await plugin.setup({ location: { directory: projectDir } })
      expect(typeof cleanup).toBe("function")
      expect(fs.existsSync(path.join(projectDir, ".opencode", "agents"))).toBe(false)
    })
  })

  it("V1 server installs from a global config", async () => {
    const cfgDir = tmp()
    writeConfig(path.join(cfgDir, "opencode-agents.json"), defaultConfig("global"))
    await withConfigDir(cfgDir, async () => {
      const hooks = await plugin.server({ directory: tmp() }, undefined)
      expect(hooks).toEqual({})
      expect(fs.existsSync(path.join(cfgDir, "agent", "designer.md"))).toBe(true)
      expect(fs.readFileSync(path.join(cfgDir, "AGENTS.md"), "utf8")).toContain("opencode-agents")
    })
  })

  it("honors OPENCODE_AGENTS_DISABLE", async () => {
    const cfgDir = tmp()
    writeConfig(path.join(cfgDir, "opencode-agents.json"), defaultConfig("global"))
    const prev = process.env.OPENCODE_AGENTS_DISABLE
    process.env.OPENCODE_AGENTS_DISABLE = "1"
    try {
      await withConfigDir(cfgDir, async () => {
        await plugin.setup({ location: { directory: tmp() } })
        expect(fs.existsSync(path.join(cfgDir, "agent"))).toBe(false)
      })
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_AGENTS_DISABLE
      else process.env.OPENCODE_AGENTS_DISABLE = prev
    }
  })
})
