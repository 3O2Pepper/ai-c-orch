import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { PhaseState, ProjectState } from "@/lib/core/states";
import {
  phaseTransition,
  transition,
  type PhaseEvent,
  type ProjectEvent,
} from "@/lib/core/transitions";

/** Thrown when a concurrent transition won the race (map to HTTP 409). */
export class StateRaceError extends Error {
  constructor(entity: string, id: string, expected: string) {
    super(`${entity} ${id} is no longer in state '${expected}'`);
    this.name = "StateRaceError";
  }
}

// Transitions are the only way state changes, and each one is a single
// atomic SQL statement (CTE): the conditional state UPDATE and the events
// INSERT commit together or not at all. The neon-http driver has no
// interactive transactions, so single-statement atomicity is the mechanism
// (same pattern as the gateway's metering rollup).

/**
 * Compute the next project state via the pure transition function, then
 * apply it with a conditional UPDATE + event INSERT in one statement.
 * A concurrent transition loses cleanly (PLAN §0.5) and writes nothing.
 */
export async function applyProjectTransition(
  projectId: string,
  from: ProjectState,
  event: ProjectEvent,
): Promise<ProjectState> {
  const to = transition(from, event); // throws TransitionError if illegal
  const payload = JSON.stringify({
    from,
    to,
    event: event.type,
    ...(event.type === "run_failed" ? { reason: event.reason } : {}),
  });

  const db = getDb();
  const result = await db.execute(sql`
    WITH upd AS (
      UPDATE projects
      SET state = ${to}, updated_at = now()
      WHERE id = ${projectId} AND state = ${from}
      RETURNING id
    )
    INSERT INTO events (project_id, type, payload)
    SELECT id, 'state_transition', ${payload}::jsonb FROM upd
    RETURNING id
  `);
  if (result.rows.length === 0) {
    throw new StateRaceError("project", projectId, from);
  }
  return to;
}

export async function applyPhaseTransition(
  projectId: string,
  phaseId: string,
  from: PhaseState,
  event: PhaseEvent,
): Promise<PhaseState> {
  const to = phaseTransition(from, event); // throws PhaseTransitionError if illegal
  const payload = JSON.stringify({
    phaseId,
    from,
    to,
    event: event.type,
    ...(event.type === "phase_failed" ? { reason: event.reason } : {}),
  });
  const setStarted = event.type === "phase_started";
  const setFinished = event.type === "phase_done" || event.type === "phase_failed";

  const db = getDb();
  const result = await db.execute(sql`
    WITH upd AS (
      UPDATE phases
      SET state = ${to},
          updated_at = now(),
          started_at = CASE WHEN ${setStarted} THEN now() ELSE started_at END,
          finished_at = CASE WHEN ${setFinished} THEN now() ELSE finished_at END
      WHERE id = ${phaseId} AND state = ${from}
      RETURNING id
    )
    INSERT INTO events (project_id, type, payload)
    SELECT ${projectId}::uuid, 'phase_transition', ${payload}::jsonb FROM upd
    RETURNING id
  `);
  if (result.rows.length === 0) {
    throw new StateRaceError("phase", phaseId, from);
  }
  return to;
}
