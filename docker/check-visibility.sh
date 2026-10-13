#!/usr/bin/env bash
# Twin-visibility verification (Tiers 1-2) against opencode v2 in docker.
#
#   v2-subagent : twins configured mode: subagent  (expected: hidden from the
#                 agent selector, still in the subagent catalog, still launchable)
#   v2-hidden   : twins configured hidden: true    (expected: also dropped from
#                 the subagent catalog -> auto-fallback would break)
#
# Tier 1 (no model):  /api/agent reports mode/hidden; the TUI Tab-cycle filter
#                     `mode !== "subagent" && !hidden` excludes the twins.
# Tier 2 (no model):  an explicit `agents` attachment reaches the prompt hook and
#                     spawns a child session; the model-facing `subagent` tool
#                     catalog includes/excludes the twins per variant.
#
# Usage: docker/check-visibility.sh
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
COMPOSE="docker compose -f $DOCKER_DIR/compose.yaml"
PASS=0
FAIL=0

ok() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

TWINS=(designer-fallback qa-fallback reviewer-fallback)

cd "$REPO_DIR"
[ -d node_modules ] || npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null
bash "$DOCKER_DIR/bundle.sh" >/dev/null
$COMPOSE up -d --force-recreate --build v2-subagent v2-hidden >/dev/null

svc_port() { case "$1" in v2-subagent) echo 15297 ;; v2-hidden) echo 15298 ;; esac; }

read_pw() {
  $COMPOSE exec -T "$1" cat /root/.local/state/opencode/service.json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).password||"")}catch(e){}})'
}

agent_field() { # agent_field <json-file> <id> <field>
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const a=(j.data||[]).find(x=>x.id===process.argv[2]);process.stdout.write(a?String(a[process.argv[3]]):"MISSING")' "$1" "$2" "$3"
}

wait_log() { # wait_log <service> <pattern>  -> poll compose logs ~60s
  local svc="$1" pat="$2"
  for _ in $(seq 1 30); do
    if $COMPOSE logs "$svc" 2>&1 | grep -q "$pat"; then return 0; fi
    sleep 2
  done
  return 1
}

run_variant() { # run_variant <service> <expect-hidden:true|false>
  local svc="$1" expect_hidden="$2"
  local port pw base auth
  port=$(svc_port "$svc")
  echo "== $svc (expected twinHidden=$expect_hidden) =="

  pw=""
  for _ in $(seq 1 90); do
    pw=$(read_pw "$svc" || true)
    if [ -n "$pw" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 -u "opencode:$pw" "http://127.0.0.1:$port/api/info" 2>/dev/null || true)" = "200" ]; then break; fi
    sleep 2
  done
  if [ -z "$pw" ]; then bad "$svc server did not become ready"; return; fi
  base="http://127.0.0.1:$port"
  auth="opencode:$pw"

  # Touch /api/plugin so the location's plugins activate and install the agents.
  curl -s -m 8 -u "$auth" "$base/api/plugin" -o /dev/null || true
  sleep 5

  # --- Tier 1: /api/agent mode + hidden, and the Tab-cycle filter ----------
  local agents_json; agents_json=$(mktemp)
  curl -s -m 8 -u "$auth" "$base/api/agent" -o "$agents_json"
  local twin
  for twin in "${TWINS[@]}"; do
    local mode hidden
    mode=$(agent_field "$agents_json" "$twin" "mode" || true)
    hidden=$(agent_field "$agents_json" "$twin" "hidden" || true)
    if [ "$mode" = "subagent" ] && [ "$hidden" = "$expect_hidden" ]; then
      ok "$svc $twin mode=$mode hidden=$hidden"
    else
      bad "$svc $twin mode=$mode hidden=$hidden (want subagent/$expect_hidden)"
    fi
    # The TUI builds the Tab cycle with `mode !== "subagent" && !hidden`.
    if [ "$mode" != "subagent" ] && [ "$hidden" != "true" ]; then
      bad "$svc $twin appears in the agent selector"
    else
      ok "$svc $twin excluded from the agent selector"
    fi
  done
  rm -f "$agents_json"

  # --- Tier 2: mention attachment + child spawn + subagent catalog --------
  local sid
  sid=$(curl -s -m 8 -u "$auth" -X POST "$base/api/session" -H 'Content-Type: application/json' -d '{"title":"vis-check"}' \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.data&&j.data.id)||j.id||"")}catch(e){}})') || sid=""
  if [ -z "$sid" ]; then bad "$svc session create"; return; fi

  # An explicit `agents` attachment is how the TUI/desktop deliver an @mention.
  curl -s -m 8 -u "$auth" -X POST "$base/api/session/$sid/prompt" -H 'Content-Type: application/json' \
    -d '{"text":"do a job","agents":[{"name":"qa-fallback"}]}' -o /dev/null || true
  # Raw text mention (server does not parse this; the client resolves it).
  curl -s -m 8 -u "$auth" -X POST "$base/api/session/$sid/prompt" -H 'Content-Type: application/json' \
    -d '{"text":"@qa-fallback raw ping"}' -o /dev/null || true

  if wait_log "$svc" 'prompt-agents \[{"name":"qa-fallback"'; then
    ok "$svc agents attachment reaches the prompt hook (@qa-fallback)"
  else
    bad "$svc agents attachment reaches the prompt hook"
  fi

  if wait_log "$svc" 'You are a subagent spawned by another session'; then
    ok "$svc agents attachment spawns a child session"
  else
    bad "$svc agents attachment spawns a child session"
  fi

  wait_log "$svc" 'context-subagent-tool' || true
  local catalog; catalog=$($COMPOSE logs "$svc" 2>&1 | grep 'context-subagent-tool' | tail -1 || true)
  local listed=""
  for twin in "${TWINS[@]}"; do
    if printf '%s' "$catalog" | grep -q "$twin:"; then listed="$listed $twin"; fi
  done
  if [ "$expect_hidden" = "false" ]; then
    if [ "$(printf '%s' "$listed" | wc -w)" = "${#TWINS[@]}" ]; then
      ok "$svc all twins present in the model-facing subagent catalog"
    else
      bad "$svc twins missing from the subagent catalog:$listed"
    fi
  else
    if [ -z "$listed" ]; then
      ok "$svc hidden twins dropped from the subagent catalog (auto-fallback would break)"
    else
      bad "$svc hidden twins unexpectedly still in the catalog:$listed"
    fi
  fi
}

run_variant v2-subagent false
run_variant v2-hidden true

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
