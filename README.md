# opencode-agents

An [OpenCode](https://opencode.ai) **plugin + CLI** that ships a small bundle of
reusable subagents and installs them into the OpenCode configuration of your
choice — globally or per project.

Each subagent has a same-behavior **fallback twin** on a different model
provider, so a provider-side failure (quota, rate limit, exhausted balance, or
an unavailable model) does not block the task.

| Subagent | Role | Fallback twin |
|---|---|---|
| `designer` | Turns a request into an implementation-ready design brief (read-only) | `designer-fallback` |
| `qa` | Runs and maintains test / benchmark harnesses | `qa-fallback` |
| `reviewer` | Reviews changes for bugs, style, and security | `reviewer-fallback` |

## Status

Phases 0-5 complete: package scaffolding + content assets, the installer core,
the interactive CLI, the V1/V2 plugin shell, and the test + type-compat +
container verification harness. Publishing/docs polish (Phase 6) and the
in-place install on this machine (Phase 7) remain.

### CLI

```bash
opencode-agents init                 # interactive: pick models from `opencode models`
opencode-agents init --scope project --dir .
opencode-agents init --yes --set qa.fallback=deepseek/deepseek-flash
opencode-agents inspect              # dry-run
opencode-agents uninstall            # remove owned files + policy + config
```

### Plugin

```jsonc
// ~/.config/opencode/opencode.jsonc
{ "plugins": ["opencode-agents"] }
```

On load the plugin reads `opencode-agents.json` (project first, then global) and
installs/heals the bundled agents and the `AGENTS.md` policy block. It never
prompts and never uninstalls.

Agent templates under `agents/` use the placeholders `{{MODEL}}` (primary) and
`{{FALLBACK_MODEL}}` (twin), substituted at install time from the chosen model
list.

## Why "fallback twins"

OpenCode V2 has no native per-agent model fallback: an agent's `model` is a
single provider/model reference, and a plugin cannot register new agents. This
package therefore installs real Markdown agents and registers a short policy in
`AGENTS.md` telling the orchestrator to retry once with the twin when the
primary fails on a provider error.

## License

MIT
