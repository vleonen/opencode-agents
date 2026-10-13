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
  if $COMPOSE exec -T "$svc" grep -q '## Agent roles' /root/.config/opencode/AGENTS.md 2>/dev/null; then
    ok "$svc AGENTS.md agent-roles guidance"
  else
    bad "$svc AGENTS.md agent-roles guidance"
  fi
}

# Assert V1 actually applied the V1 `permission:` map (not just installed files).
# The installed files are read by both runtimes, so a V2-only `permissions:`
# array would leave V1 with no rules at all.
check_v1_permission_map() { # check_v1_permission_map <role> <desc> <js-expr-over-has-and-leaked>
  local role="$1" desc="$2" expr="$3" json result
  json=$($COMPOSE exec -T v1 sh -c "cd /workspace && opencode-v1 debug agent $role 2>/dev/null" || true)
  result=$(printf '%s' "$json" | EXPR="$expr" node -e '
    let s = ""
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let a
      try { a = JSON.parse(s) } catch (e) { process.stdout.write("parse-error"); return }
      const rules = a.permission ?? []
      const has = (p, act) => rules.some((r) => r.permission === p && r.action === act)
      const matches = (p, act, pattern) => rules.some((r) => r.permission === p && r.action === act && r.pattern === pattern)
      const lastAction = (p) => { for (let i = rules.length - 1; i >= 0; i--) if (rules[i].permission === p) return rules[i].action; return undefined }
      const leaked = Boolean(a.options && a.options.permissions)
      try {
        const ok = new Function("has", "matches", "lastAction", "leaked", "return (" + process.env.EXPR + ")")(has, matches, lastAction, leaked)
        process.stdout.write(ok ? "ok" : "false")
      } catch (e) { process.stdout.write("expr-error:" + e.message) }
    })')
  if [ "$result" = "ok" ]; then ok "v1 $role: $desc"; else bad "v1 $role: $desc (got: $result)"; fi
}

echo "== V1 (opencode 1.18.x web) =="
V1_CODE=$(wait_http -u opencode:agents-test http://127.0.0.1:15196/config) \
  && ok "v1 server answers + basic auth ($V1_CODE)" || bad "v1 server answers + basic auth (got $V1_CODE)"

# Touch a session so the server discovers and runs the location's plugins.
curl -s -m 8 -u opencode:agents-test -X POST http://127.0.0.1:15196/session \
  -H 'Content-Type: application/json' -d '{"title":"agents-check-v1"}' -o /dev/null || true
sleep 6
check_files v1

check_v1_permission_map designer "edit/shell/subagent denied" \
  'has("edit","deny") && has("bash","deny") && has("task","deny") && !leaked'
check_v1_permission_map reviewer "shell denied" \
  'has("bash","deny") && !leaked'
check_v1_permission_map qa "shell gate + destructive guards applied" \
  'has("bash","ask") && has("bash","deny") && has("edit","ask") && !leaked'
check_v1_permission_map qa "modifyRoots rendered as an edit allow" \
  'matches("edit","allow","**") && !leaked'
check_v1_permission_map designer "read-only guard beats an edit grant" \
  'matches("edit","allow","**") && lastAction("edit") === "deny" && !leaked'

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

# V2 migrates the V1 `permission:` map onto native `permissions` (legacy frontmatter).
V2_AGENTS=$(curl -s -m 8 -u "$V2_AUTH" http://127.0.0.1:15296/api/agent || true)
check_v2_permission() { # check_v2_permission <role> <desc> <js-expr-over-has-and-lastEffect>
  local role="$1" desc="$2" expr="$3"
  if printf '%s' "$V2_AGENTS" | ROLE="$role" EXPR="$expr" node -e '
    let s = ""
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j
      try { j = JSON.parse(s) } catch (e) { process.exit(2) }
      const list = j.data || j
      const a = (list || []).find((x) => x.id === process.env.ROLE)
      const perms = (a && (a.permissions || a.permission)) || []
      const has = (action, resource, effect) =>
        perms.some((r) => r.action === action && r.resource === resource && r.effect === effect)
      const lastEffect = (action) => { for (let i = perms.length - 1; i >= 0; i--) if (perms[i].action === action) return perms[i].effect; return undefined }
      let ok = false
      try {
        ok = new Function("has", "lastEffect", "return (" + process.env.EXPR + ")")(has, lastEffect)
      } catch (e) { process.exit(2) }
      process.exit(ok ? 0 : 1)
    })'; then
    ok "v2 $role: $desc"
  else
    bad "v2 $role: $desc"
  fi
}
check_v2_permission designer "V1 permission map migrated -> edit denied" 'has("edit","*","deny")'
check_v2_permission designer "V1 permission map migrated -> shell denied" 'has("shell","*","deny")'
check_v2_permission designer "V1 permission map migrated -> subagent denied" 'has("subagent","*","deny")'
check_v2_permission reviewer "V1 permission map migrated -> shell denied" 'has("shell","*","deny")'
check_v2_permission qa "modifyRoots -> edit allowed" 'has("edit","**","allow")'
check_v2_permission designer "read-only guard beats an edit grant" 'has("edit","**","allow") && lastEffect("edit") === "deny"'

if [ "$($COMPOSE logs v2 2>&1 | grep -ciE 'plugin export is not a function|opencode-agents.*(error|failed)')" = "0" ]; then
  ok "v2 loader had no plugin errors"
else
  bad "v2 loader had no plugin errors"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
