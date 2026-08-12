import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  approvals,
  companies,
  createDb,
  issueApprovals,
  issueInboxArchives,
  issueLabels,
  issueWorkProducts,
  issues,
  labels,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { issueService } from "../services/issues.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("lab completion guard routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const originalLabCompletionLabel = process.env.PAPERCLIP_LAB_COMPLETION_LABEL;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-lab-completion-guard-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  beforeEach(() => {
    process.env.PAPERCLIP_LAB_COMPLETION_LABEL = "gentle-ai-lab";
  });

  afterEach(async () => {
    if (originalLabCompletionLabel === undefined) delete process.env.PAPERCLIP_LAB_COMPLETION_LABEL;
    else process.env.PAPERCLIP_LAB_COMPLETION_LABEL = originalLabCompletionLabel;
    await db.delete(issueWorkProducts);
    await db.delete(issueApprovals);
    await db.delete(approvals);
    await db.delete(issueInboxArchives);
    await db.delete(issueLabels);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(labels);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function appFor(companyId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "session",
        userId: "board-user",
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "operator", status: "active" }],
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    return app;
  }

  async function seedIssue(input: { lab?: boolean; evidence?: boolean; approval?: boolean }) {
    const companyId = randomUUID();
    const issueId = randomUUID();
    const labelId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "B2 Lab Company", issuePrefix: `B2${randomUUID().slice(0, 6)}` });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "B2 completion candidate",
      status: "todo",
      priority: "medium",
    });
    if (input.lab) {
      await db.insert(labels).values({ id: labelId, companyId, name: "gentle-ai-lab", color: "blue" });
      await db.insert(issueLabels).values({ issueId, labelId, companyId });
    }
    if (input.evidence) {
      const verifyAt = new Date("2026-08-11T12:01:00.000Z");
      const archiveAt = new Date("2026-08-11T12:02:00.000Z");
      await db.insert(issueWorkProducts).values([
        {
          id: randomUUID(),
          companyId,
          issueId,
          type: "artifact",
          provider: "paperclip",
          title: "Verify evidence",
          status: "available",
          metadata: { phase: "verify", status: "completed" },
          createdAt: verifyAt,
          updatedAt: verifyAt,
        },
        {
          id: randomUUID(),
          companyId,
          issueId,
          type: "artifact",
          provider: "paperclip",
          title: "Archive evidence",
          status: "available",
          metadata: { phase: "archive", status: "completed" },
          createdAt: archiveAt,
          updatedAt: archiveAt,
        },
      ]);
    }
    if (input.approval) {
      const approvalId = randomUUID();
      await db.insert(approvals).values({
        id: approvalId,
        companyId,
        type: "request_board_approval",
        status: "approved",
        payload: { issueId },
        decidedByUserId: "board-user",
        decidedAt: new Date("2026-08-11T12:03:00.000Z"),
      });
      await db.insert(issueApprovals).values({ companyId, issueId, approvalId });
    }
    return { companyId, issueId, labelId };
  }

  it("allows done for non-lab issues", async () => {
    const seeded = await seedIssue({});
    await request(appFor(seeded.companyId)).patch(`/api/issues/${seeded.issueId}`).send({ status: "done" }).expect(200);
    const [issue] = await db.select().from(issues);
    expect(issue.status).toBe("done");
  });

  it("blocks lab issues and rolls back status and labels atomically", async () => {
    const seeded = await seedIssue({ lab: true });
    const response = await request(appFor(seeded.companyId))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ status: "done" })
      .expect(409);
    expect(response.body.details).toEqual({
      code: "lab_completion_blocked",
      missing: ["verify_completed", "archive_completed", "human_approval"],
    });
    const [issue] = await db.select().from(issues);
    expect(issue.status).not.toBe("done");
    expect(await db.select().from(issueLabels)).toHaveLength(1);
  });

  it("allows lab issues with complete evidence and approval", async () => {
    const seeded = await seedIssue({ lab: true, evidence: true, approval: true });
    await request(appFor(seeded.companyId)).patch(`/api/issues/${seeded.issueId}`).send({ status: "done" }).expect(200);
    const [issue] = await db.select().from(issues);
    expect(issue.status).toBe("done");
  });

  it("uses pre-mutation labels when the same patch removes the lab label", async () => {
    const seeded = await seedIssue({ lab: true });
    const response = await request(appFor(seeded.companyId))
      .patch(`/api/issues/${seeded.issueId}`)
      .send({ status: "done", labelIds: [] })
      .expect(409);
    expect(response.body.details.missing).toEqual(["verify_completed", "archive_completed", "human_approval"]);
    const [issue] = await db.select().from(issues);
    expect(issue.status).toBe("todo");
    expect(await db.select().from(issueLabels)).toHaveLength(1);
  });

  it("enforces the same guard for direct service callers", async () => {
    const seeded = await seedIssue({ lab: true });
    await expect(issueService(db).update(seeded.issueId, { status: "done" })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "lab_completion_blocked",
        missing: ["verify_completed", "archive_completed", "human_approval"],
      },
    });
  });

  it("is inert when the lab label env is absent", async () => {
    delete process.env.PAPERCLIP_LAB_COMPLETION_LABEL;
    const seeded = await seedIssue({ lab: true });
    await request(appFor(seeded.companyId)).patch(`/api/issues/${seeded.issueId}`).send({ status: "done" }).expect(200);
    const [issue] = await db.select().from(issues);
    expect(issue.status).toBe("done");
  });
});
