# AGENTS.md

Contributor guide for the `opencode-agents` repo: an OpenCode **plugin + CLI** that
installs up to six agent files (`designer`, `qa`, `reviewer` and, per role, an
optional `-fallback` twin) into a global or project scope and merges a fallback
policy block into `AGENTS.md`.

Pure Node ESM, zero runtime deps, no CI. Node >= 20 (build targets `node20`).
`README.md` is the user-facing reference; keep it in sync when behavior changes.

## Source of truth and codegen

- `agents/*.md` and `AGENTS.agents.md` are hand-edited templates.
- `src/generated/agents.ts` is **generated and committed** by `scripts/gen-agents.mjs` —
  never edit by hand.
- After changing any template: `npm run gen`. `npm test` (via
  `tests/generated.test.ts`) and `prepack` fail when the generated module is stale.
- Order after a template edit: `npm run gen` → `npm run typecheck` → `npm test`.
- Render-time placeholders: `{{MODEL}}`, `{{FALLBACK_MODEL}}`, `{{TWIN_MODE}}`,
  `{{TWIN_HIDDEN}}`, `{{PERMISSION_OVERRIDES}}`; policy: `{{FALLBACK_TABLE_ROWS}}`,
  `{{FALLBACK_RULES}}` (both only inside the optional fallback section, after the
  `<!-- fallback-section -->` sentinel in `AGENTS.agents.md`). `renderTemplates`
  throws if any `{{` survives.
- Templates author permission rules in the V2 array shape; `renderTemplates`
  rewrites the frontmatter to a **V1-native `permission:` map** (`shell`→`bash`,
  `subagent`→`task`, `write`/`patch`→`edit`) so both runtimes honor it (V2
  translates the legacy frontmatter via `ConfigMigrateV1.migrateAgent`). Never
  emit a `permissions:` array: V1 would ignore it and V2 would treat it as a
  provider request option. `docker/check.sh` asserts the rules on both runtimes,
  and `tests/templates.test.ts` guards against a `permissions:` regression.
- `agents.<role>.modifyRoots` (project-relative directories) renders `edit`
  allow rules *before* `permissions`, so explicit rules win. Edit permission
  resources are **worktree-relative** in both runtimes (V2
  `FileAccess.resolve`, V1 `path.relative(worktree, filePath)`), so `~`/absolute
  entries never match — `configWarnings` flags them and `.` maps to `**`. Mind
  the wildcard `*`→`.*`: `**` also matches external absolute resources.
- `bin/init.ts` prompts only when stdin is a TTY and `--non-interactive` is
  absent: scope (fresh `init` with no project config and no `--scope`), models,
  then qa's `modifyRoots`. The pure parsers live in `src/core/input.ts` and are
  unit-tested; a non-interactive fresh `init` with no `--scope` still defaults to
  global and prints a hint when the directory looks like a project.

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Plugin entrypoint — loaded **directly** by OpenCode, not bundled. |
| `bin/init.ts` | CLI (`init` / `inspect` / `uninstall`); bundled to `dist/bin.mjs`. |
| `src/core/` | Install/uninstall/inspect, scopes, config + CLI-input parse, policy render + merge, manifest, templates. |
| `agents/`, `AGENTS.agents.md` | Template sources (see above). |
| `docker/` | Verification harnesses (not shipped). |
| `tests/` | Vitest; each test isolates via a temp `OPENCODE_CONFIG_DIR`. |

`ROLES` in `src/core/config.ts` is the single list of agent roles.

## Commands

```bash
npm install
npm run gen          # regenerate src/generated/agents.ts
npm run gen:check    # fail if the generated module is stale
npm run typecheck
npm test             # vitest run
npx vitest run tests/install.test.ts   # single file
npx vitest run -t "is idempotent on re-run"  # single test
npm run build        # bundle the CLI to dist/bin.mjs
```

Docker verification (needs Docker + network; containers install opencode
1.18.31 and 2.0.16 from opencode.ai — these are the only integration checks):

```bash
bash docker/bundle.sh            # build mountable bundles into docker/.out
bash docker/typecheck.sh         # strict SDK type-compat in a scratch copy
bash docker/check.sh             # live V1 + V2 load/install checks
bash docker/check-visibility.sh  # twin mode/hidden behavior on v2
```

## Non-obvious constraints

- The plugin must have **no runtime `@opencode/plugin` import** and no bare imports
  besides `node:*`; `docker/bundle.sh` fails otherwise. SDK types are structural on
  purpose, and `docker/v2-type-compat.ts` fails the build if they drift.
- `src/index.ts` must keep a plain-object default export; every other runtime export
  must be a function or type-only, or the OpenCode 1.x loader aborts. It must support
  both V1 (`server`) and V2 (`setup`) shells — `isV2Context` routes between them.
- Ownership: install records `filename -> sha256` in
  `<agentDir>/.opencode-agents.manifest.json`. Unowned files are skipped unless
  `--force`; `--adopt` takes over byte-identical files; `uninstall` removes only files
  whose hash still matches, so user edits survive. Do not bypass the manifest.
- Scopes: global = `<configDir>/agent` + `AGENTS.md` + `opencode-agents.json`;
  project = `<proj>/.opencode/agents` + `<proj>/AGENTS.md` + `<proj>/.opencode/opencode-agents.json`.
  `configDir` resolves `$OPENCODE_CONFIG_DIR` → `$XDG_CONFIG_HOME/opencode` → `~/.config/opencode`.
- The policy block is delimited by line-anchored `<!-- BEGIN opencode-agents -->`
  and `<!-- END opencode-agents -->` markers; `upsertPolicy`/`stripPolicy` must stay
  idempotent and repair malformed or duplicated markers without data loss. A
  marker only counts as such on its own line, so docs that *mention* the markers
  (like this file) are never mistaken for a policy block.
- A role may be **primary-only** (no `fallback`): `renderTemplates` omits its
  `-fallback.md`, `renderPolicy` drops it from the policy's fallback table and
  rules (it stays in the agent-roles section), and an old twin is reported
  `orphaned` and left on disk — still a live `mode: subagent` agent, reused when a
  fallback is set again. `--set <role>.fallback=` clears it; `twinMode`/`twinHidden`
  are ignored (warned) without a fallback.
- `renderPolicy` always writes the agent-roles section (the agents are always
  installed) and appends the fallback section — split from `AGENTS.agents.md` at
  `<!-- fallback-section -->` — only when at least one role has a fallback.
- `AGENTS.agents.md` is a **build-time policy template**, not an auto-loaded
  instruction file. OpenCode V2 loads only `AGENTS.md`; `instructions` entries are not
  resolved.
- The fallback is orchestrator guidance written into `AGENTS.md`, not runtime-enforced;
  it applies only *between* subagent launches and is one hop.
