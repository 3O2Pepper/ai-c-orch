/**
 * The single source of truth for legal state transitions.
 * Exhaustive switch with `never` checks: adding a state without handling it
 * is a compile error; an illegal transition at runtime throws.
 * PURE MODULE — callers (runner/API routes) apply results to the DB with
 * conditional UPDATE ... WHERE state = $expected writes.
 */
import type { PhaseState, ProjectState } from "./states";

export const PROJECT_EVENTS = [
  "intake_started",
  "spec_ready",
  "clarification_needed", // [P2]
  "clarification_answered", // [P2]
  "plan_approved",
  "input_needed", // [P2]
  "input_provided", // [P2]
  "pause", // [P2]
  "resume", // [P2]
  "run_completed",
  "delivery_accepted",
  "fail",
  "cancel",
] as const;

export type ProjectEvent = (typeof PROJECT_EVENTS)[number];

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly event: string,
  ) {
    super(`Illegal transition: event "${event}" in state "${from}"`);
    this.name = "IllegalTransitionError";
  }
}

const TERMINAL_STATES: readonly ProjectState[] = ["done", "failed", "cancelled"];

/**
 * Returns the next project state for (state, event) or throws
 * IllegalTransitionError. `fail` and `cancel` are legal from any
 * non-terminal state.
 */
export function transitionProject(
  state: ProjectState,
  event: ProjectEvent,
): ProjectState {
  if (event === "fail" || event === "cancel") {
    if (TERMINAL_STATES.includes(state)) {
      throw new IllegalTransitionError(state, event);
    }
    return event === "fail" ? "failed" : "cancelled";
  }

  switch (state) {
    case "draft":
      if (event === "intake_started") return "specifying";
      throw new IllegalTransitionError(state, event);
    case "specifying":
      if (event === "spec_ready") return "awaiting_plan_approval";
      if (event === "clarification_needed") return "clarifying";
      throw new IllegalTransitionError(state, event);
    case "clarifying": // [P2]
      if (event === "clarification_answered") return "awaiting_plan_approval";
      throw new IllegalTransitionError(state, event);
    case "awaiting_plan_approval":
      if (event === "plan_approved") return "running";
      throw new IllegalTransitionError(state, event);
    case "running":
      if (event === "run_completed") return "review";
      if (event === "input_needed") return "needs_input";
      if (event === "pause") return "paused";
      throw new IllegalTransitionError(state, event);
    case "needs_input": // [P2]
      if (event === "input_provided") return "running";
      throw new IllegalTransitionError(state, event);
    case "paused": // [P2]
      if (event === "resume") return "running";
      throw new IllegalTransitionError(state, event);
    case "review":
      if (event === "delivery_accepted") return "done";
      throw new IllegalTransitionError(state, event);
    case "done":
    case "failed":
    case "cancelled":
      throw new IllegalTransitionError(state, event);
    default: {
      const _exhaustive: never = state;
      throw new IllegalTransitionError(String(_exhaustive), event);
    }
  }
}

export const PHASE_EVENTS = [
  "start",
  "complete",
  "fail",
  "input_needed", // [P2]
  "input_provided", // [P2]
  "verify", // [P4]
  "verify_passed", // [P4]
  "verify_failed", // [P4]
  "fix_applied", // [P4]
] as const;

export type PhaseEvent = (typeof PHASE_EVENTS)[number];

/**
 * Returns the next phase state for (state, event) or throws.
 * Phase 1 exercises pending → running → done and running → failed.
 */
export function transitionPhase(
  state: PhaseState,
  event: PhaseEvent,
): PhaseState {
  switch (state) {
    case "pending":
      if (event === "start") return "running";
      throw new IllegalTransitionError(state, event);
    case "running":
      if (event === "complete") return "done";
      if (event === "fail") return "failed";
      if (event === "input_needed") return "needs_input";
      if (event === "verify") return "verifying";
      throw new IllegalTransitionError(state, event);
    case "needs_input": // [P2]
      if (event === "input_provided") return "running";
      throw new IllegalTransitionError(state, event);
    case "verifying": // [P4]
      if (event === "verify_passed") return "done";
      if (event === "verify_failed") return "fixing";
      throw new IllegalTransitionError(state, event);
    case "fixing": // [P4]
      if (event === "fix_applied") return "verifying";
      if (event === "fail") return "failed";
      throw new IllegalTransitionError(state, event);
    case "failed":
    case "done":
      throw new IllegalTransitionError(state, event);
    default: {
      const _exhaustive: never = state;
      throw new IllegalTransitionError(String(_exhaustive), event);
    }
  }
}
