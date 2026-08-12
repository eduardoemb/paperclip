import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentTaskSessions,
  agentRuntimeState,
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import { sessionCodec } from "@paperclipai/adapter-opencode-local/server";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.ts";

const capturedAdapterInputs: Array<{ runId: string; [key: string]: unknown }> = [];

const adapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    summary: "Session continuity test run.",
    provider: "test",
    model: "test-model",
  })),
);

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat-adapter session continuity tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function successResult(sessionId: string) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    summary: "Adapter run completed.",
    provider: "test",
    model: "test-model",
    sessionId,
    sessionParams: { sessionId },
    sessionDisplayId: sessionId,
  };
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

describeEmbeddedPostgres("heartbeat->adapter runtime session continuity", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let oldPaperclipHome: string | undefined;
  let oldPaperclipApiUrl: string | undefined;
  let paperclipHome: string | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-session-continuity-");
    db = createDb(tempDb.connectionString);
    oldPaperclipHome = process.env.PAPERCLIP_HOME;
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-session-continuity-home-"));
    process.env.PAPERCLIP_HOME = paperclipHome;
    // The server normalizes PAPERCLIP_API_URL into its own env at boot; heartbeat
    // gateway delivery requires it, so pin a deterministic value for tests that
    // never boot the full server.
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
      summary: "Session continuity test run.",
      provider: "test",
      model: "test-model",
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await db.execute(sql.raw(`
      TRUNCATE TABLE
        "activity_log",
        "agent_task_sessions",
        "environment_leases",
        "environments",
        "heartbeat_run_events",
        "heartbeat_runs",
        "agent_wakeup_requests",
        "agent_runtime_state",
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

  async function seedCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "OpenCode Builder",
      role: "engineer",
      status: "idle",
      adapterType: "opencode_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function seedTaskSession(input: {
    companyId: string;
    agentId: string;
    taskKey: string;
    sessionId: string;
    executionTargetIdentityJson: Record<string, unknown> | null;
  }) {
    await db.insert(agentTaskSessions).values({
      companyId: input.companyId,
      agentId: input.agentId,
      adapterType: "opencode_local",
      taskKey: input.taskKey,
      sessionParamsJson: { sessionId: input.sessionId },
      executionTargetIdentityJson: input.executionTargetIdentityJson,
      sessionDisplayId: input.sessionId,
    });
  }

  async function readTaskSession(taskKey: string) {
    return db
      .select()
      .from(agentTaskSessions)
      .where(eq(agentTaskSessions.taskKey, taskKey))
      .then((rows) => rows[0] ?? null);
  }

  /**
   * The session row is upserted after the run row leaves "running", so poll
   * until the row reflects this run before asserting persistence.
   */
  async function waitForTaskSessionLastRun(
    taskKey: string,
    runId: string,
    timeoutMs = 5_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    let row: Awaited<ReturnType<typeof readTaskSession>> = null;
    while (Date.now() < deadline) {
      row = await readTaskSession(taskKey);
      if (row?.lastRunId === runId) return row;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return row;
  }

  async function invokeAndWait(heartbeat: ReturnType<typeof heartbeatService>, agentId: string, taskKey: string) {
    const run = await heartbeat.invoke(agentId, "on_demand", { taskKey }, "manual");
    expect(run).not.toBeNull();
    const finished = await waitForRunToFinish(heartbeat, run!.id);
    expect(finished).not.toBeNull();
    return { run: run!, finished: finished! };
  }

  function adapterInputForRun(runId: string) {
    const input = capturedAdapterInputs.find((entry) => entry.runId === runId);
    if (!input) throw new Error(`No adapter input captured for run ${runId}`);
    return input as {
      runId: string;
      runtime: {
        sessionId: string | null;
        sessionParams: Record<string, unknown> | null;
        resumeDecision: string | null;
      };
      context: { paperclipSessionResumeDecision: string | null };
    };
  }

  /**
   * A row seeded directly without config-fingerprint metadata is a legacy row:
   * the first wake rotates it once (`config_changed`) and re-persists it with
   * the fingerprint. This helper plays that priming wake so the follow-up wake
   * under test evaluates identity compatibility instead of fingerprint reset.
   */
  async function primeSession(
    heartbeat: ReturnType<typeof heartbeatService>,
    agentId: string,
    taskKey: string,
    sessionId: string,
  ) {
    adapterExecute.mockImplementation(async () => successResult(sessionId));
    const { run, finished } = await invokeAndWait(heartbeat, agentId, taskKey);
    expect(finished.status).toBe("succeeded");
    // Wait for the session row upsert (it lands after the run status write)
    // so a follow-up mutation of the row is deterministic.
    await waitForTaskSessionLastRun(taskKey, run.id);
    adapterExecute.mockClear();
    return run;
  }

  it("reuses the stored session when the wake resolves to a compatible execution target", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    await seedTaskSession({
      companyId,
      agentId,
      taskKey: "task-1",
      sessionId: "stored-session-1",
      executionTargetIdentityJson: null,
    });

    const heartbeat = heartbeatService(db);
    await primeSession(heartbeat, agentId, "task-1", "stored-session-1");

    const { run } = await invokeAndWait(heartbeat, agentId, "task-1");
    expect(run).not.toBeNull();

    const adapterInput = adapterInputForRun(run.id);
    expect(adapterInput.runtime).toMatchObject({
      sessionId: "stored-session-1",
      sessionParams: expect.objectContaining({ sessionId: "stored-session-1" }),
      resumeDecision: "compatible",
    });
    expect(adapterInput.context.paperclipSessionResumeDecision).toBe("compatible");

    const row = await waitForTaskSessionLastRun("task-1", run.id);
    expect(row?.sessionParamsJson).toMatchObject({ sessionId: "stored-session-1" });
    expect(row?.sessionDisplayId).toBe("stored-session-1");
    expect(row?.lastRunId).toBe(run.id);
  });

  it("rotates with an observable fallback when the stored execution-target identity is incompatible", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    await seedTaskSession({
      companyId,
      agentId,
      taskKey: "task-2",
      sessionId: "stored-session-2",
      executionTargetIdentityJson: null,
    });

    const heartbeat = heartbeatService(db);
    await primeSession(heartbeat, agentId, "task-2", "stored-session-2");
    // The stored session was created on a sandbox execution target; the wake
    // resolves to a local target, so the identity must not match.
    await db
      .update(agentTaskSessions)
      .set({
        executionTargetIdentityJson: {
          transport: "sandbox",
          providerKey: "e2b",
          environmentId: "env-1",
          leaseId: "lease-1",
          remoteCwd: "/workspace",
        },
      })
      .where(eq(agentTaskSessions.taskKey, "task-2"));

    adapterExecute.mockImplementation(async () => successResult("fresh-session-2"));
    const { run } = await invokeAndWait(heartbeat, agentId, "task-2");
    expect(run).not.toBeNull();

    const adapterInput = adapterInputForRun(run.id);
    expect(adapterInput.runtime).toMatchObject({
      sessionId: null,
      sessionParams: null,
      resumeDecision: "execution_target_mismatch",
    });
    expect(adapterInput.context.paperclipSessionResumeDecision).toBe("execution_target_mismatch");

    // The rotation reason is observable in the run transcript.
    const log = await heartbeat.readLog(run.id);
    expect(log.content).toContain(
      "[paperclip] Starting a fresh session because execution_target_mismatch.",
    );

    // The stale stored session is replaced by the fresh one on the realized target.
    const row = await waitForTaskSessionLastRun("task-2", run.id);
    expect(row?.sessionParamsJson).toMatchObject({ sessionId: "fresh-session-2" });
    expect(row?.sessionDisplayId).toBe("fresh-session-2");
    expect(row?.executionTargetIdentityJson).toBeNull();
  });

  it("keeps the stored session row when a resume attempt fails transiently", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    await seedTaskSession({
      companyId,
      agentId,
      taskKey: "task-3",
      sessionId: "stored-session-3",
      executionTargetIdentityJson: null,
    });

    const heartbeat = heartbeatService(db);
    await primeSession(heartbeat, agentId, "task-3", "stored-session-3");

    // Mimics the opencode adapter surfacing a transient network failure while
    // preserving the stored session (no clearSession, no rotation).
    adapterExecute.mockImplementation(async () => ({
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "NotFoundError: network resource unavailable",
      summary: "",
      provider: "test",
      model: "test-model",
      sessionId: "stored-session-3",
      sessionParams: { sessionId: "stored-session-3" },
      sessionDisplayId: "stored-session-3",
      clearSession: false,
    }));

    const { run, finished } = await invokeAndWait(heartbeat, agentId, "task-3");
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("network resource unavailable");

    const adapterInput = adapterInputForRun(run.id);
    // The stored session was actually attempted on this wake.
    expect(adapterInput.runtime).toMatchObject({
      sessionId: "stored-session-3",
      resumeDecision: "compatible",
    });

    // The transient failure must NOT rotate the session: the stored row survives
    // with the same session id so the next wake can resume it.
    const row = await waitForTaskSessionLastRun("task-3", run.id);
    expect(row).not.toBeNull();
    expect(row?.sessionParamsJson).toMatchObject({ sessionId: "stored-session-3" });
    expect(row?.sessionDisplayId).toBe("stored-session-3");
    expect(row?.lastError).toContain("network resource unavailable");
  });
});
