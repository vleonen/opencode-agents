# opencode-agents

An [OpenCode](https://opencode.ai) **plugin + CLI** that ships a small bundle of
reusable subagents and installs them into the OpenCode configuration of your
choice — globally or per project.

| Subagent | Role | Fallback twin |
|---|---|---|
| `designer` | Turns a request into an implementation-ready design brief (read-only) | `designer-fallback` |
| `qa` | Runs and maintains test / benchmark harnesses | `qa-fallback` |
| `reviewer` | Reviews changes for bugs, style, and security | `reviewer-fallback` |
| `planner` | Plans and orchestrates multi-task batches — **user-invoked only**; tracks progress in `.opencode/plans/backlog.md` | `planner-fallback` |

Each subagent has a same-behavior **fallback twin** on a different model
provider, so a provider-side failure (quota, rate limit, exhausted balance, or an
unavailable model) does not block the task.

## How it works

Neither OpenCode V1 nor V2 has a native per-agent model fallback: an agent's
`model` is a single `provider/model` reference, and a plugin cannot register new
agents. This package therefore:

1. installs the agents as real Markdown files (so models and permissions work
   natively), and
2. merges a **policy** into `AGENTS.md` that (a) says when to run each subagent
   (`designer` before structural code, `reviewer` before finalizing, `qa` for
   tests/benchmarks) and (b) tells the orchestrator to retry a task once with the
   `-fallback` twin when the primary agent fails on a *provider* error (never on
   ordinary task failures). The `planner` is the exception: the policy forbids
   auto-delegating to it — it runs only on an explicit user request.

The plugin only **installs/heals**; the orchestrator follows the guidance. This
is best-effort, not runtime-enforced.

## Install

### Plugin

The plugin loads from the global or project plugin directory, or from config.
The config key differs by runtime:

```jsonc
// OpenCode V2: ~/.config/opencode/opencode.jsonc  (or a project opencode.jsonc)
{ "plugins": ["opencode-agents"] }

// OpenCode V1: the key is `plugin` (V1 warns on `plugins` and ignores it)
{ "plugin": ["opencode-agents"] }
```

On load, the plugin reads `opencode-agents.json` (project first, then global) and
installs/heals the agents and the `AGENTS.md` policy block. It never prompts and
never uninstalls. If no config exists it logs a hint to run the CLI.

V1 only auto-discovers **single-file** plugins from
`~/.config/opencode/plugins/*.{ts,js}`, and a config `["path", {options}]` tuple
was unreliable there. To use the plugin on V1, drop a single-file build into the
plugins directory (that is what `docker/check.sh` mounts) and pass options via
the `OPENCODE_AGENTS_*` environment variables.

### CLI

```bash
opencode-agents init                 # interactive: pick models from `opencode models`
opencode-agents init --scope project --dir .
opencode-agents init --yes --set designer.model=zai-coding-plan/glm-5.3
opencode-agents inspect              # dry-run, no writes
opencode-agents uninstall            # remove owned files + policy + config
```

`init` writes `opencode-agents.json` and installs the agents (eight files: four
roles plus their fallback twins).

## Set up in a new project

From the project root, run `init`:

```bash
opencode-agents init
```

In a terminal it asks, in order:

1. **Scope** — install into this project (`<proj>/.opencode/agents`) or globally.
2. **Models** — the primary/fallback model for each agent (defaults from
   `opencode models`).
3. **Directories** — the paths `qa` and `planner` may edit without approval
   (comma-separated; `.` = whole project; `none` to clear; blank keeps the
   default — planner ships `.opencode/plans`).

It then writes `<proj>/.opencode/opencode-agents.json`, installs the eight agent
files into `<proj>/.opencode/agents/`, and merges the subagent policy (agent
roles + model fallback) into `<proj>/AGENTS.md`. OpenCode discovers
`.opencode/agents/*.md` as project agents, so designer/qa/reviewer/planner (and
their twins) join the project's agent pipeline. A fresh project inherits your
global model choices.

Non-interactive equivalent (for CI or repeatable setup):

```bash
opencode-agents init --scope project --dir . --add-root qa=. --non-interactive
```

Add more directories or roles by repeating `--add-root <role>=<dir>`;
project-specific shell rules (a VM helper allow-list, a `sudo` exception, etc.)
go in the config's `permissions` array. Preview with
`opencode-agents inspect --scope project --dir .` and remove everything with
`opencode-agents uninstall --scope project --dir .`.

## CLI reference

| Flag | Meaning |
|---|---|
| `--scope global\|project` | Install target. A fresh interactive `init` asks; otherwise default: the existing config's scope, else `global`. |
| `--dir <path>` | Project directory for `--scope project` (default: cwd). |
| `--set <agent>[.<field>]=<model>` | Set a model. `<field>` is `model`/`primary` (default) or `fallback`. An empty `fallback` (e.g. `--set qa.fallback=`) clears the twin, making the agent primary-only. |
| `--add-root <agent>=<dir>` | Add a modification directory (`modifyRoots`). Project-relative; `.` = whole project. Repeatable. |
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
    "qa": { "model": "zai-coding-plan/glm-5.3-flash" },
    "planner": { "model": "zai-coding-plan/glm-5.3", "fallback": "deepseek/deepseek-v4-pro", "modifyRoots": [".opencode/plans"] }
  }
}
```

Config files are **forward-compatible**: an `agents` entry for a role your
installed version does not know yet (or that predates a newly added role) is
fine — absent roles are filled from defaults on load, while your explicit
choices are preserved verbatim. `init` reuses the existing config, so upgrading
never resets your model choices.

`fallback` is optional: omit it (or set it empty) for a **primary-only** agent.
Such a role renders only its primary agent, is omitted from the policy's
*fallback* table (it still appears in the agent-roles section), and an
already-installed twin is left in place and reported `orphaned` (so you can set a
fallback again later and it is reused). `twinMode` and `twinHidden` are ignored
without a fallback.

```json
{
  "agents": {
    "qa": { "model": "zai-coding-plan/glm-5.3-flash", "permissions": [
      { "action": "shell", "resource": "vm/vm-ssh.sh *", "effect": "allow" }
    ] }
  }
}
```

### Twin visibility

`twinMode` (optional, default `"subagent"`) and `twinHidden` (optional, default
`false`) control how the `-fallback` twins are registered:

| Field | Values | Effect |
|---|---|---|
| `twinMode` | `"subagent"` (default) / `"all"` | `subagent` keeps the twin out of the agent selector / Tab cycle while remaining launchable by the orchestrator and via `@twin`. `all` makes it selectable as a main agent too. |
| `twinHidden` | `false` (default) / `true` | Sets `hidden: true`, removing the twin from listings **and** the `@` autocomplete. The OpenCode docs also say hidden agents are dropped from the subagent catalog, which would break the automatic fallback — prefer `twinMode: "subagent"` and leave this `false` unless you invoke the twin by command. |

Prefer the default: `mode: subagent` hides a twin from selection without giving up
the fallback path. `hidden` additionally removes it from the `@` menu and is
therefore only advisable when you trigger the twin through a command.

### Permission overlays

`permissions` (optional, default `[]`) appends project/user rules to the bundled
template's `{{PERMISSION_OVERRIDES}}` slot — after the template's base rules and
before its final guards — for **both** the agent and its `-fallback` twin.
Because permission evaluation is last-match-wins, overlay rules override the
template's base allows, while the template **guards still win**: the `designer`
is always denied `edit`/`shell`/`subagent`, and the `reviewer` is always denied
`shell`; no overlay or `modifyRoots` entry can grant those. Malformed rules are
dropped defensively.

Rules use the V2 shape `{ "action", "resource", "effect" }` in
`opencode-agents.json`. The **installed** agent files render them as a
V1-native `permission:` map (`shell`→`bash`, `subagent`→`task`,
`write`/`patch`→`edit`), which both runtimes honor: V1 reads it directly, and V2
translates the legacy frontmatter to its native `permissions` array. This is why
the shipped guardrails apply on V1 as well as V2. Each tool key keeps the
original rule order, and a rule that repeats a resource keeps its last effect.

This is the supported way for a project to declare its own agent rules: put them
in a project-scoped `opencode-agents.json` (`--scope project`) and they are
re-rendered into the owned agent files on every install/heal, so an upgrade never
loses them. `opencode-agents uninstall` also never removes or rewrites anything
outside the files it owns.

A project can alternatively use native OpenCode config
(`<project>/.opencode/opencode.jsonc` with `agents.<id>.permissions`), which this
tool never touches; that is equivalent for permission rules but cannot be applied
to the twin without a second entry.

### Modification directories (`modifyRoots`)

`modifyRoots` (optional, default `[]`) lists the directories a role may edit
**without approval**, per agent. Each entry is a **project-relative** directory;
the installer renders it as an `edit` allow rule (`"src"` → `"src/**"`), and `.`
means the whole project (`"**"`). Entries render before the `permissions`
overlays, so an explicit `permissions` rule wins on conflict, and like
`permissions` they apply to both the agent and its `-fallback` twin. On the
read-only `designer`, `modifyRoots` is moot (its edit guard wins) and the CLI
warns — use `qa` (or another role) for edit autonomy. `planner` is the one role
that ships a non-empty default (`[".opencode/plans"]`), rendered after its
template's `edit "*": deny` gate so the plans directory stays writable while
everything else is denied; relocate or extend it with `--add-root
planner=<dir>`.

```json
{
  "agents": {
    "qa": { "model": "zai-coding-plan/glm-5.3-flash", "modifyRoots": ["src", "tests", "benchmark"] }
  }
}
```

This replaces the old shipping default that hard-coded `~/src/**` and `~/dev/**`
for `qa`: OpenCode matches `edit` permissions against a **worktree-relative**
path, so absolute or `~`-anchored patterns never matched. They are now dropped
with a warning — list the project directories you actually need.

Note: the wildcard engine treats `*` as matching across `/`, so `.` (`"**"`)
also matches absolute *external* resources; combined with `qa`'s
`external_directory: allow`, `.` therefore also stops prompting for edits outside
the project. For a strict project-only boundary, list explicit subdirectories
instead of `.`, or tighten `external_directory` to `ask`.

### The planner (`planner`)

The planner plans and runs **batches** of tasks unattended: one explicit user
invocation (`@planner plan the next 4 hours`) hands it a goal and a budget, and
it maintains the backlog in `.opencode/plans/backlog.md`, dispatching
`designer` → `build` → `qa` → `reviewer` per task and updating statuses as it
goes.

- **Explicit invocation only.** The installed `AGENTS.md` policy instructs the
  orchestrator never to auto-delegate to it; it is not part of the normal
  design/implement/verify loop. The description shipped in `planner.md` says the
  same, since subagent descriptions are what a launching model sees.
- **Write scope.** Shell is denied; edits are denied everywhere except its
  `modifyRoots` (default `.opencode/plans`). Project/user overlays can widen or
  narrow this per project.
- **Implementation dispatch targets `build`.** The built-in `build` agent is
  `mode: primary`, so it is not subagent-launchable until the user overrides it
  once in `opencode.jsonc`:
  `{ "agents": { "build": { "mode": "all" } } }` — `build` stays the default
  primary agent while becoming launchable. Until then the planner falls back to
  `general` and records the hint in the backlog.
- **Nested dispatch depth.** The planner launches its workers from inside a
  subagent, which requires `experimental.subagent_depth: 2` in `opencode.json`.
  The default of `1` means a subagent cannot start another subagent, so the
  planner's first dispatch fails with "Subagent depth limit reached". `2` is
  sufficient: the dispatch chain is one hop deep by design (`@planner` →
  worker), and nothing spawns deeper.
- **Context management.** The template defines `COMPACT_THRESHOLD = 50%` and
  `HARD_LIMIT = 70%`: at phase boundaries it flushes all resume state to the
  backlog file and compacts only above the threshold; mid-phase it finishes the
  current task only before flushing. The backlog, not the conversation, is the
  source of truth, so compaction (or a fresh context) is lossless. Both numbers
  are prose constants in `agents/planner.md` — edit and re-run `npm run gen` to
  change them.
- **Unattended runs** also need the implementing agent's edits to be permitted
  without prompts; `build`'s defaults allow workspace access, so this works
  without extra setup once `build` is launchable.

## Scopes

| Scope | Agents dir | Policy file | Config file |
|---|---|---|---|
| `global` (default) | `~/.config/opencode/agent` | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/opencode-agents.json` |
| `project` | `<project>/.opencode/agents` | `<project>/AGENTS.md` | `<project>/.opencode/opencode-agents.json` |

`$OPENCODE_CONFIG_DIR` overrides the global config dir; otherwise
`$XDG_CONFIG_HOME/opencode` then `~/.config/opencode`.

## Runtime support (V1 / V2)

The installed agents, the `AGENTS.md` policy, and the file/CLI machinery work on
both runtimes:

- **OpenCode V2** reads `plugins`, discovers `agent/`/`agents/` markdown, and
  translates the agents' legacy `permission:` frontmatter to its native
  `permissions` array.
- **OpenCode V1** reads `plugin`, discovers `agent/`/`agents/` markdown, and
  reads the `permission:` map directly — so the guardrails below apply there too.

One V2-only nuance: `twinMode: "all"` together with `twinHidden: true` (V1's
`hidden` only applies to `mode: subagent`). `docker/check.sh` asserts the
permission guardrails on both runtimes.

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
- `planner` cannot run shell and may edit only its `modifyRoots` (default
  `.opencode/plans`), but it **may launch subagents** — that is its job. It is
  invoked explicitly, never auto-delegated. It runs on the invoking session's
  permissions for anything its children do: `build`/`general` execute edits and
  (for `build`) workspace tools under their own defaults.
- `qa` is intentionally permissive. By default its edits prompt (the template
  gate is `edit: "*" ask`); declare the directories it may change without
  prompting via `modifyRoots` (project-relative). Its read-only shell allow-list
  is prefix-based on raw command text; commands such as `find`, `xargs`, `awk`,
  `sort`, and `timeout` can still mutate state despite being allow-listed, and
  `sudo /usr/local/bin/set-cpu-governor.sh` in its prompt needs its own allow rule
  to avoid a prompt. Review `agents/qa.md` before installing in a sensitive
  environment.

## Caveats

- OpenCode loads **only** `AGENTS.md` (V1 and V2); `instructions` entries are not
  resolved and `AGENTS.agents.md` here is a build-time template, not an
  auto-loaded file.
- Fallback is orchestrated via `AGENTS.md` guidance, not enforced by the
  runtime, and applies **between** subagent launches (a plugin cannot swap the
  model of an in-flight request).
- One hop only: if the twin's provider is also exhausted, there is no third rung.
- Each twin duplicates its primary's system prompt; edit both when prompts change
  (the manifest detects drift but does not sync it).
- A planner batch lives as long as the session that invoked it: close the
  session (or kill the server) mid-run and the run stops. The backlog file
  persists statuses and results, so the next `@planner` invocation resumes from
  it rather than starting over.

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
bash docker/check-visibility.sh  # twin visibility (mode: subagent vs hidden) on v2
```

`agents/*.md` and `AGENTS.agents.md` are the source of truth; `src/generated/agents.ts`
is generated by `scripts/gen-agents.mjs` and committed.

## License

MIT
