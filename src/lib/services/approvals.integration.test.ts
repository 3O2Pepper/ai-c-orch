import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// Replay-safety contract: createApproval called twice for the same still-
// open gate (a retried Inngest step) returns the SAME approval instead of
// duplicating it — enforced by the approvals_one_pending_per_gate_uq
// partial unique index. Needs a real database; skips without DATABASE_URL.

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("approval idempotency (integration)", () => {
  const scratchProjectIds: string[] = [];

  afterAll(async () => {
    const { getDb } = await import("@/lib/db/client");
    const { approvals, events, projects } = await import("@/lib/db/schema");
    const db = getDb();
    for (const id of scratchProjectIds) {
      await db.delete(events).where(eq(events.projectId, id));
      await db.delete(approvals).where(eq(approvals.projectId, id));
      await db.delete(projects).where(eq(projects.id, id));
    }
  });

  async function makeScratchProject() {
    const { getDb } = await import("@/lib/db/client");
    const { getDevUserId } = await import("@/lib/db/dev-user");
    const { projects } = await import("@/lib/db/schema");
    const [project] = await getDb()
      .insert(projects)
      .values({
        userId: await getDevUserId(),
        title: "approval test (scratch)",
        rawRequest: "approval idempotency test",
        state: "running",
      })
      .returning({ id: projects.id });
    scratchProjectIds.push(project.id);
    return project.id;
  }

  it("returns the existing approval on a replayed create", async () => {
    const { createApproval } = await import("./approvals");
    const { getDb } = await import("@/lib/db/client");
    const { approvals } = await import("@/lib/db/schema");

    const projectId = await makeScratchProject();
    const first = await createApproval(projectId, "needs_input", { question: "q?" });
    const replayed = await createApproval(projectId, "needs_input", { question: "q?" });
    expect(replayed).toBe(first);

    const rows = await getDb()
      .select()
      .from(approvals)
      .where(eq(approvals.projectId, projectId));
    expect(rows).toHaveLength(1); // no duplicate gate
  });

  it("allows a new approval once the previous one is resolved", async () => {
    const { createApproval, resolveApproval, getApprovalResolution } = await import(
      "./approvals"
    );

    const projectId = await makeScratchProject();
    const first = await createApproval(projectId, "delivery", { artifactVersion: 1 });
    expect(await getApprovalResolution(first)).toBeNull(); // pending

    expect(await resolveApproval(projectId, first, "rejected", "Revision requested")).toBe(
      true,
    );
    expect(await resolveApproval(projectId, first, "approved")).toBe(false); // second resolve loses

    const resolution = await getApprovalResolution(first);
    expect(resolution).toMatchObject({ status: "rejected", note: "Revision requested" });

    const second = await createApproval(projectId, "delivery", { artifactVersion: 2 });
    expect(second).not.toBe(first); // resolved gate no longer blocks a new round
  });
});
