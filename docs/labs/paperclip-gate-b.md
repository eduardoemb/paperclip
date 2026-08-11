# Paperclip Gentle AI Gate B — Pinned Import & Reproducible Install

Operational procedure for the Gate B B1 capability `pinned-paperclip-install`.
B1 imports upstream Paperclip at a pinned SHA, validates the toolchain,
installs from the frozen lockfile, smoke-tests the result, and recaptures
manifest evidence.

## Identity (B1-R1)

| Field | Value |
|---|---|
| Pinned upstream commit | `6a4e2e1b8c7129f6f913ae458ab0be9cba50bd6a` |
| Pinned source tree identity | `43c60f4c1a0b1610070ce407addbed2482d9ee68` |
| Import branch | `feat/paperclip-gentle-ai-gate-b-pinned-import` |
| Import method | `git merge --no-ff --allow-unrelated-histories` from `main` |

Upstream history is preserved: the merge commit carries both parents and
the pinned SHA is recorded in the manifest.

## Prerequisites (B1-R2)

- Node >= 20
- pnpm >= 9.15
- `gentle-ai doctor` reports `Status: healthy`

The preflight script enforces all three and exits non-zero on the first
failed gate. **Do not start a merge, install, or package script on a red
preflight.**

## Procedure

### 1. Preflight

```sh
lab/scripts/gate-b-preflight.sh
```

Gates, in order:

| Gate | Check | Exit on failure |
|---|---|---|
| 1 | Repository authority: canonical manifest root, fixed `git -C`, no wrong relative/absolute selectors, no symlink drift | 1 |
| 2 | Clean worktree and index (script never stages or commits) | 2 |
| 3 | Pinned SHA reachable and tree identity `43c60f4c...` | 3 |
| 4 | Node >= 20 | 4 |
| 5 | pnpm >= 9.15 | 5 |
| 6 | `gentle-ai doctor` healthy | 6 |

`lab/scripts/gate-b-preflight.sh --json` prints the machine-readable
summary used for manifest recapture.

Binary resolution order per tool: `GATE_B_NODE_BIN` / `GATE_B_PNPM_BIN` /
`GATE_B_DOCTOR_BIN` override, then PATH, then the binary paths declared
in `lab/paperclip-lab.manifest.json`. If PATH resolves a broken or
stale binary (for example a Bun-provided `node` wrapper that does not
report a version), the gate fails closed — point the override at a real
Node 20+ binary instead of mutating anything.

### 2. Pinned import (B1-R1)

```sh
git fetch upstream 6a4e2e1b8c7129f6f913ae458ab0be9cba50bd6a
git checkout -b feat/paperclip-gentle-ai-gate-b-pinned-import main
git merge --no-ff --allow-unrelated-histories \
  -m "merge: import paperclip upstream at 6a4e2e1b8c (Gate B B1 pinned import)" \
  6a4e2e1b8c7129f6f913ae458ab0be9cba50bd6a
```

Resolve the add/add conflicts on `.gitignore` and `README.md` deliberately
(keep upstream content; the union ignore rules and the lab guide link are
layered on top). `AGENTS.md` is owned by upstream and merges cleanly.

### 3. Install (B1-R3)

```sh
pnpm install --frozen-lockfile
```

Exits zero only when the lockfile is in sync; on drift it aborts non-zero.

### 4. Smoke (B1-R4)

```sh
lab/scripts/gate-b-smoke.sh
```

Checks `paperclipai doctor` (exit 0) and the UI loopback (default
`http://127.0.0.1:3100`, overridable with `PAPERCLIP_SMOKE_UI_URL`).
Any failure rejects B1.

### 5. Manifest recapture (B1-R5)

Update `lab/paperclip-lab.manifest.json` with the merge SHA, the detected
toolchain versions, and the smoke result. Never record a smoke result
that did not actually pass.

## Rollback

| Scope | Rollback |
|---|---|
| Pinned import | `git reset --hard a3c4b5e8` (pre-import `main` HEAD) or revert the merge commit; `main` is untouched by this branch |
| Authored B1 deltas | Remove `lab/scripts/`, `lab/tests/`, `docs/labs/paperclip-gate-b.md`, the `.gitignore` union section, the README labs link, and manifest recapture independently — none of them depend on the imported tree |
| Install artifacts | Delete `node_modules/` and re-run the frozen install after fixing the drift |

## Troubleshooting

- **Preflight exit 4/5/6**: the toolchain is below threshold or the doctor
  is unhealthy. Fix the environment and re-run preflight; do not bypass.
- **Doctor red on `engram:reachable`**: the Engram MCP handshake failed —
  check the persisted MCP configuration, then re-run `gentle-ai doctor`.
- **`node` reports no version**: PATH resolves a Bun-provided `node`
  wrapper; set `GATE_B_NODE_BIN=/opt/homebrew/bin/node` (or your real
  Node 20+ binary).
- **pnpm missing**: install pnpm 9.15+ (`corepack enable` or the pnpm
  installer) and make it reachable from PATH.
