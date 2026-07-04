import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { eq, sum } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// PLAN commit 10: spent_usd must equal sum(model_calls.cost_usd) — the
// gateway's atomic CTE guarantees it. This test only needs a database
// (logModelCall never calls the model API); it skips when DATABASE_URL is
// absent so `npm test` stays green pre-provisioning.

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("metering consistency (integration)", () => {
  let projectId: string | null = null;

  afterAll(async () => {
    if (!projectId) return;
    const { getDb } = await import("@/lib/db/client");
    const { modelCalls, events, projects } = await import("@/lib/db/schema");
    const db = getDb();
    await db.delete(modelCalls).where(eq(modelCalls.projectId, projectId));
    await db.delete(events).where(eq(events.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("keeps projects.spent_usd equal to sum(model_calls.cost_usd)", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { getDevUserId } = await import("@/lib/db/dev-user");
    const { modelCalls, projects } = await import("@/lib/db/schema");
    const { logModelCall } = await import("@/lib/gateway/log");

    const db = getDb();
    const userId = await getDevUserId();
    const [project] = await db
      .insert(projects)
      .values({
        userId,
        title: "metering test (scratch)",
        rawRequest: "metering consistency test",
        state: "draft",
      })
      .returning({ id: projects.id });
    projectId = project.id;

    await logModelCall({
      projectId: project.id,
      model: "claude-haiku-4-5",
      purpose: "test",
      usage: { inputTokens: 100_000, outputTokens: 20_000 },
      latencyMs: 1,
      status: "ok",
    });
    await logModelCall({
      projectId: project.id,
      model: "claude-opus-4-8",
      purpose: "test",
      usage: {
        inputTokens: 10_000,
        outputTokens: 5_000,
        cacheReadInputTokens: 50_000,
      },
      latencyMs: 1,
      status: "ok",
    });
    // Errored calls log too, at zero cost
    await logModelCall({
      projectId: project.id,
      model: "claude-haiku-4-5",
      purpose: "test",
      usage: null,
      latencyMs: 1,
      status: "error",
      error: "synthetic",
    });

    const [{ total }] = await db
      .select({ total: sum(modelCalls.costUsd) })
      .from(modelCalls)
      .where(eq(modelCalls.projectId, project.id));
    const [{ spentUsd }] = await db
      .select({ spentUsd: projects.spentUsd })
      .from(projects)
      .where(eq(projects.id, project.id));

    expect(Number(spentUsd)).toBeCloseTo(Number(total), 9);
    expect(Number(spentUsd)).toBeGreaterThan(0);
  });
});
