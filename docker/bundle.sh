#!/usr/bin/env bash
# Build the container-mountable bundles into docker/.out:
#
#   .out/opencode-agents.js    server plugin bundle (relative + node builtins only)
#   .out/opencode-agents.mjs   CLI bundle
#
# The plugin has no runtime SDK imports, so a single ESM bundle loads under both
# opencode V1 and V2.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_DIR/docker/.out"
rm -rf "$OUT"
mkdir -p "$OUT"

COMMON=(--bundle --format=esm --target=es2022 --legal-comments=none --platform=node)

npx esbuild "$REPO_DIR/src/index.ts" "${COMMON[@]}" --outfile="$OUT/opencode-agents.js"
npx esbuild "$REPO_DIR/bin/init.ts" "${COMMON[@]}" --outfile="$OUT/opencode-agents.mjs"

# Guard: every bare import in the plugin bundle must be a node builtin.
bad=$(grep -oE '(from ?|import ?\()"[^"]+"' "$OUT/opencode-agents.js" \
  | sed -E 's/^[^"]*"//; s/"$//' | sort -u | grep -v '^\.' | grep -v '^node:' || true)
if [ -n "$bad" ]; then
  echo "FAIL: bare imports outside node:* in the plugin bundle:" >&2
  printf '%s\n' "$bad" >&2
  exit 1
fi

echo "bundles written to $OUT"
