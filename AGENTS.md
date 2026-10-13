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
  `{{FALLBACK_RULES}}`. `renderTemplates` throws if any `{{` survives.

## Layout

| Path | Role |
|---|---|
| `src/index.ts` | Plugin entrypoint — loaded **directly** by OpenCode, not bundled. |
| `bin/init.ts` | CLI (`init` / `inspect` / `uninstall`); bundled to `dist/bin.mjs`. |
| `src/core/` | Install/uninstall/inspect, scopes, config parse, policy render + merge, manifest, templates. |
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
- The policy block is delimited by `<!-- BEGIN opencode-agents -->` /
  `<!-- END opencode-agents -->`; `upsertPolicy`/`stripPolicy` must stay idempotent and
  repair malformed or duplicated markers without data loss.
- A role may be **primary-only** (no `fallback`): `renderTemplates` omits its
  `-fallback.md`, `renderPolicy` drops it from the policy table and rules, and an old
  twin is reported `orphaned` and left on disk — still a live `mode: subagent` agent,
  reused when a fallback is set again. `--set <role>.fallback=` clears it;
  `twinMode`/`twinHidden` are ignored (warned) without a fallback.
- `install` derives the `AGENTS.md` policy from the config via `renderPolicy`
  (`{{FALLBACK_TABLE_ROWS}}`/`{{FALLBACK_RULES}}`); when no role has a fallback it
  removes the block instead of writing an empty one.
- `AGENTS.agents.md` is a **build-time policy template**, not an auto-loaded
  instruction file. OpenCode V2 loads only `AGENTS.md`; `instructions` entries are not
  resolved.
- The fallback is orchestrator guidance written into `AGENTS.md`, not runtime-enforced;
  it applies only *between* subagent launches and is one hop.
