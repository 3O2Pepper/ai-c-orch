// State machine values. Phase 1 uses the subset below; [Later] states
// (clarifying, needs_input, paused, verifying, fixing) arrive with their
// features in Phases 2-4 — do not add them before then.

export const PROJECT_STATES = [
  "draft",
  "specifying",
  "awaiting_plan_approval",
  "running",
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
  "review",
];

export function isTerminal(state: ProjectState): boolean {
  return state === "done" || state === "failed" || state === "cancelled";
}
