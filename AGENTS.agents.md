# Reusable subagents (opencode-agents)

This setup installs five subagents — `designer`, `qa`, `reviewer`,
`planner`, and `security` — that handle design, review, test/benchmark,
autonomous planning, and security work.

## Agent roles

Invoke a subagent with the `subagent` tool (OpenCode V2) or the `task` tool
(V1), or by mentioning it (`@designer`, `@qa`, `@reviewer`, `@planner`,
`@security`). Delegate to them instead of doing everything inline.

### `designer` — design before code

Engage `@designer` before writing code for:
- a new feature or subsystem, or a change to an existing mechanism's shape
  (data structures, lock ordering, failure paths);
- a bug whose fix is structural rather than a local patch;
- any change that needs a design-document update.

It returns a brief: the chosen approach and rejected alternatives; touched data
structures, concurrency, and failure paths; proposed design-document changes
(proposals only — the primary agent applies them together with the code); and
the regression gate that would prove the behavior. Re-consult it if the approach
must change mid-flight.

### `reviewer` — review before finalizing

Invoke `@reviewer` before generating a commit message or otherwise finalizing
changes, and do not consider the work done until review passes with **zero
critical findings**. Fix the bugs and style regressions it reports first. The
reviewer also checks consistency with the project's design documents (when the
project keeps them): a code-vs-docs mismatch is a critical finding — fix the
code, or update the doc when the behavior change is intended.

### `qa` — tests, benchmarks, verification

Always engage `@qa` for test execution, benchmarking, and verification
pipelines. Do not run or refactor benchmarks with general tools while `@qa` is
available. Delegate when:
- **Before commit/PR:** run the full regression suite before declaring a feature
  or refactor complete.
- **Performance changes:** execute benchmarks and analyze metrics on
  critical-path changes.
- **Harness maintenance:** updates to test runners, mock infrastructure,
  environment configs, or pipeline wrappers.
- **Regression-test maintenance:** keep the suite green; after a bug fix,
  promote the reproducer into a permanent test where practical. If it is not
  practical (timing-, hardware-, or environment-dependent), record why rather
  than adding a flaky test.

The loop: delegate to `@qa`, act on its feedback, and repeat until it confirms
success with zero regressions.

### `planner` — autonomous batches; explicit invocation only

The planner runs multi-task batches on its own ("plan the next 4 hours of
work"): it maintains the backlog in `.opencode/plans/backlog.md`, dispatches
`designer` (design brief), `build` (implementation), `qa` (verification), and
`reviewer` (finalization) per task, and updates statuses as it goes.

Engage it **only when the user explicitly asks** (`@planner …`, "have the
planner …"). Never auto-delegate to `@planner` in the normal loop, and never
run it for ordinary single-task work — `designer`/`qa`/`reviewer` cover that.
When the user does engage it, hand over the goal and the budget in one message
and let it run; do not interrupt between tasks. The planner works in slices
and ends each turn with a `PLANNER-STATUS:` report: launch it in the
background for long batches; on `CONTINUE`, immediately re-invoke the same
planner session to continue the batch — do not wait for the user; on
`COMPLETE` or `BLOCKED`, stop looping and summarize for the user. Answer
mid-run progress questions by reading `.opencode/plans/backlog.md`, not by
pinging the planner. Note: dispatching implementation to `build` requires
`build` to be subagent-launchable — if a launch fails, set
`agents.build.mode: "all"` in opencode.jsonc.

### `security` — security review of the code base or a design; explicit invocation only

`@security` is the read-only security auditor. It reviews work as a whole,
never an individual commit or diff: the code base (or a subsystem) — attack
surface, trust boundaries, authorization, injection, secrets, dependencies,
configuration — or a feature's design document — security requirements,
abuse cases, missing controls. It returns evidence-cited findings
(`confirmed` with a severity, `needs-validation` with an exact open fact)
and a `SECURITY-VERDICT` line.

Engage it **only when the user explicitly asks** (`@security audit the code
base`, `@security review docs/design.md`). Never auto-delegate to it —
`reviewer` covers change-level review. For a whole code base, run it as a
procedure: ask for `map` first, then launch one `audit <area>` per mapped
area in parallel, then merge the reports. A `PASS` covers only what its
`coverage` line lists. Before fixing a critical or high finding, have a
fresh `@security verify SEC-n` try to refute it. Treat confirmed findings
as ordinary work: structural fixes go through `@designer` first, then `@qa`
and `@reviewer`. The auditor cannot run scanners or tests — when a finding
is `needs-validation`, run the check it names and hand back the result.

<!-- fallback-section -->
## Subagent model fallback

This setup provides a same-behavior fallback twin on a different model provider,
so a provider-side failure — quota, rate limit, exhausted balance, or an
unavailable model — does not block the task.

| Subagent | Fallback twin |
|---|---|
{{FALLBACK_TABLE_ROWS}}

If one of the subagents above fails to complete because its provider returned an
error — quota/rate limit (429, "5-hour limit reached"), insufficient balance, or
model unavailable — retry the same task once with the matching twin:

{{FALLBACK_RULES}}

Retry at most once per task. If the twin also fails, stop and report the error.
Do not fall back for ordinary task failures (failing tests, review findings,
bugs): those are real results, not provider errors.
