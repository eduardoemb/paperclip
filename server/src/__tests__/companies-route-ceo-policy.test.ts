import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "11111111-1111-4111-8111-111111111111";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
  ensureRoleDefaultGrants: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockCompanyArtifactsService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockFeedbackService = vi.hoisted(() => ({
  listFeedbackTraces: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerCompanyRouteMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    budgetService: () => mockBudgetService,
    companyArtifactsService: () => mockCompanyArtifactsService,
    companyPortabilityService: () => mockCompanyPortabilityService,
    companyService: () => mockCompanyService,
    feedbackService: () => mockFeedbackService,
    logActivity: mockLogActivity,
  }));
}

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>) {
  registerCompanyRouteMocks();
  appImportCounter += 1;
  const routeModulePath = `../routes/companies.js?ceo-policy-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?ceo-policy-${appImportCounter}`;
  const [{ companyRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/companies.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: companyId,
    name: "Paperclip",
    status: "active",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    interactionResolverGovernance: {},
    ceoExecutionPolicy: "delegate_first",
    ...overrides,
  };
}

const boardActor = {
  type: "board",
  userId: "board-user-1",
  source: "session",
  companyIds: [companyId],
  isInstanceAdmin: false,
};

const ceoAgentActor = {
  type: "agent",
  agentId: "ceo-agent-1",
  companyId,
  companyIds: [companyId],
};

beforeEach(() => {
  vi.resetModules();
  mockCompanyService.update.mockReset();
  mockCompanyService.getById.mockReset();
  mockAgentService.getById.mockReset();
  mockLogActivity.mockReset();
  mockCompanyService.getById.mockResolvedValue(companyRow());
  mockCompanyService.update.mockImplementation(async (_id: string, data: Record<string, unknown>) =>
    companyRow(data));
});

describe("PATCH /api/companies/:companyId ceoExecutionPolicy", () => {
  it("lets the board persist a direct_allowed policy", async () => {
    const app = await createApp(boardActor);
    const response = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ ceoExecutionPolicy: "direct_allowed" });

    expect(response.status).toBe(200);
    expect(mockCompanyService.update).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ ceoExecutionPolicy: "direct_allowed" }),
      expect.anything(),
    );
  });

  it("rejects unsupported policy values", async () => {
    const app = await createApp(boardActor);
    const response = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ ceoExecutionPolicy: "direct_always" });

    expect(response.status).toBe(400);
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("rejects ceoExecutionPolicy on agent PATCH so branding stays branding-only", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "ceo-agent-1",
      companyId,
      role: "ceo",
    });
    const app = await createApp(ceoAgentActor);
    const response = await request(app)
      .patch(`/api/companies/${companyId}`)
      .send({ ceoExecutionPolicy: "direct_allowed" });

    expect(response.status).toBe(400);
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });
});
