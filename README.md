# opencode-agents

An [OpenCode](https://opencode.ai) **plugin + CLI** that ships a small bundle of
reusable subagents and installs them into the OpenCode configuration of your
choice — globally or per project.

| Subagent | Role | Fallback twin |
|---|---|---|
| `designer` | Turns a request into an implementation-ready design brief (read-only) | `designer-fallback` |
| `qa` | Runs and maintains test / benchmark harnesses | `qa-fallback` |
| `reviewer` | Reviews changes for bugs, style, and security | `reviewer-fallback` |

Each subagent has a same-behavior **fallback twin** on a different model
provider, so a provider-side failure (quota, rate limit, exhausted balance, or an
unavailable model) does not block the task.

## How it works

OpenCode V2 has no native per-agent model fallback: an agent's `model` is a
single `provider/model` reference, and a plugin cannot register new agents. This
package therefore:

1. installs the six agents as real Markdown files (so models and permissions work
   natively), and
2. merges a short **policy** into `AGENTS.md` telling the orchestrator to retry a
   task once with the `-fallback` twin when the primary agent fails on a
   *provider* error (never on ordinary task failures).

The plugin only **installs/heals**; the orchestrator performs the retry. This is
best-effort guidance, not runtime-enforced fallback.

## Install

### Plugin

```jsonc
// ~/.config/opencode/opencode.jsonc  (or a project opencode.jsonc)
{ "plugins": ["opencode-agents"] }
```

On load, the plugin reads `opencode-agents.json` (project first, then global) and
installs/heals the agents and the `AGENTS.md` policy block. It never prompts and
never uninstalls. If no config exists it logs a hint to run the CLI.

### CLI

```bash
opencode-agents init                 # interactive: pick models from `opencode models`
opencode-agents init --scope project --dir .
opencode-agents init --yes --set designer.model=zai-coding-plan/glm-5.3
opencode-agents inspect              # dry-run, no writes
opencode-agents uninstall            # remove owned files + policy + config
```

`init` writes `opencode-agents.json` and installs the six agents.

## CLI reference

| Flag | Meaning |
|---|---|
| `--scope global\|project` | Install target (default: existing config's scope, else `global`). |
| `--dir <path>` | Project directory for `--scope project` (default: cwd). |
| `--set <agent>[.<field>]=<model>` | Set a model. `<field>` is `model`/`primary` (default) or `fallback`. |
| `--config <file>` | Base JSON config to start from. |
| `--yes`, `-y`, `--non-interactive` | Never prompt; use defaults / flags. |
| `--force` | Overwrite files not owned by opencode-agents. |
| `--adopt` | Take ownership of existing files whose content already matches. |
| `--no-policy` | Skip the `AGENTS.md` policy block. |
| `--keep-config` | On `uninstall`, keep `opencode-agents.json`. |
| `--help`, `-h` | Show help. |

Re-running `init` reuses the existing config, so it does not reset your model
choices.

## Config file

`opencode-agents.json` (in the scope directory — see below):

```json
{
  "version": 1,
  "scope": "global",
  "agents": {
    "designer": { "model": "zai-coding-plan/glm-5.3", "fallback": "deepseek/deepseek-v4-pro" },
    "reviewer": { "model": "zai-coding-plan/glm-5.3", "fallback": "deepseek/deepseek-v4-pro" },
    "qa":       { "model": "zai-coding-plan/glm-5.3-flash", "fallback": "deepseek/deepseek-flash" }
  }
}
```

## Scopes

| Scope | Agents dir | Policy file | Config file |
|---|---|---|---|
| `global` (default) | `~/.config/opencode/agent` | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/opencode-agents.json` |
| `project` | `<project>/.opencode/agents` | `<project>/AGENTS.md` | `<project>/.opencode/opencode-agents.json` |

`$OPENCODE_CONFIG_DIR` overrides the global config dir; otherwise
`$XDG_CONFIG_HOME/opencode` then `~/.config/opencode`.

## Models and credentials

`init` lists the models registered in your OpenCode (`opencode models`). The
chosen provider must be authenticated on each machine (`opencode auth login
<provider>`). The CLI warns when a twin is not on an independent provider from
its primary, since a provider-wide limit would then fail both.

## Uninstall

`opencode-agents uninstall` removes the files it owns (tracked by hash in
`<agentsDir>/.opencode-agents.manifest.json`), the `AGENTS.md` policy block, and
`opencode-agents.json`. Files you edited after install are kept. Use
`--keep-config` to retain the config.

## Security notes

- `designer` is read-only (edit/shell/subagent denied).
- `reviewer` cannot run shell, but may edit files.
- `qa` is intentionally permissive (it patches test harnesses under `~/src` and
  `~/dev`). Its read-only shell allow-list is prefix-based on raw command text;
  commands such as `find`, `xargs`, `awk`, `sort`, and `timeout` can still mutate
  state despite being allow-listed, and `sudo /usr/local/bin/set-cpu-governor.sh`
  in its prompt needs its own allow rule to avoid a prompt. Review `agents/qa.md`
  before installing in a sensitive environment.

## Caveats

- OpenCode V2 loads **only** `AGENTS.md`; `instructions` entries are not resolved
  and `AGENTS.agents.md` here is a build-time template, not an auto-loaded file.
- Fallback is orchestrated via `AGENTS.md` guidance, not enforced by the
  runtime, and applies **between** subagent launches (a plugin cannot swap the
  model of an in-flight request).
- One hop only: if the twin's provider is also exhausted, there is no third rung.
- Each twin duplicates its primary's system prompt; edit both when prompts change
  (the manifest detects drift but does not sync it).

## Development

```bash
npm install
npm run gen            # regenerate src/generated/agents.ts from agents/*.md
npm run gen:check      # fail if the generated module is stale
npm run typecheck
npm test
npm run build          # bundle the CLI to dist/bin.mjs
bash docker/typecheck.sh   # strict SDK type-compat guard
bash docker/check.sh       # container verification on V1 + V2 opencode
```

`agents/*.md` and `AGENTS.agents.md` are the source of truth; `src/generated/agents.ts`
is generated by `scripts/gen-agents.mjs` and committed.

## License

MIT
