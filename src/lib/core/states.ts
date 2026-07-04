// State machine values. Phase 2 added needs_input (consequential-decision
// gate) and paused (budget gate). [Later] states (clarifying, verifying,
// fixing) arrive with their features in Phases 3-4 — do not add them early.

export const PROJECT_STATES = [
  "draft",
  "specifying",
  "awaiting_plan_approval",
  "running",
  "needs_input",
  "paused",
  "review",
  "done",
  "failed",
  "cancelled",
] as const;

export type ProjectState = (typeof PROJECT_STATES)[number];

export const PHASE_STATES = ["pending", "running", "done", "failed"] as const;

export type PhaseState = (typeof PHASE_STATES)[number];

/** States from which a project can still move (i.e. non-terminal). */
export const ACTIVE_PROJECT_STATES: readonly ProjectState[] = [
  "draft",
  "specifying",
  "awaiting_plan_approval",
  "running",
  "needs_input",
  "paused",
  "review",
];

export function isTerminal(state: ProjectState): boolean {
  return state === "done" || state === "failed" || state === "cancelled";
}
