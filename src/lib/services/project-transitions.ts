import {
  IllegalTransitionError,
  transitionProject,
  type ProjectEvent,
} from "@/lib/core/transitions";
import type { ProjectState } from "@/lib/core/states";
import { scopedProjects } from "@/lib/db/client";
import { appendEvent } from "./events";

export class StateRaceError extends Error {
  constructor() {
    super("Project state changed concurrently");
    this.name = "StateRaceError";
  }
}

/**
 * Applies a project transition with optimistic concurrency + event log.
 * Returns false on a state race (caller should respond 409).
 */
export async function applyProjectTransition(
  userId: string,
  projectId: string,
  currentState: ProjectState,
  event: ProjectEvent,
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  let nextState: ProjectState;
  try {
    nextState = transitionProject(currentState, event);
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      throw err;
    }
    throw err;
  }

  const ok = await scopedProjects(userId).transitionState(
    projectId,
    currentState,
    nextState,
  );
  if (!ok) return false;

  await appendEvent(projectId, `project.${event}`, {
    from: currentState,
    to: nextState,
    ...payload,
  });
  return true;
}
