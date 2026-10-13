# Reusable subagents (opencode-agents)

This setup installs three subagents — `designer`, `qa`, and `reviewer` — that
handle design, review, and test/benchmark work.

## Agent roles

Invoke a subagent with the `subagent` tool (OpenCode V2) or the `task` tool
(V1), or by mentioning it (`@designer`, `@qa`, `@reviewer`). Delegate to them
instead of doing everything inline.

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
