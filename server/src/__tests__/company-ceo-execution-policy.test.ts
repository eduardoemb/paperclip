import { describe, expect, it } from "vitest";
import {
  buildCeoExecutionPolicyOverlay,
  ceoExecutionPolicyAllowsDirectExecution,
  resolveCeoExecutionPolicy,
} from "../services/company-ceo-execution-policy.ts";

describe("resolveCeoExecutionPolicy", () => {
  it("defaults missing values to delegate_first", () => {
    expect(resolveCeoExecutionPolicy(undefined)).toBe("delegate_first");
    expect(resolveCeoExecutionPolicy(null)).toBe("delegate_first");
  });

  it("defaults unknown values to delegate_first", () => {
    expect(resolveCeoExecutionPolicy("direct_always")).toBe("delegate_first");
    expect(resolveCeoExecutionPolicy(42)).toBe("delegate_first");
  });

  it("passes through both supported modes", () => {
    expect(resolveCeoExecutionPolicy("delegate_first")).toBe("delegate_first");
    expect(resolveCeoExecutionPolicy("direct_allowed")).toBe("direct_allowed");
  });
});

describe("ceoExecutionPolicyAllowsDirectExecution", () => {
  it("permits direct execution only under direct_allowed", () => {
    expect(ceoExecutionPolicyAllowsDirectExecution("direct_allowed")).toBe(true);
    expect(ceoExecutionPolicyAllowsDirectExecution("delegate_first")).toBe(false);
  });
});

describe("buildCeoExecutionPolicyOverlay", () => {
  it("requires delegation before direct IC work under delegate_first", () => {
    const overlay = buildCeoExecutionPolicyOverlay({
      policy: "delegate_first",
      companyId: "company-a",
      agentId: "agent-a",
    });
    expect(overlay).toContain("delegate_first");
    expect(overlay).toContain("MUST delegate");
    expect(overlay).not.toContain("MAY execute");
  });

  it("allows direct execution while preserving control-plane constraints under direct_allowed", () => {
    const overlay = buildCeoExecutionPolicyOverlay({
      policy: "direct_allowed",
      companyId: "company-a",
      agentId: "agent-a",
    });
    expect(overlay).toContain("direct_allowed");
    expect(overlay).toContain("MAY execute");
    // Control-plane constraints stay binding: authorization, approval gates,
    // budget hard-stops, pause holds, and low-trust review restrictions.
    expect(overlay).toContain("authorization");
    expect(overlay).toContain("approval");
    expect(overlay).toContain("budget");
    expect(overlay).toContain("low-trust review");
  });

  it("names the company so the overlay cannot be confused across companies", () => {
    const overlay = buildCeoExecutionPolicyOverlay({
      policy: "direct_allowed",
      companyId: "company-a",
      agentId: "agent-a",
    });
    expect(overlay).toContain("company-a");
  });
});
