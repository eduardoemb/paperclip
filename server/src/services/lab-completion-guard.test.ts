import { describe, expect, it } from "vitest";
import {
  evaluateLabCompletion,
  type LabApproval,
  type LabCompletionInput,
  type LabEvidenceWorkProduct,
} from "./lab-completion-guard.js";

const baseTime = new Date("2026-08-11T12:00:00.000Z");

function workProduct(
  id: string,
  createdAt: string,
  metadata: Record<string, unknown>,
): LabEvidenceWorkProduct {
  return {
    id,
    issueId: "issue-1",
    companyId: "company-1",
    type: "artifact",
    status: "available",
    metadata,
    createdAt: new Date(createdAt),
  };
}

function approval(input: Partial<LabApproval> = {}): LabApproval {
  return {
    id: "approval-1",
    companyId: "company-1",
    type: "request_board_approval",
    status: "approved",
    payload: {},
    decidedByUserId: "user-1",
    decidedAt: new Date("2026-08-11T12:03:00.000Z"),
    createdAt: new Date("2026-08-11T12:02:00.000Z"),
    linkedToIssue: true,
    ...input,
  };
}

function input(overrides: Partial<LabCompletionInput> = {}): LabCompletionInput {
  return {
    issueId: "issue-1",
    companyId: "company-1",
    labLabelActive: true,
    workProducts: [
      workProduct("verify-1", "2026-08-11T12:01:00.000Z", { phase: "verify", status: "completed" }),
      workProduct("archive-1", "2026-08-11T12:02:00.000Z", { phase: "archive", status: "completed" }),
    ],
    approvals: [approval()],
    now: baseTime,
    ...overrides,
  };
}

describe("evaluateLabCompletion", () => {
  it.each([
    ["non-lab issue", { labLabelActive: false }, { allowed: true, missing: [] }],
    ["complete evidence", {}, { allowed: true, missing: [] }],
    ["missing verify", { workProducts: [workProduct("archive-1", "2026-08-11T12:02:00.000Z", { phase: "archive", status: "completed" })] }, { allowed: false, missing: ["verify_completed"] }],
    ["missing archive", { workProducts: [workProduct("verify-1", "2026-08-11T12:01:00.000Z", { phase: "verify", status: "completed" })] }, { allowed: false, missing: ["archive_completed"] }],
    ["archive before verify", { workProducts: [
      workProduct("archive-1", "2026-08-11T12:01:00.000Z", { phase: "archive", status: "completed" }),
      workProduct("verify-1", "2026-08-11T12:02:00.000Z", { phase: "verify", status: "completed" }),
    ], approvals: [approval({ decidedAt: new Date("2026-08-11T12:04:00.000Z") })] }, { allowed: false, missing: ["verify_before_archive"] }],
    ["open CRITICAL finding", { workProducts: [
      workProduct("verify-1", "2026-08-11T12:01:00.000Z", { phase: "verify", status: "completed" }),
      workProduct("archive-1", "2026-08-11T12:02:00.000Z", { phase: "archive", status: "completed" }),
      workProduct("finding-1", "2026-08-11T12:02:30.000Z", { findingSeverity: "CRITICAL", status: "open" }),
    ] }, { allowed: false, missing: ["open_critical_findings"] }],
    ["missing approval", { approvals: [] }, { allowed: false, missing: ["human_approval"] }],
    ["stale approval", { approvals: [approval({ decidedAt: new Date("2026-08-11T12:01:30.000Z") })] }, { allowed: false, missing: ["human_approval"] }],
    ["approval not linked to issue", { approvals: [approval({ linkedToIssue: false })] }, { allowed: false, missing: ["human_approval"] }],
    ["multiple failures", { workProducts: [workProduct("finding-1", "2026-08-11T12:02:00.000Z", { findingSeverity: "CRITICAL", status: "open" })], approvals: [] }, { allowed: false, missing: ["verify_completed", "archive_completed", "open_critical_findings", "human_approval"] }],
  ])("returns the expected result for %s", (_name, overrides, expected) => {
    expect(evaluateLabCompletion(input(overrides))).toEqual(expected);
  });
});
