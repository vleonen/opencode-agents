// Build the opencode-agents CLI to a single Node-ESM file.
// The plugin entrypoint (src/index.ts) is loaded directly by opencode and is
// not bundled here. The `#!/usr/bin/env node` shebang comes from bin/init.ts
// and esbuild hoists it to the top of the output, so no banner is needed.
import { build } from "esbuild"

await build({
  entryPoints: ["bin/init.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/bin.mjs",
})
