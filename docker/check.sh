#!/usr/bin/env bash
# Live verification of opencode-agents against both opencode runtimes inside the
# docker/compose.yaml containers (mirrors opencode-session-tags/docker/check.sh).
#
#   V1 (opencode 1.18.x `web`): server auth, plugins load after a session is
#                               touched, agents + AGENTS.md policy installed.
#   V2 (opencode 2.x `serve`):  plugin listed active, agents + policy installed.
#
# Usage: docker/check.sh
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
COMPOSE="docker compose -f $DOCKER_DIR/compose.yaml"
PASS=0
FAIL=0

ok() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

AGENTS=(designer designer-fallback qa qa-fallback reviewer reviewer-fallback)

cd "$REPO_DIR"
[ -d node_modules ] || npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null
bash "$DOCKER_DIR/bundle.sh" >/dev/null
$COMPOSE up -d --force-recreate --build >/dev/null

# Poll a URL until it answers 200 (or give up after ~3 min).
wait_http() { # wait_http <curl args...>
  local code=000
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 2 "$@" 2>/dev/null || true)
    [ "$code" = "200" ] && { echo 200; return 0; }
    sleep 2
  done
  echo "$code"
  return 1
}

# Assert the plugin's side effects on disk (deterministic, unlike log ordering).
check_files() { # check_files <service>
  local svc="$1"
  local listing
  listing=$($COMPOSE exec -T "$svc" sh -c 'ls /root/.config/opencode/agent 2>/dev/null' || true)
  local a
  for a in "${AGENTS[@]}"; do
    if printf '%s\n' "$listing" | grep -qx "$a.md"; then ok "$svc installed $a"; else bad "$svc installed $a"; fi
  done
  if $COMPOSE exec -T "$svc" grep -q 'BEGIN opencode-agents' /root/.config/opencode/AGENTS.md 2>/dev/null; then
    ok "$svc AGENTS.md policy block"
  else
    bad "$svc AGENTS.md policy block"
  fi
}

echo "== V1 (opencode 1.18.x web) =="
V1_CODE=$(wait_http -u opencode:agents-test http://127.0.0.1:15196/config) \
  && ok "v1 server answers + basic auth ($V1_CODE)" || bad "v1 server answers + basic auth (got $V1_CODE)"

# Touch a session so the server discovers and runs the location's plugins.
curl -s -m 8 -u opencode:agents-test -X POST http://127.0.0.1:15196/session \
  -H 'Content-Type: application/json' -d '{"title":"agents-check-v1"}' -o /dev/null || true
sleep 6
check_files v1

if [ "$($COMPOSE logs v1 2>&1 | grep -ciE 'plugin export is not a function|opencode-agents.*(error|failed)')" = "0" ]; then
  ok "v1 loader had no plugin errors"
else
  bad "v1 loader had no plugin errors"
fi

echo "== V2 (opencode 2.x serve) =="
read_v2_pw() {
  $COMPOSE exec -T v2 cat /root/.local/state/opencode/service.json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).password||"")}catch(e){}})'
}
V2_PW=""
for _ in $(seq 1 90); do
  V2_PW=$(read_v2_pw)
  [ -n "$V2_PW" ] && [ "$(curl -s -o /dev/null -w "%{http_code}" -m 2 -u "opencode:$V2_PW" http://127.0.0.1:15296/api/info 2>/dev/null || true)" = "200" ] && break
  sleep 2
done
V2_AUTH="opencode:$V2_PW"
if [ "$(curl -s -o /dev/null -w "%{http_code}" -m 2 -u "$V2_AUTH" http://127.0.0.1:15296/api/info 2>/dev/null || true)" = "200" ]; then
  ok "v2 server answers + service auth"
else
  bad "v2 server answers + service auth"
fi

# Touching /api/plugin lazily loads the location's plugins.
curl -s -m 8 -u "$V2_AUTH" http://127.0.0.1:15296/api/plugin -o /dev/null || true
sleep 5

V2_STATE=$(curl -s -m 8 -u "$V2_AUTH" http://127.0.0.1:15296/api/plugin \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const p=(j.data||[]).find(x=>x.id==="opencode-agents");process.stdout.write(p?((p.state&&p.state.status)||"present"):"missing")}catch(e){process.stdout.write("parse-error")}})' 2>/dev/null || echo "")
if [ "$V2_STATE" = "active" ]; then ok "v2 plugin listed as active"; else bad "v2 plugin listed as active (got: $V2_STATE)"; fi

check_files v2

if [ "$($COMPOSE logs v2 2>&1 | grep -ciE 'plugin export is not a function|opencode-agents.*(error|failed)')" = "0" ]; then
  ok "v2 loader had no plugin errors"
else
  bad "v2 loader had no plugin errors"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
