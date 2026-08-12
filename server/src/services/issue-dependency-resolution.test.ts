import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_RESOLVING_ISSUE_STATUSES,
  issueStatusRequiresWorkspaceFinalize,
  issueStatusResolvesDependencyEdge,
} from "./issue-dependency-resolution.js";

describe("issue-dependency-resolution predicate", () => {
  it("resolves the edge only for done and cancelled, matching the exported constant", () => {
    expect(DEPENDENCY_RESOLVING_ISSUE_STATUSES).toEqual(["done", "cancelled"]);
    expect(issueStatusResolvesDependencyEdge("done")).toBe(true);
    expect(issueStatusResolvesDependencyEdge("cancelled")).toBe(true);
  });

  it("keeps non-terminal, missing, and unknown statuses unresolved", () => {
    for (const status of ["backlog", "todo", "in_progress", "in_review", "blocked", null, undefined, "archived"]) {
      expect(issueStatusResolvesDependencyEdge(status)).toBe(false);
    }
  });

  it("requires workspace finalization only for done blockers, never for cancelled", () => {
    expect(issueStatusRequiresWorkspaceFinalize("done")).toBe(true);
    expect(issueStatusRequiresWorkspaceFinalize("cancelled")).toBe(false);
    expect(issueStatusRequiresWorkspaceFinalize("in_progress")).toBe(false);
    expect(issueStatusRequiresWorkspaceFinalize(null)).toBe(false);
  });
});
