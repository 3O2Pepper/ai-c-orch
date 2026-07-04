import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// Atomicity contract: a transition writes the new state AND its event
// together, or writes nothing (race loser / failed insert). Needs a real
// database; skips when DATABASE_URL is absent.

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("atomic state transitions (integration)", () => {
  const scratchProjectIds: string[] = [];

  afterAll(async () => {
    const { getDb } = await import("@/lib/db/client");
    const { events, phases, projects } = await import("@/lib/db/schema");
    const db = getDb();
    for (const id of scratchProjectIds) {
      await db.delete(events).where(eq(events.projectId, id));
      await db.delete(phases).where(eq(phases.projectId, id));
      await db.delete(projects).where(eq(projects.id, id));
    }
  });

  async function makeScratchProject(state: string) {
    const { getDb } = await import("@/lib/db/client");
    const { getDevUserId } = await import("@/lib/db/dev-user");
    const { projects } = await import("@/lib/db/schema");
    const db = getDb();
    const userId = await getDevUserId();
    const [project] = await db
      .insert(projects)
      .values({
        userId,
        title: "state test (scratch)",
        rawRequest: "atomic transition test",
        state,
      })
      .returning({ id: projects.id });
    scratchProjectIds.push(project.id);
    return project.id;
  }

  it("writes state and event together on success", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { events, projects } = await import("@/lib/db/schema");
    const { applyProjectTransition } = await import("./state");
    const db = getDb();

    const projectId = await makeScratchProject("draft");
    const to = await applyProjectTransition(projectId, "draft", {
      type: "intake_started",
    });
    expect(to).toBe("specifying");

    const [p] = await db
      .select({ state: projects.state })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(p.state).toBe("specifying");

    const evs = await db
      .select()
      .from(events)
      .where(
        and(eq(events.projectId, projectId), eq(events.type, "state_transition")),
      );
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toMatchObject({
      from: "draft",
      to: "specifying",
      event: "intake_started",
    });
  });

  it("writes nothing when losing the race (stale from-state)", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { events, projects } = await import("@/lib/db/schema");
    const { applyProjectTransition, StateRaceError } = await import("./state");
    const db = getDb();

    // Project is actually in 'running'; caller believes it's still 'draft'.
    const projectId = await makeScratchProject("running");
    await expect(
      applyProjectTransition(projectId, "draft", { type: "intake_started" }),
    ).rejects.toThrow(StateRaceError);

    const [p] = await db
      .select({ state: projects.state })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(p.state).toBe("running"); // untouched

    const evs = await db.select().from(events).where(eq(events.projectId, projectId));
    expect(evs).toHaveLength(0); // no orphan event
  });

  it("applies phase transitions atomically with timestamps", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { events, phases } = await import("@/lib/db/schema");
    const { applyPhaseTransition, StateRaceError } = await import("./state");
    const db = getDb();

    const projectId = await makeScratchProject("running");
    const [phase] = await db
      .insert(phases)
      .values({ projectId, idx: 0, name: "Outline", phaseType: "outline", state: "pending" })
      .returning();

    await applyPhaseTransition(projectId, phase.id, "pending", {
      type: "phase_started",
    });
    const [started] = await db.select().from(phases).where(eq(phases.id, phase.id));
    expect(started.state).toBe("running");
    expect(started.startedAt).not.toBeNull();
    expect(started.finishedAt).toBeNull();

    // Stale caller loses without side effects
    await expect(
      applyPhaseTransition(projectId, phase.id, "pending", { type: "phase_started" }),
    ).rejects.toThrow(StateRaceError);

    await applyPhaseTransition(projectId, phase.id, "running", { type: "phase_done" });
    const [done] = await db.select().from(phases).where(eq(phases.id, phase.id));
    expect(done.state).toBe("done");
    expect(done.finishedAt).not.toBeNull();

    const evs = await db
      .select()
      .from(events)
      .where(and(eq(events.projectId, projectId), eq(events.type, "phase_transition")));
    expect(evs).toHaveLength(2); // started + done; the raced attempt wrote nothing
  });
});
