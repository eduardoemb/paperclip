# Design: Paperclip Lab SDD OpenSpec Smoke Guide

## Technical Approach

Create one Markdown guide and preserve all planning and evidence files under one OpenSpec change folder before mechanically archiving it.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Artifact backend | OpenSpec only | The lab test validates file persistence, not Engram or hybrid storage. |
| Verification | Structural shell checks | The change is passive documentation with no runtime boundary. |
| Archive | Native file move with readback | Retains a visible, immutable lifecycle record. |

## Data Flow

`proposal → spec + design → tasks → guide + apply evidence → verification → archive`

## File Changes

| File | Action | Description |
|---|---|---|
| `docs/labs/paperclip-lab-sdd-openspec.md` | Create | Reproducible lab guide. |
| `openspec/changes/paperclip-lab-sdd-openspec/*` | Create | Lifecycle artifacts and evidence. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Structural | Required guide content and artifacts | `test -f` and `grep -F` checks. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is introduced.

## Migration / Rollout

No migration required.

## Open Questions

None.
