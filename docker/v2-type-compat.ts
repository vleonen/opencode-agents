// Scratch-only type-compatibility guard (never imported by the plugin, never
// shipped): fails docker/typecheck.sh if the structural v2 context types in
// src/index.ts drift from the real `@opencode/plugin` SDK types.
import type { Plugin as PluginV2 } from "@opencode/plugin"

import type { AgentsV2Context } from "./src/index.js"

// The real v2 Context must remain assignable to our structural view.
declare const realCtx: PluginV2.Context
const _ctxAssign: AgentsV2Context = realCtx

// Our helpers that read the context accept the real context.
async function _useModelList(c: AgentsV2Context): Promise<number> {
  if (!c.model?.list) return 0
  const output = await c.model.list()
  return output.data?.length ?? 0
}
const _useOk: Promise<number> = _useModelList(realCtx)

// The cleanup a setup returns matches the SDK's Cleanup shape.
type _cleanupFits = { (): void } extends PluginV2.Cleanup ? true : never

export { _cleanupFits, _ctxAssign, _useOk }
