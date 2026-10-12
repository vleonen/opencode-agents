import os from "node:os"
import path from "node:path"

export type Scope = "global" | "project"

export interface Env {
  OPENCODE_CONFIG_DIR?: string
  XDG_CONFIG_HOME?: string
  [key: string]: string | undefined
}

export interface Targets {
  scope: Scope
  /** Directory the agent Markdown files are installed into. */
  agentDir: string
  /** AGENTS.md the policy block is merged into. */
  agentsMdPath: string
  /** opencode-agents.json written/read for this scope. */
  configPath: string
}

function clean(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v.trim() : undefined
}

/** Global OpenCode config dir: $OPENCODE_CONFIG_DIR → $XDG_CONFIG_HOME/opencode → ~/.config/opencode. */
export function resolveGlobalConfigDir(env: Env = process.env, homedir: string = os.homedir()): string {
  const explicit = clean(env.OPENCODE_CONFIG_DIR)
  if (explicit) return explicit
  const xdg = clean(env.XDG_CONFIG_HOME)
  if (xdg) return path.join(xdg, "opencode")
  return path.join(homedir, ".config", "opencode")
}

/**
 * Resolve install targets for a scope.
 *
 * global:  <configDir>/agent  +  <configDir>/AGENTS.md      +  <configDir>/opencode-agents.json
 * project: <project>/.opencode/agents + <project>/AGENTS.md + <project>/.opencode/opencode-agents.json
 */
export function resolveTargets(opts: {
  scope: Scope
  projectDir?: string
  env?: Env
  homedir?: string
}): Targets {
  if (opts.scope === "project") {
    if (!opts.projectDir) throw new Error("project scope requires a project directory")
    const base = path.join(opts.projectDir, ".opencode")
    return {
      scope: "project",
      agentDir: path.join(base, "agents"),
      agentsMdPath: path.join(opts.projectDir, "AGENTS.md"),
      configPath: path.join(base, "opencode-agents.json"),
    }
  }
  const configDir = resolveGlobalConfigDir(opts.env ?? process.env, opts.homedir)
  return {
    scope: "global",
    agentDir: path.join(configDir, "agent"),
    agentsMdPath: path.join(configDir, "AGENTS.md"),
    configPath: path.join(configDir, "opencode-agents.json"),
  }
}
