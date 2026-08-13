# Paperclip Lab SDD OpenSpec Smoke Guide

## Parameters

| Setting | Value |
|---|---|
| SDD mode | `auto` |
| Artifact store | `openspec` (file-based) |
| PR strategy | `single-pr` (no PR created) |
| Review budget | 400 changed lines |

## Persisted Lifecycle

The lifecycle is saved under `openspec/changes/archive/YYYY-MM-DD-paperclip-lab-sdd-openspec/` after archival.
It contains `proposal.md`, `specs/lab-sdd-openspec-guide/spec.md`, `design.md`, `tasks.md`, `apply-progress.md`, and `verify-report.md`.

## Verify

```bash
test -f docs/labs/paperclip-lab-sdd-openspec.md
grep -F 'Artifact store | `openspec`' docs/labs/paperclip-lab-sdd-openspec.md
test -f openspec/changes/archive/YYYY-MM-DD-paperclip-lab-sdd-openspec/verify-report.md
```

## Rollback

Remove `docs/labs/paperclip-lab-sdd-openspec.md` and the matching archived OpenSpec change folder. No product-source file changes are involved.
