# Reusable subagents (opencode-agents)

This setup provides subagents and, where configured, a same-behavior fallback
twin on a different model provider, so a provider-side failure — quota, rate
limit, exhausted balance, or an unavailable model — does not block the task.

| Subagent | Fallback twin |
|---|---|
{{FALLBACK_TABLE_ROWS}}

## Subagent model fallback

If a subagent listed above fails to complete because its provider returned an
error — quota/rate limit (429, "5-hour limit reached"), insufficient balance, or
model unavailable — retry the same task once with the matching twin:

{{FALLBACK_RULES}}

Retry at most once per task. If the twin also fails, stop and report the error.
Do not fall back for ordinary task failures (failing tests, review findings,
bugs): those are real results, not provider errors.
