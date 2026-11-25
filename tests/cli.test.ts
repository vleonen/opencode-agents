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

  it("sets the fallback policy via --set and renders it into the AGENTS.md block", () => {
    const globalDir = tmp("opencode-agents-global-")
    const r = run(
      [
        "init",
        "--non-interactive",
        "--set",
        "fallbackPolicy.maxRetries=2",
        "--set",
        "fallbackPolicy.retryDelaySeconds=60",
        "--set",
        "fallbackPolicy.stallTimeoutMinutes=15",
      ],
      { OPENCODE_CONFIG_DIR: globalDir },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("fallback policy: maxRetries=2 retryDelaySeconds=60 stallTimeoutMinutes=15")
    const cfg = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode-agents.json"), "utf8")) as {
      fallbackPolicy: { maxRetries: number; retryDelaySeconds: number; stallTimeoutMinutes: number }
    }
    expect(cfg.fallbackPolicy).toEqual({ maxRetries: 2, retryDelaySeconds: 60, stallTimeoutMinutes: 15 })
    const agentsMd = fs.readFileSync(path.join(globalDir, "AGENTS.md"), "utf8")
    expect(agentsMd).toContain("For rate-limit errors (429) wait 60 seconds")
    expect(agentsMd).toContain("Retry at most 2 times per task.")
    expect(agentsMd).toContain("produces no output for 15 minutes")
    expect(agentsMd).not.toContain("{{FALLBACK_")
  })

  it("clamps --set fallbackPolicy values the same way as the config parse (cap and overlong numeral)", () => {
    const globalDir = tmp("opencode-agents-global-")
    const r = run(
      [
        "init",
        "--non-interactive",
        "--set",
        "fallbackPolicy.maxRetries=50",
        "--set",
        `fallbackPolicy.stallTimeoutMinutes=${"9".repeat(310)}`,
      ],
      { OPENCODE_CONFIG_DIR: globalDir },
    )
    expect(r.status).toBe(0)
    // Clamped at set time: report, config, and rendered policy all agree.
    expect(r.stdout).toContain("fallback policy: maxRetries=10 retryDelaySeconds=30 stallTimeoutMinutes=120")
    const cfg = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode-agents.json"), "utf8")) as {
      fallbackPolicy: { maxRetries: number; retryDelaySeconds: number; stallTimeoutMinutes: number }
    }
    expect(cfg.fallbackPolicy).toEqual({ maxRetries: 10, retryDelaySeconds: 30, stallTimeoutMinutes: 120 })
    const agentsMd = fs.readFileSync(path.join(globalDir, "AGENTS.md"), "utf8")
    expect(agentsMd).toContain("Retry at most 10 times per task.")
    expect(agentsMd).toContain("produces no output for 120 minutes")
    expect(agentsMd).not.toContain("Retry at most 50 times")
    expect(agentsMd).not.toContain("Infinity")
  })

  it("rejects invalid fallbackPolicy --set values", () => {
    const globalDir = tmp("opencode-agents-global-")
    for (const expr of [
      "fallbackPolicy.nope=5",
      "fallbackPolicy.maxRetries=-1",
      "fallbackPolicy.maxRetries=",
      "fallbackPolicy.retryDelaySeconds=1.5",
      "fallbackPolicy.retryDelaySeconds=1e3",
      "fallbackPolicy.retryDelaySeconds=0x10",
      "fallbackPolicy.retryDelaySeconds=+5",
      "fallbackPolicy",
      "fallbackPolicy.maxRetries.x=1",
    ]) {
      const r = run(["init", "--non-interactive", "--set", expr], { OPENCODE_CONFIG_DIR: globalDir })
      expect(r.status).toBe(2)
    }
    // Nothing was written by the failed runs.
    expect(fs.existsSync(path.join(globalDir, "opencode-agents.json"))).toBe(false)
  })

  it("shows the fallback policy in inspect output", () => {
    const globalDir = tmp("opencode-agents-global-")
    run(["init", "--non-interactive", "--set", "fallbackPolicy.retryDelaySeconds=0"], { OPENCODE_CONFIG_DIR: globalDir })
    const r = run(["inspect"], { OPENCODE_CONFIG_DIR: globalDir })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("fallback policy: maxRetries=1 retryDelaySeconds=0 stallTimeoutMinutes=10")
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

  it("installs the planner with its default plans root, overridable via --add-root/--set", () => {
    const globalDir = tmp("opencode-agents-global-")
    const r = run(["init", "--non-interactive", "--set", "planner=myorg/planner", "--add-root", "planner=plans"], {
      OPENCODE_CONFIG_DIR: globalDir,
    })
    expect(r.status).toBe(0)
    const cfg = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode-agents.json"), "utf8")) as {
      agents: { planner: { model: string; fallback: string; modifyRoots: string[] } }
    }
    expect(cfg.agents.planner.model).toBe("myorg/planner")
    expect(cfg.agents.planner.fallback).toBe("deepseek/deepseek-flash")
    // --add-root appends to the shipped default, like qa.
    expect(cfg.agents.planner.modifyRoots).toEqual([".opencode/plans", "plans"])
    const planner = fs.readFileSync(path.join(globalDir, "agent", "planner.md"), "utf8")
    expect(planner).toContain("model: myorg/planner")
    expect(planner).toContain('".opencode/plans/**": allow')
    expect(planner).toContain('"plans/**": allow')
    expect(planner).toContain('"*": deny')
    // The twin is installed too and shares the configured roots.
    const twin = fs.readFileSync(path.join(globalDir, "agent", "planner-fallback.md"), "utf8")
    expect(twin).toContain("model: deepseek/deepseek-flash")
    expect(twin).toContain('"plans/**": allow')
  })

  it("installs security read-only; --add-root warns instead of granting edits", () => {
    const globalDir = tmp("opencode-agents-global-")
    const r = run(["init", "--non-interactive", "--set", "security=myorg/sec", "--add-root", "security=src"], {
      OPENCODE_CONFIG_DIR: globalDir,
    })
    expect(r.status).toBe(0)
    expect((r.stderr ?? "").toString()).toContain("security: modifyRoots is ignored")
    const cfg = JSON.parse(fs.readFileSync(path.join(globalDir, "opencode-agents.json"), "utf8")) as {
      agents: { security: { model: string; fallback: string; modifyRoots: string[] } }
    }
    expect(cfg.agents.security.model).toBe("myorg/sec")
    expect(cfg.agents.security.fallback).toBe("deepseek/deepseek-v4-pro")
    const security = fs.readFileSync(path.join(globalDir, "agent", "security.md"), "utf8")
    expect(security).toContain("model: myorg/sec")
    expect(security).toContain("SECURITY-VERDICT")
    // The modifyRoots allow renders, but the template guard wins (guards LAST).
    const editGroup = security.slice(security.indexOf("\n  edit:\n"), security.indexOf("\n  bash:\n"))
    const allow = editGroup.indexOf('"src/**": allow')
    const deny = editGroup.indexOf('"*": deny')
    expect(allow).toBeGreaterThan(-1)
    expect(deny).toBeGreaterThan(allow)
    const twin = fs.readFileSync(path.join(globalDir, "agent", "security-fallback.md"), "utf8")
    expect(twin).toContain("model: deepseek/deepseek-v4-pro")
    expect(twin).toContain('"src/**": allow')
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
