import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, issueApprovals, issueWorkProducts } from "@paperclipai/db";

export const LAB_COMPLETION_LABEL_ENV = "PAPERCLIP_LAB_COMPLETION_LABEL";

export type LabCompletionReasonCode =
  | "verify_completed"
  | "archive_completed"
  | "verify_before_archive"
  | "open_critical_findings"
  | "human_approval";

export interface LabCompletionInput {
  issueId: string;
  companyId: string;
  labLabelActive: boolean;
  workProducts: LabEvidenceWorkProduct[];
  approvals: LabApproval[];
  newestEvidenceAt?: Date;
  now?: Date;
}

export interface LabEvidenceWorkProduct {
  id: string;
  issueId: string;
  companyId: string;
  type: string;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface LabApproval {
  id: string;
  companyId: string;
  type: string;
  status: string;
  payload: Record<string, unknown> | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  linkedToIssue: boolean;
}

export interface LabCompletionResult {
  allowed: boolean;
  missing: LabCompletionReasonCode[];
}

const MISSING_REASON_ORDER: LabCompletionReasonCode[] = [
  "verify_completed",
  "archive_completed",
  "verify_before_archive",
  "open_critical_findings",
  "human_approval",
];

function hasCompletedPhase(workProduct: LabEvidenceWorkProduct, phase: string) {
  return workProduct.metadata?.phase === phase && workProduct.metadata.status === "completed";
}

function earliestCreatedAt(workProducts: LabEvidenceWorkProduct[]) {
  return workProducts.reduce(
    (earliest, workProduct) => workProduct.createdAt < earliest ? workProduct.createdAt : earliest,
    workProducts[0].createdAt,
  );
}

export function evaluateLabCompletion(input: LabCompletionInput): LabCompletionResult {
  if (!input.labLabelActive) return { allowed: true, missing: [] };

  const verifyEvidence = input.workProducts.filter((workProduct) => hasCompletedPhase(workProduct, "verify"));
  const archiveEvidence = input.workProducts.filter((workProduct) => hasCompletedPhase(workProduct, "archive"));
  const missing = new Set<LabCompletionReasonCode>();

  if (verifyEvidence.length === 0) missing.add("verify_completed");
  if (archiveEvidence.length === 0) missing.add("archive_completed");
  if (
    verifyEvidence.length > 0
    && archiveEvidence.length > 0
    && earliestCreatedAt(archiveEvidence) <= earliestCreatedAt(verifyEvidence)
  ) {
    missing.add("verify_before_archive");
  }
  if (input.workProducts.some((workProduct) =>
    workProduct.metadata?.findingSeverity === "CRITICAL" && workProduct.metadata.status === "open"
  )) {
    missing.add("open_critical_findings");
  }

  const newestEvidenceAt = input.newestEvidenceAt ?? input.workProducts.reduce<Date | undefined>(
    (latest, workProduct) => !latest || workProduct.createdAt > latest ? workProduct.createdAt : latest,
    undefined,
  );
  const hasCurrentHumanApproval = input.approvals.some((approval) =>
    approval.type === "request_board_approval"
    && approval.status === "approved"
    && approval.decidedByUserId !== null
    && approval.linkedToIssue
    && approval.decidedAt !== null
    && (!newestEvidenceAt || approval.decidedAt > newestEvidenceAt)
  );
  if (!hasCurrentHumanApproval) missing.add("human_approval");

  const orderedMissing = MISSING_REASON_ORDER.filter((reason) => missing.has(reason));
  return { allowed: orderedMissing.length === 0, missing: orderedMissing };
}

export function loadLabCompletionEvidence(
  tx: Db,
  input: { issueId: string; companyId: string },
): Promise<{ workProducts: LabEvidenceWorkProduct[]; approvals: LabApproval[] }> {
  return Promise.all([
    tx
      .select({
        id: issueWorkProducts.id,
        issueId: issueWorkProducts.issueId,
        companyId: issueWorkProducts.companyId,
        type: issueWorkProducts.type,
        status: issueWorkProducts.status,
        metadata: issueWorkProducts.metadata,
        createdAt: issueWorkProducts.createdAt,
      })
      .from(issueWorkProducts)
      .where(and(
        eq(issueWorkProducts.issueId, input.issueId),
        eq(issueWorkProducts.companyId, input.companyId),
      ))
      .orderBy(asc(issueWorkProducts.createdAt), asc(issueWorkProducts.id)),
    tx
      .select({
        id: approvals.id,
        companyId: approvals.companyId,
        type: approvals.type,
        status: approvals.status,
        payload: approvals.payload,
        decidedByUserId: approvals.decidedByUserId,
        decidedAt: approvals.decidedAt,
        createdAt: approvals.createdAt,
      })
      .from(issueApprovals)
      .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
      .where(and(
        eq(issueApprovals.companyId, input.companyId),
        eq(issueApprovals.issueId, input.issueId),
        eq(approvals.companyId, input.companyId),
      ))
      .orderBy(desc(approvals.createdAt), desc(approvals.id)),
  ]).then(([workProducts, approvalRows]) => ({
    workProducts,
    approvals: approvalRows.map((approval) => ({ ...approval, linkedToIssue: true })),
  }));
}
