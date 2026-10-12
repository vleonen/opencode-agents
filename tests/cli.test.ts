import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"
import { beforeAll, describe, expect, it } from "vitest"

import { defaultConfig, writeConfig } from "../src/core/config"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let cli = ""

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

beforeAll(async () => {
  cli = path.join(tmp("opencode-agents-cli-"), "init.mjs")
  await build({
    entryPoints: [path.join(root, "bin", "init.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: cli,
    logLevel: "silent",
  })
}, 120_000)

function run(args: string[], env: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

describe("CLI", () => {
  it("uses the existing project config's scope on a flagless re-run (regression)", () => {
    const project = tmp("opencode-agents-proj-")
    const globalDir = tmp("opencode-agents-global-")
    writeConfig(path.join(project, ".opencode", "opencode-agents.json"), defaultConfig("project"))

    const r = run(["init", "--non-interactive", "--dir", project], { OPENCODE_CONFIG_DIR: globalDir })
    expect(r.status).toBe(0)
    expect(fs.existsSync(path.join(project, ".opencode", "agents", "qa-fallback.md"))).toBe(true)
    // The global config dir must stay untouched.
    expect(fs.existsSync(path.join(globalDir, "agent"))).toBe(false)
    expect(fs.existsSync(path.join(globalDir, "opencode-agents.json"))).toBe(false)
  })

  it("uninstalls a project install without needing --scope", () => {
    const project = tmp("opencode-agents-proj-")
    const globalDir = tmp("opencode-agents-global-")
    writeConfig(path.join(project, ".opencode", "opencode-agents.json"), defaultConfig("project"))
    run(["init", "--non-interactive", "--dir", project], { OPENCODE_CONFIG_DIR: globalDir })

    const r = run(["uninstall", "--dir", project], { OPENCODE_CONFIG_DIR: globalDir })
    expect(r.status).toBe(0)
    expect(fs.existsSync(path.join(project, ".opencode", "agents", "qa.md"))).toBe(false)
    expect(fs.existsSync(path.join(project, ".opencode", "opencode-agents.json"))).toBe(false)
  })

  it("rejects a --set key with too many segments", () => {
    const globalDir = tmp("opencode-agents-global-")
    const r = run(["init", "--non-interactive", "--set", "qa.model.x=v"], { OPENCODE_CONFIG_DIR: globalDir })
    expect(r.status).toBe(2)
  })
})
