import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  ensurePaperclipSkillSymlink,
  removeMaintainerOnlySkillSymlinks,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
} = vi.hoisted(() => ({
  ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
  ensureAdapterExecutionTargetRuntimeCommandInstalled: vi.fn(async () => undefined),
  ensurePaperclipSkillSymlink: vi.fn(async () => "skipped" as const),
  removeMaintainerOnlySkillSymlinks: vi.fn(async () => []),
  resolveAdapterExecutionTargetCommandForLogs: vi.fn(async () => "opencode"),
  runAdapterExecutionTargetProcess: vi.fn(
    async (
      _runId: string,
      _target: unknown,
      _command: string,
      _args: string[],
      _opts?: { cwd?: string },
    ) => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      pid: 1,
      startedAt: new Date().toISOString(),
    }),
  ),
}));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetCommandResolvable,
    ensureAdapterExecutionTargetRuntimeCommandInstalled,
    resolveAdapterExecutionTargetCommandForLogs,
    runAdapterExecutionTargetProcess,
  };
});

// The local path injects OpenCode skills into the host ~/.claude/skills and
// probes `opencode models`; both must stay inert in tests.
vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensurePaperclipSkillSymlink,
    removeMaintainerOnlySkillSymlinks,
  };
});

import { execute } from "./execute.js";

const UNKNOWN_SESSION_STORAGE_PATH_ERROR =
  "NotFoundError: Resource not found: /Users/test/.local/share/opencode/storage/session/project/ses_missing.json";

function buildContext(cwd: string, extraArgs: string[] = []) {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "OpenCode Builder",
      adapterType: "opencode_local",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: {
        sessionId: "stored-session-1",
        cwd,
      },
      sessionDisplayId: "stored-session-1",
      taskKey: "task-1",
      resumeDecision: "compatible",
    },
    config: {
      command: "opencode",
      model: "opencode/gpt-5-nano",
      cwd,
      extraArgs,
    },
    context: {},
    onLog: vi.fn(async () => {}),
  };
}

function buildTransientFailure() {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    stdout: JSON.stringify({
      type: "error",
      error: { name: "NotFoundError", message: "network resource unavailable" },
    }),
    stderr: "",
    pid: 1,
    startedAt: new Date().toISOString(),
  };
}

function buildSuccessOutput(sessionId: string) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: [
      JSON.stringify({ type: "step_start", sessionID: sessionId }),
      JSON.stringify({ type: "text", sessionID: sessionId, part: { text: "done" } }),
    ].join("\n"),
    stderr: "",
    pid: 2,
    startedAt: new Date().toISOString(),
  };
}

describe("opencode_local session rotation at the runtime boundary", () => {
  const cleanupDirs: string[] = [];
  const originalOpenCodeAllowAllModels = process.env.OPENCODE_ALLOW_ALL_MODELS;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENCODE_ALLOW_ALL_MODELS", "true");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (originalOpenCodeAllowAllModels === undefined) {
      delete process.env.OPENCODE_ALLOW_ALL_MODELS;
    } else {
      process.env.OPENCODE_ALLOW_ALL_MODELS = originalOpenCodeAllowAllModels;
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("does not rotate a session when the resume attempt fails with a transient network error", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-transient-"));
    cleanupDirs.push(cwd);
    runAdapterExecutionTargetProcess.mockResolvedValueOnce(buildTransientFailure());

    const result = await execute(buildContext(cwd) as never);

    // No fresh-session retry: the process runner ran exactly once with the
    // stored session and the transient failure is surfaced as a run failure.
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
    const args = runAdapterExecutionTargetProcess.mock.calls[0]?.[3] as string[] | undefined;
    expect(args).toContain("--session");
    expect(args).toContain("stored-session-1");

    expect(result.clearSession).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("network resource unavailable");
    // The stored session is preserved: the result still reports it so the
    // control plane keeps the row and resumes it on the next wake.
    expect(result.sessionId).toBe("stored-session-1");
    expect(result.sessionParams).toMatchObject({ sessionId: "stored-session-1" });
  });

  it("preserves configured profile arguments and cwd when resuming", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-resume-"));
    cleanupDirs.push(cwd);
    runAdapterExecutionTargetProcess.mockResolvedValueOnce(buildSuccessOutput("stored-session-1"));

    const result = await execute(buildContext(cwd, ["--agent", "sdd-orchestrator-high"]) as never);

    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
    const args = runAdapterExecutionTargetProcess.mock.calls[0]?.[3] as string[] | undefined;
    expect(args).toEqual(
      expect.arrayContaining(["--session", "stored-session-1", "--agent", "sdd-orchestrator-high"]),
    );
    const processOptions = runAdapterExecutionTargetProcess.mock.calls[0]?.[4] as { cwd: string } | undefined;
    expect(processOptions?.cwd).toBe(cwd);
    expect(result.sessionParams).toMatchObject({ sessionId: "stored-session-1", cwd });
  });

  it("rotates once when the resume attempt reports the stored session file is missing", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-unknown-"));
    cleanupDirs.push(cwd);
    runAdapterExecutionTargetProcess
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: UNKNOWN_SESSION_STORAGE_PATH_ERROR,
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce(buildSuccessOutput("fresh-session-2"));

    const result = await execute(buildContext(cwd) as never);

    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(2);
    const firstArgs = runAdapterExecutionTargetProcess.mock.calls[0]?.[3] as string[] | undefined;
    const retryArgs = runAdapterExecutionTargetProcess.mock.calls[1]?.[3] as string[] | undefined;
    expect(firstArgs).toContain("--session");
    expect(firstArgs).toContain("stored-session-1");
    expect(retryArgs).not.toContain("--session");
    expect(result.sessionId).toBe("fresh-session-2");
    // The stale reference is replaced: the fresh session id is reported back
    // to the control plane so the old stored session is no longer resumed.
    expect(result.sessionParams).toMatchObject({ sessionId: "fresh-session-2" });
    expect(result.clearSession).toBe(false);
  });

  it("clears the stored session when the unknown-session retry also produces no session", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-clear-"));
    cleanupDirs.push(cwd);
    runAdapterExecutionTargetProcess
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: UNKNOWN_SESSION_STORAGE_PATH_ERROR,
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "provider unavailable",
        pid: 2,
        startedAt: new Date().toISOString(),
      });

    const result = await execute(buildContext(cwd) as never);

    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(2);
    expect(result.clearSession).toBe(true);
    expect(result.sessionId).toBeNull();
    expect(result.sessionParams).toBeNull();
  });
});
