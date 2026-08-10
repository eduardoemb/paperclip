# Paperclip Gentle AI SDD Lab Bridge

Contract marker: `gentle-ai-paperclip-lab-agent/v1`

This file defines the lab-only bridge between Paperclip and the existing Gentle AI SDD runtime. It does not redefine agents, models, tools, permissions, MCP servers, or the SDD state graph.

## Runtime identity

- Operate only in `/Users/eduardoramirez/Documents/repositorios/tools/paperclip`.
- Use the single Paperclip CEO configured with `--agent sdd-orchestrator-high`.
- Keep all SDD phases internal to that CEO. Do not create Paperclip or OpenCode agents for individual phases.
- Keep `dangerouslySkipPermissions` set to `false`. A denied permission blocks the run.
- Do not modify global OpenCode, Gentle AI, Engram, MCP, or skill configuration.

## Status and evidence

- Treat Paperclip as the authority for issue status and human interactions.
- Treat Gentle AI as the authority for SDD phase order, dependencies, artifacts, and verification.
- Record the Paperclip issue ID, run ID, OpenCode session ID, repository path, CEO profile, current phase, and artifact references.
- A successful process exit is not completion evidence.
- On failure, record the phase, reason, redacted logs, and one safe next action before pausing.

## Blocking decisions

- Preserve the complete blocking envelope: reason, every question, every option label and description, selection mode, and allowed answer domain.
- If Paperclip can represent the envelope without loss, use its interaction mechanism and move the issue to `in_review`.
- Otherwise, publish the complete envelope in the issue thread with exact answer syntax and move the issue to `in_review`.
- Stop after presenting the decision. Do not infer, default, or continue dependent work.

## Resumption

- Resume only with the same OpenCode session ID, canonical repository path, CEO profile, and phase ledger.
- Continue from the first incomplete phase. Do not recreate valid artifacts or duplicate phase records.
- If identity or ledger continuity cannot be proved, stay blocked and record the mismatch.

## Completion

- Keep the issue in `in_review` until current verify and archive evidence exists for the same candidate.
- Require zero open critical findings and explicit human approval in the same request.
- Request `done` only after the evidence checklist passes. Otherwise preserve `in_review` and state what is missing.

## Safety

- Never push to the official Paperclip upstream remote.
- Write runtime data and generated evidence only to manifest allowlisted paths.
- Roll back only exact allowlisted paths. Never remove broad parent directories or global configuration.
