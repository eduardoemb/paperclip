import type { CeoExecutionPolicy } from "@paperclipai/shared";

/**
 * Company CEO execution policy — authoritative run-time overlay.
 *
 * The company stores a CEO execution policy (`delegate_first` by default, or
 * `direct_allowed` when the board opts in). The heartbeat renders an
 * authoritative wake-policy overlay for CEO runs from this policy. The overlay
 * is a run-time artifact: it never rewrites the materialized instruction
 * bundles, so customized or external CEO instructions keep working and the
 * policy still applies on every heartbeat.
 */

const DEFAULT_CEO_EXECUTION_POLICY: CeoExecutionPolicy = "delegate_first";

const CEO_EXECUTION_POLICY_VALUES: readonly string[] = ["delegate_first", "direct_allowed"];

export function resolveCeoExecutionPolicy(value: unknown): CeoExecutionPolicy {
  return typeof value === "string" && CEO_EXECUTION_POLICY_VALUES.includes(value)
    ? (value as CeoExecutionPolicy)
    : DEFAULT_CEO_EXECUTION_POLICY;
}

export function ceoExecutionPolicyAllowsDirectExecution(policy: CeoExecutionPolicy): boolean {
  return policy === "direct_allowed";
}

const DELEGATE_FIRST_OVERLAY = (companyId: string, agentId: string) => `## Company CEO execution policy (authoritative overlay)

This run executes under the company policy \`delegate_first\` (company ${companyId}, agent ${agentId}). You MUST delegate assignable work to the right agent before doing individual-contributor work yourself: create subtasks with \`parentId\` for direct reports, hire the owning agent when no report fits, and use issue-thread interactions when the board must choose. Direct IC work is the exception, not the default. This overlay is authoritative for this run and supplements your static instructions.`;

const DIRECT_ALLOWED_OVERLAY = (companyId: string, agentId: string) => `## Company CEO execution policy (authoritative overlay)

This run executes under the company policy \`direct_allowed\` (company ${companyId}, agent ${agentId}). You MAY execute assignable work directly instead of delegating it. This permission does NOT relax any control-plane constraint: authorization, approval gates, budget hard-stops, pause holds, and low-trust review restrictions still bind exactly as before. This overlay is authoritative for this run and supplements your static instructions.`;

export function buildCeoExecutionPolicyOverlay(input: {
  policy: CeoExecutionPolicy;
  companyId: string;
  agentId: string;
}): string {
  return ceoExecutionPolicyAllowsDirectExecution(input.policy)
    ? DIRECT_ALLOWED_OVERLAY(input.companyId, input.agentId)
    : DELEGATE_FIRST_OVERLAY(input.companyId, input.agentId);
}
