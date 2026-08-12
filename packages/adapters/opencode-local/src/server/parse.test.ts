import { describe, expect, it } from "vitest";
import { parseOpenCodeJsonl, isOpenCodeUnknownSessionError } from "./parse.js";

describe("parseOpenCodeJsonl", () => {
  it("parses assistant text, usage, cost, and errors", () => {
    const stdout = [
      JSON.stringify({
        type: "text",
        sessionID: "session_123",
        part: { text: "Hello from OpenCode" },
      }),
      JSON.stringify({
        type: "step_finish",
        sessionID: "session_123",
        part: {
          reason: "done",
          cost: 0.0025,
          tokens: {
            input: 120,
            output: 40,
            reasoning: 10,
            cache: { read: 20, write: 0 },
          },
        },
      }),
      JSON.stringify({
        type: "error",
        sessionID: "session_123",
        error: { message: "model unavailable" },
      }),
    ].join("\n");

    const parsed = parseOpenCodeJsonl(stdout);
    expect(parsed.sessionId).toBe("session_123");
    expect(parsed.summary).toBe("Hello from OpenCode");
    expect(parsed.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 50,
    });
    expect(parsed.costUsd).toBeCloseTo(0.0025, 6);
    expect(parsed.errorMessage).toContain("model unavailable");
    expect(parsed.toolErrors).toEqual([]);
  });

  it("keeps failed tool calls separate from fatal run errors", () => {
    const stdout = [
      JSON.stringify({
        type: "tool_use",
        sessionID: "session_123",
        part: {
          state: {
            status: "error",
            error: "File not found: e2b-adapter-result.txt",
          },
        },
      }),
      JSON.stringify({
        type: "text",
        sessionID: "session_123",
        part: { text: "Recovered and completed the task" },
      }),
    ].join("\n");

    const parsed = parseOpenCodeJsonl(stdout);
    expect(parsed.sessionId).toBe("session_123");
    expect(parsed.summary).toBe("Recovered and completed the task");
    expect(parsed.errorMessage).toBeNull();
    expect(parsed.toolErrors).toEqual(["File not found: e2b-adapter-result.txt"]);
  });

  it("detects unknown session errors", () => {
    expect(isOpenCodeUnknownSessionError("Session not found: s_123", "")).toBe(true);
    expect(isOpenCodeUnknownSessionError("", "unknown session id")).toBe(true);
    expect(isOpenCodeUnknownSessionError("all good", "")).toBe(false);
  });
});

describe("isOpenCodeUnknownSessionError requires unambiguous session evidence", () => {
  it("does not classify a transient network NotFoundError as an unknown session", () => {
    expect(isOpenCodeUnknownSessionError("", "NotFoundError: network resource unavailable")).toBe(false);
  });

  it("does not classify a JSONL error event with a NotFoundError name as an unknown session", () => {
    const stdout = JSON.stringify({
      type: "error",
      error: { name: "NotFoundError", message: "network resource unavailable" },
    });
    expect(isOpenCodeUnknownSessionError(stdout, "")).toBe(false);
  });

  it("does not classify bare no-session phrasing as an unknown session", () => {
    expect(isOpenCodeUnknownSessionError("no session", "")).toBe(false);
    expect(isOpenCodeUnknownSessionError("", "no session available right now")).toBe(false);
  });

  it("classifies an existential no-session claim as unknown", () => {
    expect(isOpenCodeUnknownSessionError("Error: no session found with id s_123", "")).toBe(true);
    expect(isOpenCodeUnknownSessionError("", "no session exists for s_123")).toBe(true);
  });

  it("keeps the documented session-specific evidence classified as unknown", () => {
    expect(isOpenCodeUnknownSessionError("Session not found: s_123", "")).toBe(true);
    expect(isOpenCodeUnknownSessionError("", "unknown session id")).toBe(true);
    expect(
      isOpenCodeUnknownSessionError(
        "",
        "NotFoundError: Resource not found: /Users/test/.local/share/opencode/storage/session/project/ses_missing.json",
      ),
    ).toBe(true);
  });
});
