/**
 * docker/probe-plugin/index.ts
 *
 * Verification-only probe (never shipped). A v2 directory/single-file plugin
 * that logs what the server exposes about agent visibility and the model-facing
 * tool catalog, so docker/check-visibility.sh can assert it.
 *
 * Logs (prefixed `[agents-probe]`, visible in `docker compose logs`):
 *   tools-at-setup         ids registered when the plugin loads
 *   prompt-agents          parsed @-mentions on prompt admission
 *   context-tool-ids       tool ids materialized for a model request
 *   context-subagent-tool  the model-facing `subagent` tool definition
 *
 * No runtime SDK imports: types are structural.
 */
type Logger = (label: string, value: unknown) => void

function log(label: string, value: unknown): void {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value)
    console.log(`[agents-probe] ${label} ${text}`)
  } catch {
    /* logging must never throw */
  }
}

interface ProbeContext {
  tool?: { list?: () => Promise<readonly { id?: string }[]> }
  session?: {
    hook?: (
      name: string,
      callback: (event: Record<string, unknown>) => void,
    ) => Promise<unknown>
  }
}

export default {
  id: "agents-probe",
  async setup(input: unknown): Promise<() => void> {
    const ctx = (input ?? {}) as ProbeContext
    const logFn: Logger = log

    try {
      const tools = await ctx.tool?.list?.()
      if (tools) logFn("tools-at-setup", tools.map((t) => t.id ?? null))
    } catch (err) {
      logFn("tools-at-setup-error", err instanceof Error ? err.message : String(err))
    }

    try {
      await ctx.session?.hook?.("prompt", (event) => {
        const prompt = (event as { prompt?: { text?: string; agents?: unknown } }).prompt
        logFn("prompt-agents", prompt?.agents ?? null)
        logFn("prompt-text", prompt?.text ?? "")
      })
    } catch (err) {
      logFn("prompt-hook-error", err instanceof Error ? err.message : String(err))
    }

    try {
      await ctx.session?.hook?.("context", (event) => {
        const e = event as { agent?: string; tools?: Record<string, unknown> }
        const tools = e.tools ?? {}
        logFn("context-agent", e.agent ?? null)
        logFn("context-tool-ids", Object.keys(tools))
        logFn("context-subagent-tool", tools.subagent ?? null)
      })
    } catch (err) {
      logFn("context-hook-error", err instanceof Error ? err.message : String(err))
    }

    return () => {}
  },
}
