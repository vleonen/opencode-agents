#!/usr/bin/env bash
# Strict typecheck of the plugin in an isolated scratch copy, plus
# docker/v2-type-compat.ts, which fails the build if the structural v2 context
# types in src/index.ts drift from the real `@opencode/plugin` SDK types.
#
# Pins typescript@5 and both SDK generations (@opencode-ai/plugin,
# @opencode/plugin) and requires --moduleResolution bundler.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${TMPDIR:-/tmp}/opencode-agents-typecheck"
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"

# Copy the package sources (not node_modules/.git/docker/.out/dist).
{
  cd "$REPO_DIR"
  find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./docker -prune -o \
    -path ./docker/.out -prune -o -path ./dist -prune -o -type f -print
} | while read -r f; do
  mkdir -p "$SCRATCH/$(dirname "$f")"
  cp "$REPO_DIR/$f" "$SCRATCH/$f"
done
cp "$REPO_DIR/docker/v2-type-compat.ts" "$SCRATCH/"
cd "$SCRATCH"

npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null

npx tsc --noEmit --strict --skipLibCheck \
  --module esnext --moduleResolution bundler --target es2022 --types node \
  src/index.ts \
  src/core/util.ts src/core/paths.ts src/core/config.ts src/core/discover.ts \
  src/core/docs.ts src/core/manifest.ts src/core/templates.ts src/core/install.ts \
  src/generated/agents.ts \
  bin/init.ts \
  v2-type-compat.ts

echo "typecheck OK (plugin + core + CLI + v2 SDK type-compat)"
