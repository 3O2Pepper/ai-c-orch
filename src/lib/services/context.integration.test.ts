import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { ProjectSpec } from "@/lib/core/spec";

// Context service contract: pinned items supersede cleanly, decisions are
// replay-safe by source, digests supersede older versions, and assembly
// respects the token budget while always keeping pinned items. No model
// calls in these paths. Needs a real database; skips without DATABASE_URL.

const hasDb = Boolean(process.env.DATABASE_URL);

const SPEC: ProjectSpec = {
  title: "Ctx test",
  goal: "g",
  deliverables: [{ kind: "report", description: "d" }],
  constraints: [],
  success_criteria: [],
  assumptions: [],
  blocking_questions: [],
};

describe.skipIf(!hasDb)("context service (integration)", () => {
  const scratchProjectIds: string[] = [];

  afterAll(async () => {
    const { getDb } = await import("@/lib/db/client");
    const { contextItems, events, projects } = await import("@/lib/db/schema");
    const db = getDb();
    for (const id of scratchProjectIds) {
      // superseded_by self-references block a naive delete — clear first
      await db
        .update(contextItems)
        .set({ supersededBy: null })
        .where(eq(contextItems.projectId, id));
      await db.delete(contextItems).where(eq(contextItems.projectId, id));
      await db.delete(events).where(eq(events.projectId, id));
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
        title: "context test (scratch)",
        rawRequest: "context service test",
        state: "running",
      })
      .returning({ id: projects.id });
    scratchProjectIds.push(project.id);
    return project.id;
  }

  it("pins the spec idempotently and supersedes on change", async () => {
    const { pinSpec } = await import("./context");
    const { getDb } = await import("@/lib/db/client");
    const { contextItems } = await import("@/lib/db/schema");

    const projectId = await makeScratchProject();
    await pinSpec(projectId, SPEC, 1);
    await pinSpec(projectId, SPEC, 1); // replay — must not duplicate

    const db = getDb();
    let rows = await db
      .select()
      .from(contextItems)
      .where(eq(contextItems.projectId, projectId));
    expect(rows.filter((r) => r.kind === "pinned_spec")).toHaveLength(1);

    await pinSpec(projectId, { ...SPEC, goal: "changed" }, 2);
    rows = await db
      .select()
      .from(contextItems)
      .where(eq(contextItems.projectId, projectId));
    const specs = rows.filter((r) => r.kind === "pinned_spec");
    expect(specs).toHaveLength(2);
    expect(specs.filter((r) => r.supersededBy === null)).toHaveLength(1);
  });

  it("records decisions replay-safely by source", async () => {
    const { recordDecision } = await import("./context");
    const { getDb } = await import("@/lib/db/client");
    const { contextItems } = await import("@/lib/db/schema");

    const projectId = await makeScratchProject();
    await recordDecision(projectId, "Use EU pricing", "approval:a1");
    await recordDecision(projectId, "Use EU pricing", "approval:a1"); // replay
    await recordDecision(projectId, "Focus on SMB", "approval:a2");

    const rows = await getDb()
      .select()
      .from(contextItems)
      .where(eq(contextItems.projectId, projectId));
    expect(rows.filter((r) => r.kind === "decision")).toHaveLength(2);
  });

  it("keeps only the newest artifact digest live", async () => {
    const { recordArtifactDigest } = await import("./context");
    const { getDb } = await import("@/lib/db/client");
    const { contextItems } = await import("@/lib/db/schema");

    const projectId = await makeScratchProject();
    await recordArtifactDigest(projectId, "art-1", "v1 digest");
    await recordArtifactDigest(projectId, "art-2", "v2 digest");

    const rows = await getDb()
      .select()
      .from(contextItems)
      .where(eq(contextItems.projectId, projectId));
    const digests = rows.filter((r) => r.kind === "artifact_digest");
    expect(digests).toHaveLength(2);
    const live = digests.filter((r) => r.supersededBy === null);
    expect(live).toHaveLength(1);
    expect(live[0].content).toBe("v2 digest");
  });

  it("assembles pinned items always, budget-gated digests newest-first", async () => {
    const { assembleContext, pinSpec, recordArtifactDigest, recordDecision } =
      await import("./context");

    const projectId = await makeScratchProject();
    await pinSpec(projectId, SPEC, 1);
    await recordDecision(projectId, "Ship in USD", "approval:b1");
    await recordArtifactDigest(projectId, "art-9", "x".repeat(4000)); // ~1000 tokens

    // Budget too small for the digest but pinned items still included
    const tight = await assembleContext(projectId, 10);
    expect(tight).toContain("Project spec:");
    expect(tight).toContain("Ship in USD");
    expect(tight).not.toContain("xxxx");

    const roomy = await assembleContext(projectId, 100_000);
    expect(roomy).toContain("Current artifact digest:");
  });

  it("does not roll up below the threshold (no model call)", async () => {
    const { maybeRollUpDecisions, recordDecision } = await import("./context");
    const projectId = await makeScratchProject();
    await recordDecision(projectId, "d1", "approval:c1");
    expect(await maybeRollUpDecisions(projectId)).toBe(false);
  });
});
