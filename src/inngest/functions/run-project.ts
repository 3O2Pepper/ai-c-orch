import { NonRetriableError, type GetStepTools } from "inngest";
import {
  budgetRaised,
  inngest,
  inputProvided,
  planApproved,
  projectCancelled,
  reviewResolved,
} from "@/inngest/client";
import {
  checkBudget,
  enterReview,
  expireBudgetGate,
  initRun,
  markRunFailed,
  openBudgetGate,
  openInputGate,
  resolveInputGateByDefault,
  runDraftPhase,
  runOutlinePhase,
  runRevisionPhase,
} from "@/lib/services/phases";

// The Phase 2 workflow engine: one durable function per project run.
// Gates are step.waitForEvent — they survive process restarts and deploys.
// Bounded by design: no in-step retries (retries: 0 — a failed model call
// fails the run visibly), max 10 revision rounds, 7-day dwell on every gate.

const MAX_REVISION_ROUNDS = 10;
const GATE_DWELL = "7d";

type Step = GetStepTools<typeof inngest>;

export const runProject = inngest.createFunction(
  {
    id: "run-project",
    retries: 0,
    triggers: [planApproved],
    cancelOn: [
      {
        event: projectCancelled.name,
        if: "event.data.projectId == async.data.projectId",
      },
    ],
    onFailure: async ({ event, error }) => {
      const original = event.data.event as
        | { data?: { projectId?: string } }
        | undefined;
      const projectId = original?.data?.projectId;
      if (typeof projectId === "string") {
        await markRunFailed(projectId, error.message);
      }
    },
  },
  async ({ event, step }) => {
    const { projectId, userId } = event.data as {
      projectId: string;
      userId: string;
    };

    const init = await step.run("init-run", () => initRun(projectId, userId));

    // ---- Outline (may raise the consequential-decision gate) ----
    const outline = await step.run("outline", () =>
      runOutlinePhase(projectId, init.outlinePhaseId, init.spec),
    );

    let decision: string | null = null;
    if (outline.blocking_question) {
      const question = outline.blocking_question;
      const approvalId = await step.run("open-input-gate", () =>
        openInputGate(projectId, question),
      );
      const answer = await step.waitForEvent("wait-for-answer", {
        event: inputProvided,
        timeout: GATE_DWELL,
        if: `async.data.projectId == "${projectId}"`,
      });
      if (answer) {
        // API route resolved the approval + transitioned needs_input -> running
        decision = answer.data.answer;
      } else {
        decision = question.recommended_default;
        await step.run("input-gate-default", () =>
          resolveInputGateByDefault(projectId, approvalId, question.recommended_default),
        );
      }
    }

    // ---- Budget gate before the expensive draft ----
    await budgetGate(step, projectId, "pre-draft");

    // ---- Draft + artifact v1 ----
    const draft = await step.run("draft", () =>
      runDraftPhase(projectId, init.draftPhaseId, init.spec, outline, decision),
    );

    // ---- Review loop (Gate 4 + revisions) ----
    await step.run("enter-review", () => enterReview(projectId, draft.artifactVersion));

    for (let round = 1; round <= MAX_REVISION_ROUNDS; round++) {
      const resolution = await step.waitForEvent(`review-decision-${round}`, {
        event: reviewResolved,
        timeout: GATE_DWELL,
        if: `async.data.projectId == "${projectId}"`,
      });
      if (!resolution) {
        // Still in review after the dwell — keep waiting (bounded by the loop)
        continue;
      }
      if (resolution.data.action === "accept") {
        // API route performed the review -> done transition
        return { status: "done", revisions: round - 1 };
      }

      // Revision: API route already transitioned review -> running,
      // resolved the delivery approval, and recorded the user message.
      await budgetGate(step, projectId, `revision-${round}`);
      const revised = await step.run(`revision-${round}`, () =>
        runRevisionPhase(projectId, resolution.data.instructions ?? "", round),
      );
      await step.run(`enter-review-${round}`, () =>
        enterReview(projectId, revised.artifactVersion),
      );
    }
    return { status: "review-dwell-exhausted" };
  },
);

/**
 * Budget gate: if spent >= budget, pause and wait for a raise. A "stop"
 * resolution cancels the project and fires project/cancelled, which kills
 * this run via cancelOn — so only the raise event is awaited here.
 */
async function budgetGate(step: Step, projectId: string, label: string) {
  const check = await step.run(`budget-check-${label}`, () => checkBudget(projectId));
  if (!check.over) return;

  const approvalId = await step.run(`open-budget-gate-${label}`, () =>
    openBudgetGate(projectId, { spentUsd: check.spentUsd, budgetUsd: check.budgetUsd }),
  );
  const raised = await step.waitForEvent(`wait-for-budget-${label}`, {
    event: budgetRaised,
    timeout: GATE_DWELL,
    if: `async.data.projectId == "${projectId}"`,
  });
  if (!raised) {
    await step.run(`budget-gate-expired-${label}`, () =>
      expireBudgetGate(projectId, approvalId),
    );
    throw new NonRetriableError("Budget gate expired without a decision");
  }
  // API route updated the budget + transitioned paused -> running
}
