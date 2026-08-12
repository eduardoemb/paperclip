/**
 * Central dependency-resolution semantics for blocker edges. Every projection
 * that decides whether a dependent issue can proceed — readiness, checkout,
 * wake/scheduler eligibility, plugin guards, liveness, diagnostics — consumes
 * these predicates so all projections stay in agreement.
 *
 * Rule: `done` and `cancelled` resolve the blocker edge. Workspace
 * finalization only applies to `done` blockers: a cancelled blocker has no
 * execution workspace to sync back.
 */
export const DEPENDENCY_RESOLVING_ISSUE_STATUSES = ["done", "cancelled"] as const;
export function issueStatusResolvesDependencyEdge(status: string | null | undefined): boolean {
  return status === "done" || status === "cancelled";
}

export function issueStatusRequiresWorkspaceFinalize(status: string | null | undefined): boolean {
  return status === "done";
}
