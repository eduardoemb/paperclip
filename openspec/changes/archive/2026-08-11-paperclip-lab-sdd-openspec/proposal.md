# Proposal: Paperclip Lab SDD OpenSpec Smoke Guide

## Intent

Prove that a documentation-only lab change can preserve the full SDD lifecycle as repository files.

## Scope

### In Scope
- Add `docs/labs/paperclip-lab-sdd-openspec.md`.
- Persist proposal, specification, design, tasks, apply evidence, and verification evidence in OpenSpec files.
- Archive the completed OpenSpec change after verification.

### Out of Scope
- Product source changes, commits, pushes, pull requests, and README edits.

## Capabilities

### New Capabilities
- `lab-sdd-openspec-guide`: A reproducible, documentation-only OpenSpec SDD smoke record.

### Modified Capabilities
- None.

## Approach

Use one concise lab guide and a file-backed OpenSpec lifecycle. Verify required phrases and artifact presence with shell checks.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `docs/labs/paperclip-lab-sdd-openspec.md` | New | Lab guide. |
| `openspec/` | New | SDD lifecycle artifacts. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scope expands beyond docs/artifacts | Low | Limit edits to the declared paths. |

## Rollback Plan

Remove the guide and the archived OpenSpec record for this change; no product behavior changes.

## Success Criteria

- [ ] The guide records the requested SDD configuration and recovery steps.
- [ ] The archived OpenSpec record contains a complete, verified lifecycle.
