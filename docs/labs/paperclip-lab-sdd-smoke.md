# Paperclip Lab SDD Smoke Guide

Concise operational guide for a bounded, documentation-only Paperclip lab work
unit. This is an internal executor procedure, not a Paperclip delegation.

## SDD Parameters

Use these fixed parameters for the work unit:

- **Execution mode:** `auto`
- **Artifact store:** Engram
- **Delivery:** `single-pr/no PR`, as appropriate for the work unit
- **Change-size limit:** 400 changed lines
- **Scope:** documentation only; run the complete internal SDD lifecycle

## Artifact Store

Store SDD artifacts in Engram. This guide is an operational reference for the
lab and is not itself an SDD artifact.

## Verification

Confirm both documentation paths exist:

```sh
test -f docs/labs/paperclip-lab-sdd-smoke.md
grep -F 'docs/labs/paperclip-lab-sdd-smoke.md' README.md
```

The first command verifies the guide. The second verifies its relative README
link under `## Labs`.

## Rollback

Delete `docs/labs/paperclip-lab-sdd-smoke.md` and its link under `## Labs` in
`README.md`. Then inspect the resulting diff:

```sh
git diff -- README.md docs/labs/paperclip-lab-sdd-smoke.md
```
