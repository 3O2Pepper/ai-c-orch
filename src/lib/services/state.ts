import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { phases, projects } from "@/lib/db/schema";
import type { PhaseState, ProjectState } from "@/lib/core/states";
import {
  phaseTransition,
  transition,
  type PhaseEvent,
  type ProjectEvent,
} from "@/lib/core/transitions";
import { appendEvent } from "./events";

/** Thrown when a concurrent transition won the race (map to HTTP 409). */
export class StateRaceError extends Error {
  constructor(entity: string, id: string, expected: string) {
    super(`${entity} ${id} is no longer in state '${expected}'`);
    this.name = "StateRaceError";
  }
}

/**
 * The only way project state changes: compute the next state via the pure
 * transition function, then apply it with a conditional UPDATE so a
 * concurrent transition loses cleanly (PLAN §0.5). Every transition writes
 * an events row.
 */
export async function applyProjectTransition(
  projectId: string,
  from: ProjectState,
  event: ProjectEvent,
): Promise<ProjectState> {
  const to = transition(from, event); // throws TransitionError if illegal
  const db = getDb();
  const updated = await db
    .update(projects)
    .set({ state: to })
    .where(and(eq(projects.id, projectId), eq(projects.state, from)))
    .returning({ id: projects.id });
  if (updated.length === 0) {
    throw new StateRaceError("project", projectId, from);
  }
  await appendEvent(projectId, "state_transition", {
    from,
    to,
    event: event.type,
    ...(event.type === "run_failed" ? { reason: event.reason } : {}),
  });
  return to;
}

export async function applyPhaseTransition(
  projectId: string,
  phaseId: string,
  from: PhaseState,
  event: PhaseEvent,
): Promise<PhaseState> {
  const to = phaseTransition(from, event);
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(phases)
    .set({
      state: to,
      ...(event.type === "phase_started" ? { startedAt: now } : {}),
      ...(event.type === "phase_done" || event.type === "phase_failed"
        ? { finishedAt: now }
        : {}),
    })
    .where(and(eq(phases.id, phaseId), eq(phases.state, from)))
    .returning({ id: phases.id });
  if (updated.length === 0) {
    throw new StateRaceError("phase", phaseId, from);
  }
  await appendEvent(projectId, "phase_transition", {
    phaseId,
    from,
    to,
    event: event.type,
    ...(event.type === "phase_failed" ? { reason: event.reason } : {}),
  });
  return to;
}
