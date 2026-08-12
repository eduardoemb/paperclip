import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentWakeupRequests,
  agents,
  budgetPolicies,
  companies,
  costEvents,
  createDb,
  issues,
  issueTreeHolds,
} from "@paperclipai/db";
import { sessionCodec } from "@paperclipai/adapter-opencode-local/server";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService, resolveExecutionRunAdapterConfig } from "../services/heartbeat.ts";
import { resolveCoreTrustPreset } from "../services/trust-preset-resolver.js";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.ts";

const capturedAdapterInputs: Array<{ runId: string; [key: string]: unknown }> = [];

const adapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    summary: "CEO policy test run.",
    provider: "test",
    model: "test-model",
  })),
);

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat CEO policy tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat CEO execution policy overlay", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let oldPaperclipHome: string | undefined;
  let oldPaperclipApiUrl: string | undefined;
  let paperclipHome: string | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-ceo-policy-");
    db = createDb(tempDb.connectionString);
    oldPaperclipHome = process.env.PAPERCLIP_HOME;
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-ceo-policy-home-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    oldPaperclipApiUrl = process.env.PAPERCLIP_API_URL;
    process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100/api";
    registerServerAdapter({
      type: "opencode_local",
      execute: async (ctx) => {
        capturedAdapterInputs.push({ runId: ctx.runId, ...ctx } as unknown as { runId: string; [key: string]: unknown });
        return adapterExecute(ctx);
      },
      sessionCodec,
      testEnvironment: async () => ({
        adapterType: "opencode_local",
        status: "pass",
        checks: [],
        testedAt: new Date().toISOString(),
      }),
    });
  }, 20_000);

  afterEach(async () => {
    capturedAdapterInputs.length = 0;
    adapterExecute.mockReset();
    adapterExecute.mockImplementation(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "CEO policy test run.",
      provider: "test",
      model: "test-model",
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await db.execute(sql.raw(`
      TRUNCATE TABLE
        "activity_log",
        "agent_task_sessions",
        "budget_policies",
        "cost_events",
        "environment_leases",
        "environments",
        "heartbeat_run_events",
        "heartbeat_runs",
        "agent_wakeup_requests",
        "agent_runtime_state",
        "issues",
        "issue_tree_holds",
        "issue_tree_hold_members",
        "agents",
        "companies"
      RESTART IDENTITY CASCADE
    `));
  });

  afterAll(async () => {
    unregisterServerAdapter("opencode_local");
    if (oldPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = oldPaperclipHome;
    if (oldPaperclipApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = oldPaperclipApiUrl;
    if (paperclipHome) {
      await fs.rm(paperclipHome, { recursive: true, force: true });
    }
    await tempDb?.cleanup();
  });

  async function seedCompanyWithAgent(input: {
    role: string;
    ceoExecutionPolicy?: string;
    agentStatus?: string;
  }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: `Company ${companyId.slice(0, 8)}`,
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
      ...(input.ceoExecutionPolicy !== undefined
        ? { ceoExecutionPolicy: input.ceoExecutionPolicy }
        : {}),
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `${input.role} Agent`,
      role: input.role,
      status: input.agentStatus ?? "idle",
      adapterType: "opencode_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function seedIssue(companyId: string, input: { id?: string; status?: string }) {
    const issueId = input.id ?? randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "CEO policy enforcement issue",
      status: input.status ?? "todo",
      priority: "medium",
      responsibleUserId: "responsible-user",
    });
    return issueId;
  }

  async function waitForRunToFinish(
    heartbeat: ReturnType<typeof heartbeatService>,
    runId: string,
    timeoutMs = 10_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await heartbeat.getRun(runId);
      if (run && !["queued", "running"].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return await heartbeat.getRun(runId);
  }

  async function invokeAndWait(heartbeat: ReturnType<typeof heartbeatService>, agentId: string) {
    const run = await heartbeat.invoke(agentId, "on_demand", { taskKey: "ceo-policy-wake" }, "manual");
    expect(run).not.toBeNull();
    const finished = await waitForRunToFinish(heartbeat, run!.id);
    expect(finished).not.toBeNull();
    return run!.id;
  }

  function adapterInputForRun(runId: string) {
    const input = capturedAdapterInputs.find((entry) => entry.runId === runId);
    if (!input) throw new Error(`No adapter input captured for run ${runId}`);
    return input as {
      runId: string;
      context: {
        paperclipCeoExecutionPolicy: {
          policy: string;
          companyId: string;
          overlay: string;
        } | null;
        paperclipWake: {
          ceoExecutionPolicy: { policy: string; overlay: string } | null;
        } | null;
      };
    };
  }

  it("renders the direct_allowed overlay for a CEO run in a direct_allowed company", async () => {
    const heartbeat = heartbeatService(db);
    const { companyId, agentId } = await seedCompanyWithAgent({
      role: "ceo",
      ceoExecutionPolicy: "direct_allowed",
    });
    const runId = await invokeAndWait(heartbeat, agentId);
    const input = adapterInputForRun(runId);
    expect(input.context.paperclipCeoExecutionPolicy?.policy).toBe("direct_allowed");
    expect(input.context.paperclipCeoExecutionPolicy?.companyId).toBe(companyId);
    expect(input.context.paperclipWake?.ceoExecutionPolicy?.policy).toBe("direct_allowed");
    expect(input.context.paperclipWake?.ceoExecutionPolicy?.overlay).toContain("MAY execute");
  });

  it("preserves delegation-first when the company policy is unset", async () => {
    const heartbeat = heartbeatService(db);
    const { agentId } = await seedCompanyWithAgent({ role: "ceo" });
    const runId = await invokeAndWait(heartbeat, agentId);
    const input = adapterInputForRun(runId);
    expect(input.context.paperclipCeoExecutionPolicy?.policy).toBe("delegate_first");
    expect(input.context.paperclipWake?.ceoExecutionPolicy?.overlay).toContain("MUST delegate");
  });

  it("never overlays the CEO policy for non-CEO agents", async () => {
    const heartbeat = heartbeatService(db);
    const { agentId } = await seedCompanyWithAgent({
      role: "cto",
      ceoExecutionPolicy: "direct_allowed",
    });
    const runId = await invokeAndWait(heartbeat, agentId);
    const input = adapterInputForRun(runId);
    expect(input.context.paperclipCeoExecutionPolicy ?? null).toBeNull();
    expect(input.context.paperclipWake?.ceoExecutionPolicy ?? null).toBeNull();
  });

  it("does not leak direct_allowed across companies", async () => {
    const heartbeat = heartbeatService(db);
    const { agentId: ceoA } = await seedCompanyWithAgent({
      role: "ceo",
      ceoExecutionPolicy: "direct_allowed",
    });
    const { agentId: ceoB } = await seedCompanyWithAgent({ role: "ceo" });
    const runA = await invokeAndWait(heartbeat, ceoA);
    const runB = await invokeAndWait(heartbeat, ceoB);
    expect(adapterInputForRun(runA).context.paperclipWake?.ceoExecutionPolicy?.overlay)
      .toContain("MAY execute");
    expect(adapterInputForRun(runB).context.paperclipWake?.ceoExecutionPolicy?.overlay)
      .toContain("MUST delegate");
  });

  describe("direct_allowed cannot evade governed control-plane seams", () => {
    it("denies cross-company issue access (authorization seam) for a direct_allowed CEO", async () => {
      const heartbeat = heartbeatService(db);
      const { agentId } = await seedCompanyWithAgent({
        role: "ceo",
        ceoExecutionPolicy: "direct_allowed",
      });
      const otherCompanyId = randomUUID();
      await db.insert(companies).values({
        id: otherCompanyId,
        name: `Other ${otherCompanyId.slice(0, 8)}`,
        issuePrefix: `Q${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
        defaultResponsibleUserId: "responsible-user",
      });
      const foreignIssueId = await seedIssue(otherCompanyId, { id: randomUUID() });

      const result = await heartbeat.invoke(
        agentId,
        "on_demand",
        { issueId: foreignIssueId, taskKey: "foreign-wake" },
        "manual",
      );
      expect(result).toBeNull();
      expect(capturedAdapterInputs).toHaveLength(0);
      const wake = await db
        .select({ reason: agentWakeupRequests.reason })
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, agentId));
      expect(wake.map((row) => row.reason)).toContain("issue_execution_issue_not_found");
    });

    it("keeps the board-approval gate (approval seam) binding for a direct_allowed CEO", async () => {
      const heartbeat = heartbeatService(db);
      const { agentId } = await seedCompanyWithAgent({
        role: "ceo",
        ceoExecutionPolicy: "direct_allowed",
        agentStatus: "pending_approval",
      });
      await expect(
        heartbeat.invoke(agentId, "on_demand", { taskKey: "unapproved-wake" }, "manual"),
      ).rejects.toMatchObject({
        status: 409,
        details: expect.objectContaining({ reason: "pending_approval" }),
      });
      expect(capturedAdapterInputs).toHaveLength(0);
    });

    it("keeps budget hard-stops (budget seam) binding for a direct_allowed company", async () => {
      const heartbeat = heartbeatService(db);
      const { companyId, agentId } = await seedCompanyWithAgent({
        role: "ceo",
        ceoExecutionPolicy: "direct_allowed",
      });
      await db.insert(budgetPolicies).values({
        companyId,
        scopeType: "company",
        scopeId: companyId,
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        amount: 100,
        hardStopEnabled: true,
        isActive: true,
      });
      await db.insert(costEvents).values({
        companyId,
        agentId,
        provider: "test",
        model: "test-model",
        costCents: 150,
        occurredAt: new Date(),
      });
      await expect(
        heartbeat.invoke(agentId, "on_demand", { taskKey: "over-budget-wake" }, "manual"),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("budget"),
        details: expect.objectContaining({ scopeType: "company" }),
      });
      expect(capturedAdapterInputs).toHaveLength(0);
    });

    it("keeps pause holds (pause seam) binding for a direct_allowed CEO", async () => {
      const heartbeat = heartbeatService(db);
      const { companyId, agentId } = await seedCompanyWithAgent({
        role: "ceo",
        ceoExecutionPolicy: "direct_allowed",
      });
      const issueId = await seedIssue(companyId, { status: "in_progress" });
      await db.insert(issueTreeHolds).values({
        companyId,
        rootIssueId: issueId,
        mode: "pause",
        status: "active",
        reason: "Test pause hold",
        createdByActorType: "user",
        createdByUserId: "test-user",
      });

      const result = await heartbeat.invoke(
        agentId,
        "on_demand",
        { issueId, taskKey: "paused-wake" },
        "manual",
      );
      expect(result).toBeNull();
      expect(capturedAdapterInputs).toHaveLength(0);
      const wake = await db
        .select({ reason: agentWakeupRequests.reason })
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, agentId));
      expect(wake.map((row) => row.reason)).toContain("issue_tree_hold_active");
    });

    it("keeps low-trust review restrictions (low-trust seam) binding for direct_allowed companies", async () => {
      const { companyId, agentId } = await seedCompanyWithAgent({
        role: "ceo",
        ceoExecutionPolicy: "direct_allowed",
      });
      const issueId = randomUUID();
      const resolution = resolveCoreTrustPreset({
        companyId,
        issue: {
          companyId,
          executionPolicy: {
            authorizationPolicy: {
              trustPreset: "low_trust_review",
              trustBoundary: {
                mode: "low_trust_review",
                companyId,
                issueIds: [issueId],
                allowedAgentIds: [agentId],
                allowedSecretBindingIds: [],
              },
            },
          },
        },
      });
      expect(resolution.kind).toBe("low_trust_review");

      const secretsSvc = {
        resolveEnvBindings: vi.fn(async () => ({ env: {}, secretKeys: new Set<string>(), manifest: [] })),
        resolveAdapterConfigForRuntime: vi.fn(async () => ({ config: {}, secretKeys: new Set<string>(), manifest: [] })),
        collectMissingRuntimeBindings: vi.fn(async () => []),
        collectMissingAdapterConfigRuntimeBindings: vi.fn(async () => []),
      } as Parameters<typeof resolveExecutionRunAdapterConfig>[0]["secretsSvc"];

      await expect(
        resolveExecutionRunAdapterConfig({
          companyId,
          agentId,
          executionRunConfig: { env: { API_KEY: "inline-secret" } },
          secretsSvc,
          trustPreset: resolution,
        }),
      ).rejects.toMatchObject({
        status: 422,
        details: expect.objectContaining({ code: "low_trust_inline_sensitive_env_denied" }),
      });
    });
  });
});
