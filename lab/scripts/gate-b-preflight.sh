#!/bin/sh
# Gate B preflight — B1-R2 hard gate.
#
# Verifies, in order, before any merge/install/package mutation:
#   1. repository authority (canonical manifest root, fixed `git -C`,
#      no wrong relative/absolute selectors, no symlink drift)
#   2. clean worktree and index (never auto-commits; no `commit -a`)
#   3. pinned source commit and tree identity
#   4. Node  >= 20
#   5. pnpm  >= 9.15
#   6. green `gentle-ai doctor`
#
# Exits non-zero on the first failed gate so callers fail closed.
#
# Usage:
#   gate-b-preflight.sh [<repo-root>] [--json]
#
# Exit codes:
#   0  all gates pass
#   1  repository authority (root selection) failed
#   2  worktree or index is not clean
#   3  pinned SHA missing or tree identity mismatch
#   4  Node unavailable or below 20
#   5  pnpm unavailable or below 9.15
#   6  gentle-ai doctor missing, unparseable, or unhealthy
#
# Overrides (env): GATE_B_NODE_BIN, GATE_B_PNPM_BIN, GATE_B_DOCTOR_BIN,
#   GATE_B_PINNED_SHA, GATE_B_EXPECTED_TREE. Without overrides the
#   pinned SHA/tree are the Gate B canonical constants and binaries
#   resolve via PATH, falling back to the lab manifest declarations.
set -u

PINNED_SHA_DEFAULT="6a4e2e1b8c7129f6f913ae458ab0be9cba50bd6a"
EXPECTED_TREE_DEFAULT="43c60f4c1a0b1610070ce407addbed2482d9ee68"

JSON_MODE=0
ROOT_ARG=""
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=1 ;;
    *) ROOT_ARG="$arg" ;;
  esac
done

# --- path helpers -------------------------------------------------------
realpath_() {
  # Best-effort canonical path: resolves symlinks when possible.
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null && return 0
  fi
  (CDPATH= cd -P -- "$1" 2>/dev/null && pwd) || printf '%s' "$1"
}

emit_json() { # emit_json <status> <exit_code>
  printf '{\n'
  printf '  "status": "%s",\n' "$1"
  printf '  "exitCode": %s,\n' "$2"
  printf '  "repoRoot": "%s",\n' "$CANON_ROOT"
  printf '  "checks": {\n'
  printf '    "repositoryAuthority": "%s",\n' "$R_AUTHORITY"
  printf '    "cleanState": "%s",\n' "$R_CLEAN"
  printf '    "treeIdentity": "%s",\n' "$R_TREE"
  printf '    "node": { "bin": "%s", "version": "%s", "ok": %s },\n' "$NODE_BIN" "$NODE_VERSION" "$(bool_ "$R_NODE")"
  printf '    "pnpm": { "bin": "%s", "version": "%s", "ok": %s },\n' "$PNPM_BIN" "$PNPM_VERSION" "$(bool_ "$R_PNPM")"
  printf '    "doctor": { "bin": "%s", "status": "%s", "ok": %s }\n' "$DOCTOR_BIN" "$DOCTOR_STATUS" "$(bool_ "$R_DOCTOR")"
  printf '  }\n'
  printf '}\n'
}

bool_() { [ "$1" = "pass" ] && printf 'true' || printf 'false'; }

die() { # die <exit_code> <gate> <human_line>
  R_ALL=$1
  if [ "$JSON_MODE" -eq 1 ]; then emit_json "blocked" "$1"; else printf '%s\n' "$3" >&2; fi
  exit "$1"
}

# --- 0. canonical root --------------------------------------------------
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || exit 70
CANON_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." 2>/dev/null && pwd) || exit 70
CANON_ROOT=$(realpath_ "$CANON_ROOT")

R_AUTHORITY="pass"; R_CLEAN="pass"; R_TREE="pass"
R_NODE="pass"; R_PNPM="pass"; R_DOCTOR="pass"
NODE_BIN=""; NODE_VERSION=""; PNPM_BIN=""; PNPM_VERSION=""; DOCTOR_BIN=""; DOCTOR_STATUS=""
R_ALL=0

# --- 1. repository authority gate ---------------------------------------
if [ -n "$ROOT_ARG" ]; then
  CANDIDATE=$(realpath_ "$ROOT_ARG")
  if [ "$CANDIDATE" != "$CANON_ROOT" ]; then
    die 1 "repositoryAuthority" "FAIL gate 1: repo root \"$ROOT_ARG\" is not the canonical manifest root ($CANON_ROOT). Refusing to touch any other repository."
  fi
fi
if [ ! -d "$CANON_ROOT/.git" ]; then
  die 1 "repositoryAuthority" "FAIL gate 1: $CANON_ROOT is not a git repository."
fi
if [ ! -f "$CANON_ROOT/lab/paperclip-lab.manifest.json" ]; then
  die 1 "repositoryAuthority" "FAIL gate 1: lab/paperclip-lab.manifest.json missing at $CANON_ROOT."
fi
printf '%s\n' "ok   gate 1: repository authority ($CANON_ROOT)"

# --- 2. clean state gate -------------------------------------------------
STATUS_OUT=$(git -C "$CANON_ROOT" status --porcelain 2>&1) || die 2 "cleanState" "FAIL gate 2: cannot read git status."
if [ -n "$STATUS_OUT" ]; then
  printf '%s\n' "FAIL gate 2: worktree/index not clean (staged, modified, or untracked files)." >&2
  printf '%s\n' "$STATUS_OUT" >&2
  die 2 "cleanState" "Refusing to proceed with a dirty worktree. This script never stages or commits."
fi
printf '%s\n' "ok   gate 2: clean worktree and index"

# --- 3. tree identity gate ----------------------------------------------
PINNED_SHA="${GATE_B_PINNED_SHA:-$PINNED_SHA_DEFAULT}"
EXPECTED_TREE="${GATE_B_EXPECTED_TREE:-$EXPECTED_TREE_DEFAULT}"
ACTUAL_TREE=$(git -C "$CANON_ROOT" rev-parse --verify --quiet "${PINNED_SHA}^{tree}") || true
if [ -z "$ACTUAL_TREE" ]; then
  die 3 "treeIdentity" "FAIL gate 3: pinned SHA $PINNED_SHA not reachable in $CANON_ROOT."
fi
if [ "$ACTUAL_TREE" != "$EXPECTED_TREE" ]; then
  die 3 "treeIdentity" "FAIL gate 3: tree identity mismatch — expected $EXPECTED_TREE, got $ACTUAL_TREE for $PINNED_SHA."
fi
printf '%s\n' "ok   gate 3: tree identity ($ACTUAL_TREE)"

# --- 4. Node >= 20 --------------------------------------------------------
# Resolve: env override -> PATH -> manifest declaration.
NODE_BIN="${GATE_B_NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN=$(command -v node 2>/dev/null || true)
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  MANIFEST_NODE=$(sed -n 's/.*"binary"[[:space:]]*:[[:space:]]*"\([^"]*node[^"]*\)".*/\1/p' "$CANON_ROOT/lab/paperclip-lab.manifest.json" 2>/dev/null | head -1)
  if [ -n "$MANIFEST_NODE" ] && [ -x "$MANIFEST_NODE" ]; then NODE_BIN="$MANIFEST_NODE"; fi
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  R_NODE="fail"; NODE_BIN="none"; NODE_VERSION=""
  die 4 "node" "FAIL gate 4: no Node binary found (PATH and lab manifest). Install Node >= 20."
fi
NODE_RAW=$("$NODE_BIN" --version 2>/dev/null | tr -d '\r')
NODE_VERSION=$(printf '%s' "$NODE_RAW" | sed 's/^v//; s/[^0-9.]//g')
if [ -z "$NODE_VERSION" ]; then
  R_NODE="fail"
  die 4 "node" "FAIL gate 4: \"$NODE_BIN --version\" did not report a parseable version (got: $NODE_RAW)."
fi
if ! awk -v a="$NODE_VERSION" -v b="20.0.0" 'BEGIN { n=split(a,aa,"."); m=split(b,bb,"."); for(i=1;i<=3;i++){ x=(i<=n?aa[i]:0)+0; y=(i<=m?bb[i]:0)+0; if(x<y) exit 1; if(x>y) exit 0 } exit 0 }'; then
  R_NODE="fail"
  die 4 "node" "FAIL gate 4: Node $NODE_VERSION < 20.0.0 ($NODE_BIN)."
fi
printf '%s\n' "ok   gate 4: Node $NODE_VERSION >= 20 ($NODE_BIN)"

# --- 5. pnpm >= 9.15 ------------------------------------------------------
PNPM_BIN="${GATE_B_PNPM_BIN:-}"
if [ -z "$PNPM_BIN" ]; then
  PNPM_BIN=$(command -v pnpm 2>/dev/null || true)
fi
if [ -z "$PNPM_BIN" ] || [ ! -x "$PNPM_BIN" ]; then
  MANIFEST_PNPM=$(sed -n 's/.*"binary"[[:space:]]*:[[:space:]]*"\([^"]*pnpm[^"]*\)".*/\1/p' "$CANON_ROOT/lab/paperclip-lab.manifest.json" 2>/dev/null | head -1)
  if [ -n "$MANIFEST_PNPM" ] && [ -x "$MANIFEST_PNPM" ]; then PNPM_BIN="$MANIFEST_PNPM"; fi
fi
if [ -z "$PNPM_BIN" ] || [ ! -x "$PNPM_BIN" ]; then
  R_PNPM="fail"
  die 5 "pnpm" "FAIL gate 5: no pnpm binary found (PATH and lab manifest). Install pnpm >= 9.15."
fi
PNPM_RAW=$("$PNPM_BIN" --version 2>/dev/null | tr -d '\r' | head -1)
PNPM_VERSION=$(printf '%s' "$PNPM_RAW" | sed 's/[^0-9.]//g')
if [ -z "$PNPM_VERSION" ]; then
  R_PNPM="fail"
  die 5 "pnpm" "FAIL gate 5: \"$PNPM_BIN --version\" did not report a parseable version (got: $PNPM_RAW)."
fi
if ! awk -v a="$PNPM_VERSION" -v b="9.15.0" 'BEGIN { n=split(a,aa,"."); m=split(b,bb,"."); for(i=1;i<=3;i++){ x=(i<=n?aa[i]:0)+0; y=(i<=m?bb[i]:0)+0; if(x<y) exit 1; if(x>y) exit 0 } exit 0 }'; then
  R_PNPM="fail"
  die 5 "pnpm" "FAIL gate 5: pnpm $PNPM_VERSION < 9.15.0 ($PNPM_BIN)."
fi
printf '%s\n' "ok   gate 5: pnpm $PNPM_VERSION >= 9.15 ($PNPM_BIN)"

# --- 6. green gentle-ai doctor -------------------------------------------
DOCTOR_BIN="${GATE_B_DOCTOR_BIN:-}"
if [ -z "$DOCTOR_BIN" ]; then
  DOCTOR_BIN=$(command -v gentle-ai 2>/dev/null || true)
fi
if [ -z "$DOCTOR_BIN" ] || [ ! -x "$DOCTOR_BIN" ]; then
  MANIFEST_DOCTOR=$(sed -n 's/.*"binary"[[:space:]]*:[[:space:]]*"\([^"]*gentle-ai[^"]*\)".*/\1/p' "$CANON_ROOT/lab/paperclip-lab.manifest.json" 2>/dev/null | head -1)
  if [ -n "$MANIFEST_DOCTOR" ] && [ -x "$MANIFEST_DOCTOR" ]; then DOCTOR_BIN="$MANIFEST_DOCTOR"; fi
fi
if [ -z "$DOCTOR_BIN" ] || [ ! -x "$DOCTOR_BIN" ]; then
  R_DOCTOR="fail"
  die 6 "doctor" "FAIL gate 6: no gentle-ai binary found (PATH and lab manifest)."
fi
DOCTOR_OUT=$("$DOCTOR_BIN" doctor 2>&1) || true
DOCTOR_STATUS=$(printf '%s\n' "$DOCTOR_OUT" | sed -n 's/^Status:[[:space:]]*//p' | head -1 | tr -d '\r')
if [ -z "$DOCTOR_STATUS" ]; then
  R_DOCTOR="fail"
  die 6 "doctor" "FAIL gate 6: gentle-ai doctor output unparseable (no Status line)."
fi
case "$DOCTOR_STATUS" in
  *unhealthy*) R_DOCTOR="fail"; die 6 "doctor" "FAIL gate 6: gentle-ai doctor reports unhealthy status (\"$DOCTOR_STATUS\")." ;;
esac
if [ "$DOCTOR_STATUS" != "healthy" ]; then
  R_DOCTOR="fail"
  die 6 "doctor" "FAIL gate 6: gentle-ai doctor status \"$DOCTOR_STATUS\" is not healthy."
fi
printf '%s\n' "ok   gate 6: gentle-ai doctor healthy"

if [ "$JSON_MODE" -eq 1 ]; then emit_json "pass" 0; fi
printf '%s\n' "PASS: all Gate B preflight gates green"
exit 0
