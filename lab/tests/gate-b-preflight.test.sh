#!/usr/bin/env bash
# Gate B preflight RED test suite.
#
# Covers the threat-matrix cases from the Gate B design:
#   - canonical `git -C` root passes; wrong relative and wrong absolute
#     selectors fail without mutation            (task 1.1)
#   - staged/dirty fixture fails; command spy rejects `commit -a`;
#     clean empty index passes                   (task 1.2)
#   - toolchain thresholds: Node >=20, pnpm >=9.15, green doctor
#     block below thresholds                     (task 2.2 evidence)
#
# Every test runs in a throwaway sandbox repository with a shimmed
# toolchain (fake node/pnpm/gentle-ai on PATH) so only the gate under
# test can fail. The real toolchain is never touched.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gate-b-preflight.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/gate-b-preflight.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

TESTS=0
FAILURES=0
SANDBOX_N=0

pass() { printf 'ok   - %s\n' "$1"; }
fail() { printf 'FAIL - %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

check_exit() { # check_exit <label> <expected> <actual>
  TESTS=$((TESTS + 1))
  if [ "$2" -eq "$3" ]; then
    pass "$1 (exit $3)"
  else
    fail "$1 (expected exit $2, got $3)"
  fi
}

# make_shims <dir> [node_ver] [pnpm_ver] [doctor_status]
make_shims() {
  local dir="$1" nver="${2:-v20.11.1}" pver="${3:-9.15.4}" dstatus="${4:-healthy}"
  mkdir -p "$dir"
  cat >"$dir/node" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then printf '%s\n' "$nver"; exit 0; fi
printf 'node shim\n'; exit 0
EOF
  cat >"$dir/pnpm" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then printf '%s\n' "$pver"; exit 0; fi
printf 'pnpm shim\n'; exit 0
EOF
  cat >"$dir/gentle-ai" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "doctor" ]; then
  printf 'gentle-ai doctor - system health check\n'
  printf 'Summary: 1 passed, 0 failed, 0 warnings\n'
  printf 'Status:  $dstatus\n'
  exit 0
fi
printf 'gentle-ai shim\n'; exit 0
EOF
  chmod +x "$dir/node" "$dir/pnpm" "$dir/gentle-ai"
}

# make_git_spy <dir> <logfile> — records every `git` invocation the
# script makes so the suite can assert no auto-commit ever happens.
make_git_spy() {
  local dir="$1" log="$2"
  mkdir -p "$dir"
  cat >"$dir/git" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$log"
exec /usr/bin/git "\$@"
EOF
  chmod +x "$dir/git"
}

# new_sandbox — creates a clean sandbox repo with the preflight script
# copied in, a seed commit, and a minimal manifest. Prints "path|seed".
# Identity constants are overridden to the seed commit so the tree
# identity gate is exercised, not skipped.
new_sandbox() {
  local sb
  sb="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  mkdir -p "$sb/lab/scripts"
  git -C "$sb" init -q
  git -C "$sb" config user.name "gate-b-test"
  git -C "$sb" config user.email "gate-b-test@example.com"
  printf '{\n  "schema": "lab-manifest/v1",\n  "source": {\n    "repository": "https://example.com/paperclip.git",\n    "approvedSha": "seed"\n  }\n}\n' >"$sb/lab/paperclip-lab.manifest.json"
  cp "$SCRIPT" "$sb/lab/scripts/gate-b-preflight.sh"
  chmod +x "$sb/lab/scripts/gate-b-preflight.sh"
  git -C "$sb" add -A >/dev/null
  git -C "$sb" commit -q -m "seed" >/dev/null
  local seed
  seed="$(git -C "$sb" rev-parse HEAD)"
  printf '%s|%s\n' "$sb" "$seed"
}

echo "== Gate B preflight RED suite =="

if [ ! -x "$SCRIPT" ]; then
  echo "FAIL - preflight script missing: $SCRIPT"
  echo ""
  echo "RED: no assertions can run until lab/scripts/gate-b-preflight.sh exists."
  exit 1
fi

GREEN_SHIMS="$TMP_ROOT/green-shims"
make_shims "$GREEN_SHIMS" "v20.11.1" "9.15.4" "healthy"

# --- 1.1 repo selection ------------------------------------------------
IFS='|' read -r SB1 SEED1 <<< "$(new_sandbox)"
TREE1="$(git -C "$SB1" rev-parse "$SEED1^{tree}")"

PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1"
check_exit "1.1a canonical git -C root passes" 0 $?

HEAD_BEFORE="$(git -C "$SB1" rev-parse HEAD)"
PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "." 2>/dev/null
check_exit "1.1b wrong relative selector fails" 1 $?
HEAD_AFTER="$(git -C "$SB1" rev-parse HEAD)"
if [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
  pass "1.1b no mutation on wrong relative selector"
else
  fail "1.1b mutated repo on wrong relative selector"
fi

IFS='|' read -r SB2 SEED2 <<< "$(new_sandbox)"
HEAD_BEFORE="$(git -C "$SB1" rev-parse HEAD)"
PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB2" 2>/dev/null
check_exit "1.1c wrong absolute selector fails" 1 $?
HEAD_AFTER="$(git -C "$SB1" rev-parse HEAD)"
if [ "$HEAD_BEFORE" = "$HEAD_AFTER" ]; then
  pass "1.1c no mutation on wrong absolute selector"
else
  fail "1.1c mutated repo on wrong absolute selector"
fi

# --- 1.2 commit state --------------------------------------------------
printf 'staged\n' >"$SB1/staged.txt"
git -C "$SB1" add staged.txt
PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" 2>/dev/null
check_exit "1.2a staged fixture fails" 2 $?
git -C "$SB1" reset -q
rm -f "$SB1/staged.txt"

printf 'dirty\n' >>"$SB1/lab/paperclip-lab.manifest.json"
PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" 2>/dev/null
check_exit "1.2b dirty worktree fixture fails" 2 $?
git -C "$SB1" checkout -q -- lab/paperclip-lab.manifest.json

SPYDIR="$TMP_ROOT/spy"
SPYLOG="$TMP_ROOT/spy.log"
make_git_spy "$SPYDIR" "$SPYLOG"
: >"$SPYLOG"
PATH="$GREEN_SHIMS:$SPYDIR:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" >/dev/null 2>&1
if grep -qE 'commit .*--?all|commit .*-a([^-]|$)|add .*-A' "$SPYLOG"; then
  fail "1.2c command spy rejected auto-commit (forbidden invocation: $(grep -E 'commit .*--?all|commit .*-a([^-]|$)|add .*-A' "$SPYLOG" | head -1))"
else
  pass "1.2c command spy rejects commit -a / add -A"
fi
if [ -s "$SPYLOG" ]; then
  pass "1.2c git spy was exercised ($(wc -l <"$SPYLOG" | tr -d ' ') git calls)"
else
  fail "1.2c git spy saw no calls"
fi

PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1"
check_exit "1.2d clean empty index passes" 0 $?

# --- 2.2 evidence: toolchain thresholds --------------------------------
NODE18_SHIMS="$TMP_ROOT/node18-shims"
make_shims "$NODE18_SHIMS" "v18.19.0" "9.15.4" "healthy"
PATH="$NODE18_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" 2>/dev/null
check_exit "2.2a preflight blocks Node 18" 4 $?

PNPM14_SHIMS="$TMP_ROOT/pnpm14-shims"
make_shims "$PNPM14_SHIMS" "v20.11.1" "9.14.3" "healthy"
PATH="$PNPM14_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" 2>/dev/null
check_exit "2.2b preflight blocks pnpm 9.14" 5 $?

DOCTOR_RED_SHIMS="$TMP_ROOT/doctor-red-shims"
make_shims "$DOCTOR_RED_SHIMS" "v20.11.1" "9.15.4" "unhealthy"
PATH="$DOCTOR_RED_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" 2>/dev/null
check_exit "2.2c preflight blocks failing doctor" 6 $?

# --- evidence integrity: --json reports failed gates as fail -------------
PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" --json 2>/dev/null
check_exit "2.2d json mode passes on clean green sandbox" 0 $?

# A dirty worktree must surface as cleanState=fail in JSON, never pass.
printf 'dirty-json\n' >"$SB1/json-dirty.txt"
PATH="$GREEN_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" --json 2>/dev/null >"$TMP_ROOT/json-blocked.json"
JSON_EXIT=$?
rm -f "$SB1/json-dirty.txt"
check_exit "2.2e json mode fails on dirty worktree" 2 $JSON_EXIT
JSON_STATUS="$(sed -n 's/^[[:space:]]*"status":[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP_ROOT/json-blocked.json" | head -1)"
if [ "$JSON_STATUS" = "blocked" ]; then
  pass "2.2e json blocked status recorded"
else
  fail "2.2e json status is \"$JSON_STATUS\", expected blocked"
fi
JSON_CLEAN="$(sed -n 's/^[[:space:]]*"cleanState":[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP_ROOT/json-blocked.json" | head -1)"
if [ "$JSON_CLEAN" = "fail" ]; then
  pass "2.2e json cleanState=fail recorded"
else
  fail "2.2e json cleanState is \"$JSON_CLEAN\", expected fail"
fi

# A red doctor must surface as doctor=fail in JSON.
PATH="$DOCTOR_RED_SHIMS:$PATH" GATE_B_PINNED_SHA="$SEED1" GATE_B_EXPECTED_TREE="$TREE1" \
  "$SB1/lab/scripts/gate-b-preflight.sh" "$SB1" --json 2>/dev/null >"$TMP_ROOT/json-doctor.json"
check_exit "2.2f json mode blocks red doctor" 6 $?
JSON_DOCTOR="$(sed -n 's/^[[:space:]]*"doctor":.*"ok":[[:space:]]*\(true\|false\).*/\1/p' "$TMP_ROOT/json-doctor.json" | head -1)"
if [ "$JSON_DOCTOR" = "false" ]; then
  pass "2.2f json doctor.ok=false recorded"
else
  fail "2.2f json doctor.ok is \"$JSON_DOCTOR\", expected false"
fi

echo ""
echo "== Result: $((TESTS - FAILURES))/$TESTS passed, $FAILURES failed =="
if [ "$FAILURES" -gt 0 ]; then exit 1; fi
exit 0
