#!/bin/sh
# Gate B post-install smoke — B1-R4.
#
# Runs after a successful frozen-lockfile install and verifies:
#   1. `paperclipai doctor` exits zero
#   2. the Paperclip server UI answers on the loopback URL
#
# Exits non-zero on the first failed check so B1 is rejected on failure.
#
# Usage:
#   gate-b-smoke.sh
#
# Exit codes:
#   0  all smoke checks pass
#   1  paperclipai binary missing or `paperclipai doctor` failed
#   2  UI loopback unreachable
#
# Overrides (env): GATE_B_PAPERCLIP_BIN, PAPERCLIP_SMOKE_UI_URL
#   (default http://127.0.0.1:3100 — the upstream server default port),
#   PAPERCLIP_SMOKE_UI_TIMEOUT (default 5s).
set -u

PAPERCLIP_BIN="${GATE_B_PAPERCLIP_BIN:-paperclipai}"
UI_URL="${PAPERCLIP_SMOKE_UI_URL:-http://127.0.0.1:3100}"
UI_TIMEOUT="${PAPERCLIP_SMOKE_UI_TIMEOUT:-5}"

echo "== Gate B post-install smoke =="

echo "[1/2] $PAPERCLIP_BIN doctor"
if ! command -v "$PAPERCLIP_BIN" >/dev/null 2>&1; then
  echo "FAIL: $PAPERCLIP_BIN not found on PATH (install incomplete?)" >&2
  exit 1
fi
if ! "$PAPERCLIP_BIN" doctor; then
  echo "FAIL: $PAPERCLIP_BIN doctor reported failures" >&2
  exit 1
fi
echo "ok   $PAPERCLIP_BIN doctor"

echo "[2/2] UI loopback $UI_URL"
if ! curl -fsS --max-time "$UI_TIMEOUT" "$UI_URL" >/dev/null 2>&1; then
  echo "FAIL: UI loopback unreachable at $UI_URL" >&2
  exit 2
fi
echo "ok   UI loopback"

echo "PASS: all Gate B smoke checks passed"
exit 0
