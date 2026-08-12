import { describe, expect, it } from "vitest";
import { updateCompanyBrandingSchema, updateCompanySchema } from "./company.js";

describe("updateCompanySchema ceoExecutionPolicy", () => {
  it("accepts direct_allowed as a board-only company policy value", () => {
    const result = updateCompanySchema.parse({ ceoExecutionPolicy: "direct_allowed" });
    expect(result.ceoExecutionPolicy).toBe("direct_allowed");
  });

  it("accepts delegate_first explicitly", () => {
    const result = updateCompanySchema.parse({ ceoExecutionPolicy: "delegate_first" });
    expect(result.ceoExecutionPolicy).toBe("delegate_first");
  });

  it("rejects unsupported policy values", () => {
    expect(() => updateCompanySchema.parse({ ceoExecutionPolicy: "direct_always" })).toThrow();
  });
});

describe("updateCompanyBrandingSchema ceoExecutionPolicy", () => {
  it("rejects ceoExecutionPolicy so agent PATCH stays branding-only", () => {
    expect(() =>
      updateCompanyBrandingSchema.parse({ ceoExecutionPolicy: "direct_allowed" }),
    ).toThrow();
  });
});
