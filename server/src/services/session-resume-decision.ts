export type SessionResumeDecision =
  | "compatible"
  | "execution_target_mismatch"
  | "missing_execution_target_identity"
  | "config_changed"
  | "compacted"
  | "explicit_clear";

export interface SessionResumeDecisionInput {
  /** Whether a stored session id exists in the task session row. */
  hasStoredSessionId: boolean;
  /** The execution-target identity persisted with the stored session, or null for legacy rows. */
  storedIdentity: Record<string, unknown> | null;
  /** Whether the stored identity matches the resolved execution target for this wake. */
  identityMatches: boolean;
  /** The heartbeat rotated the session via the compaction gate. */
  compacted: boolean;
  /** The heartbeat reset the session because run configuration changed. */
  configReset: boolean;
  /** The wake explicitly requested a fresh session. */
  explicitClear: boolean;
}

/**
 * Resolves whether an `opencode_local` wake should resume the stored session or
 * start fresh. The heartbeat owns this compatibility decision; adapters only
 * execute the resolved decision.
 *
 * Priority order: explicit compaction/config/clear decisions win over identity
 * compatibility. When the wake is otherwise resumable, the stored execution-target
 * identity decides: a match resumes, a missing legacy identity rotates once with
 * `missing_execution_target_identity`, and any other mismatch rotates with
 * `execution_target_mismatch`.
 */
export function resolveSessionResumeDecision(
  input: SessionResumeDecisionInput,
): SessionResumeDecision | null {
  if (input.compacted) return "compacted";
  if (input.configReset) return "config_changed";
  if (input.explicitClear) return "explicit_clear";
  if (!input.hasStoredSessionId) return null;
  if (input.identityMatches) return "compatible";
  if (input.storedIdentity === null) return "missing_execution_target_identity";
  return "execution_target_mismatch";
}
