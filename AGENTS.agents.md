# Reusable subagents (opencode-agents)

This setup provides three subagents plus a same-behavior fallback twin for
each. The twins exist so a provider-side failure — quota, rate limit, exhausted
balance, or an unavailable model — does not block the task.

| Subagent | Role | Fallback twin |
|---|---|---|
| `designer` | Turns a request into an implementation-ready design brief (read-only) | `designer-fallback` |
| `qa` | Runs and maintains test/benchmark harnesses | `qa-fallback` |
| `reviewer` | Reviews changes for bugs, style, and security | `reviewer-fallback` |

## Subagent model fallback

Some subagents are pinned to one model. If `designer`, `qa`, or `reviewer`
fails to complete because its provider returned an error — quota/rate limit
(429, "5-hour limit reached"), insufficient balance, or model unavailable —
retry the same task once with the matching twin:

- designer -> designer-fallback
- qa       -> qa-fallback
- reviewer -> reviewer-fallback

Retry at most once per task. If the twin also fails, stop and report the error.
Do not fall back for ordinary task failures (failing tests, review findings,
bugs): those are real results, not provider errors.
