import { describe, expect, it } from "vitest";
import { resolveSessionResumeDecision } from "../services/session-resume-decision.js";

describe("resolveSessionResumeDecision", () => {
  it("returns compatible when the stored execution-target identity matches the resolved target", () => {
    const decision = resolveSessionResumeDecision({
      hasStoredSessionId: true,
      storedIdentity: { transport: "sandbox", environmentId: "env-1", leaseId: "lease-1" },
      identityMatches: true,
      compacted: false,
      configReset: false,
      explicitClear: false,
    });
    expect(decision).toBe("compatible");
  });

  it("rotates with execution_target_mismatch when the stored identity differs from the resolved target", () => {
    const decision = resolveSessionResumeDecision({
      hasStoredSessionId: true,
      storedIdentity: { transport: "sandbox", environmentId: "env-1", leaseId: "lease-1" },
      identityMatches: false,
      compacted: false,
      configReset: false,
      explicitClear: false,
    });
    expect(decision).toBe("execution_target_mismatch");
  });

  it("rotates with missing_execution_target_identity for legacy rows without a stored identity", () => {
    const decision = resolveSessionResumeDecision({
      hasStoredSessionId: true,
      storedIdentity: null,
      identityMatches: false,
      compacted: false,
      configReset: false,
      explicitClear: false,
    });
    expect(decision).toBe("missing_execution_target_identity");
  });

  it("prioritizes compacted over identity compatibility", () => {
    const decision = resolveSessionResumeDecision({
      hasStoredSessionId: true,
      storedIdentity: { transport: "sandbox", environmentId: "env-1", leaseId: "lease-1" },
      identityMatches: true,
      compacted: true,
      configReset: false,
      explicitClear: false,
    });
    expect(decision).toBe("compacted");
  });

  it("prioritizes config_changed over identity compatibility", () => {
    const decision = resolveSessionResumeDecision({
      hasStoredSessionId: true,
      storedIdentity: { transport: "sandbox", environmentId: "env-1", leaseId: "lease-1" },
      identityMatches: true,
      compacted: false,
      configReset: true,
      explicitClear: false,
    });
    expect(decision).toBe("config_changed");
  });

  it("prioritizes explicit_clear over identity compatibility", () => {
    const decision = resolveSessionResumeDecision({
      hasStoredSessionId: true,
      storedIdentity: { transport: "sandbox", environmentId: "env-1", leaseId: "lease-1" },
      identityMatches: true,
      compacted: false,
      configReset: false,
      explicitClear: true,
    });
    expect(decision).toBe("explicit_clear");
  });

  it("returns null when no stored session id exists", () => {
    const decision = resolveSessionResumeDecision({
      hasStoredSessionId: false,
      storedIdentity: null,
      identityMatches: false,
      compacted: false,
      configReset: false,
      explicitClear: false,
    });
    expect(decision).toBeNull();
  });
});
