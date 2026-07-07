// Gate policy constants (PLAN §5), shared by the workflow engine, the gate
// resolution routes, and approval rows — one source of truth so the Inngest
// waitForEvent timeout, the route-side revision cap, and the UI deadline
// can never disagree.

/** Dwell time before an unattended gate self-resolves (Inngest duration string). */
export const GATE_DWELL = "7d";

export const GATE_DWELL_MS = 7 * 24 * 60 * 60 * 1000;

/** Revision cap on the review loop. Dwell timeouts do NOT consume rounds. */
export const MAX_REVISION_ROUNDS = 10;
