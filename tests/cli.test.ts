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
// A neutral cwd so a stray project config in the repo can never change the
// CLI's scope resolution during tests.
let neutralCwd = ""

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

beforeAll(async () => {
  neutralCwd = tmp("opencode-agents-cwd-")
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
    cwd: neutralCwd,
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

  it("adds modifyRoots via --add-root and renders the edit allow", () => {
    const globalDir = tmp("opencode-agents-global-")
    const r = run(["init", "--non-interactive", "--add-root", "qa=src", "--add-root", "qa=."], {
      OPENCODE_CONFIG_DIR: globalDir,
    })
    expect(r.status).toBe(0)
    const cfg = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode-agents.json"), "utf8")) as {
      agents: { qa: { modifyRoots: string[] } }
    }
    expect(cfg.agents.qa.modifyRoots).toEqual(["src", "."])
    const qa = fs.readFileSync(path.join(globalDir, "agent", "qa.md"), "utf8")
    expect(qa).toContain('"src/**": allow')
    expect(qa).toContain('"**": allow')
  })

  it("rejects a malformed --add-root", () => {
    const globalDir = tmp("opencode-agents-global-")
    const r = run(["init", "--non-interactive", "--add-root", "qa"], { OPENCODE_CONFIG_DIR: globalDir })
    expect(r.status).toBe(2)
  })

  it("sets up a fresh project with the non-interactive recipe", () => {
    const project = tmp("opencode-agents-newproj-")
    const globalDir = tmp("opencode-agents-global-")
    const r = run(["init", "--scope", "project", "--dir", project, "--add-root", "qa=.", "--non-interactive"], {
      OPENCODE_CONFIG_DIR: globalDir,
    })
    expect(r.status).toBe(0)
    const cfg = JSON.parse(
      fs.readFileSync(path.join(project, ".opencode", "opencode-agents.json"), "utf8"),
    ) as { scope: string; agents: { qa: { modifyRoots: string[] } } }
    expect(cfg.scope).toBe("project")
    expect(cfg.agents.qa.modifyRoots).toEqual(["."])
    expect(fs.existsSync(path.join(project, ".opencode", "agents", "qa-fallback.md"))).toBe(true)
    expect(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8")).toContain("BEGIN opencode-agents")
    // The global config dir must stay untouched.
    expect(fs.existsSync(path.join(globalDir, "agent"))).toBe(false)
  })

  it("inherits global model choices when setting up a fresh project", () => {
    const project = tmp("opencode-agents-newproj-")
    const globalDir = tmp("opencode-agents-global-")
    const global = defaultConfig("global")
    global.agents.designer.model = "myorg/my-model"
    writeConfig(path.join(globalDir, "opencode-agents.json"), global)

    const r = run(["init", "--scope", "project", "--dir", project, "--non-interactive"], {
      OPENCODE_CONFIG_DIR: globalDir,
    })
    expect(r.status).toBe(0)
    const cfg = JSON.parse(
      fs.readFileSync(path.join(project, ".opencode", "opencode-agents.json"), "utf8"),
    ) as { agents: { designer: { model: string } } }
    expect(cfg.agents.designer.model).toBe("myorg/my-model")
  })

  it("defaults to global for a fresh project without --scope and hints about it", () => {
    const project = tmp("opencode-agents-newproj-")
    const globalDir = tmp("opencode-agents-global-")
    fs.mkdirSync(path.join(project, ".git"), { recursive: true })

    const r = run(["init", "--dir", project, "--non-interactive"], { OPENCODE_CONFIG_DIR: globalDir })
    expect(r.status).toBe(0)
    expect((r.stderr ?? "").toString()).toContain("installing globally")
    expect(fs.existsSync(path.join(globalDir, "agent", "designer.md"))).toBe(true)
    expect(fs.existsSync(path.join(project, ".opencode", "agents"))).toBe(false)
  })
})
