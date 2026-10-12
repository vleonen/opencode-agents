import path from "node:path"

import { type AgentsConfig, readConfig } from "./config"
import { type Env, resolveGlobalConfigDir } from "./paths"

export interface FoundConfig {
  config: AgentsConfig
  path: string
}

/**
 * Locate an existing config: project `<dir>/.opencode/opencode-agents.json` first,
 * then the global `<configDir>/opencode-agents.json`.
 */
export function findExistingConfig(opts: { projectDir?: string; env?: Env } = {}): FoundConfig | null {
  const env = opts.env ?? process.env
  if (opts.projectDir) {
    const projectPath = path.join(opts.projectDir, ".opencode", "opencode-agents.json")
    const project = readConfig(projectPath)
    if (project) return { config: project, path: projectPath }
  }
  const globalPath = path.join(resolveGlobalConfigDir(env), "opencode-agents.json")
  const global = readConfig(globalPath)
  if (global) return { config: global, path: globalPath }
  return null
}
