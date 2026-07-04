/**
 * Project + phase state enums. Phase 1 uses a subset of each machine;
 * the full sets are declared now so DB values never need migrating.
 * PURE MODULE — no Next/DB/SDK imports allowed anywhere in lib/core.
 */

export const PROJECT_STATES = [
  "draft",
  "specifying",
  "clarifying", // [P2]
  "awaiting_plan_approval",
  "running",
  "needs_input", // [P2]
  "paused", // [P2]
  "review",
  "done",
  "failed",
  "cancelled",
] as const;

export type ProjectState = (typeof PROJECT_STATES)[number];

/** States Phase 1 actually reaches. */
export const PHASE1_PROJECT_STATES: readonly ProjectState[] = [
  "draft",
  "specifying",
  "awaiting_plan_approval",
  "running",
  "review",
  "done",
  "failed",
  "cancelled",
];

/** A project in one of these states is still in flight. */
export const ACTIVE_PROJECT_STATES: readonly ProjectState[] = [
  "draft",
  "specifying",
  "clarifying",
  "awaiting_plan_approval",
  "running",
  "needs_input",
  "paused",
  "review",
];

export const PHASE_STATES = [
  "pending",
  "running",
  "needs_input", // [P2]
  "verifying", // [P4]
  "fixing", // [P4]
  "failed",
  "done",
] as const;

export type PhaseState = (typeof PHASE_STATES)[number];

export function isProjectState(value: string): value is ProjectState {
  return (PROJECT_STATES as readonly string[]).includes(value);
}

export function isPhaseState(value: string): value is PhaseState {
  return (PHASE_STATES as readonly string[]).includes(value);
}
