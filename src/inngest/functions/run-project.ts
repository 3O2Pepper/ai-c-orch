import type { GetStepTools } from "inngest";
import {
  budgetRaised,
  inngest,
  inputProvided,
  planApproved,
  projectCancelled,
  reviewResolved,
} from "@/inngest/client";
import { GATE_DWELL, MAX_REVISION_ROUNDS } from "@/lib/core/gates";
import {
  checkBudget,
  enterReview,
  getReviewResolution,
  initRun,
  markRunFailed,
  openBudgetGate,
  openInputGate,
  runDraftPhase,
  runOutlinePhase,
  runRevisionPhase,
  settleBudgetGate,
  settleInputGate,
} from "@/lib/services/phases";

// The Phase 2 workflow engine: one durable function per project run.
// Gates are step.waitForEvent — they survive process restarts and deploys.
//
// Reliability model (P2 hardening):
// - Every wait matches on a specific approvalId, and every wait timeout
//   re-checks the DB before acting — the approvals table, not the event
//   stream, is the source of truth. A missed or undelivered event costs at
//   most one dwell of latency, never a wrong outcome.
// - retries: 1 — every step is replay-safe (tolerated transitions, upserted
//   approvals, one artifact per phase, persisted outline), so a transient
//   DB/API failure gets one more attempt instead of failing the run. The
//   worst case of a retry is one repeated model call, which is metered and
//   bounded by the budget gate.
// - Review waits re-arm indefinitely (PLAN §5); dwell timeouts do NOT
//   consume revision rounds. Only executed revisions count toward the cap,
//   mirroring the route-side check.

type Step = GetStepTools<typeof inngest>;

export const runProject = inngest.createFunction(
  {
    id: "run-project",
    retries: 1,
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
        if: `async.data.approvalId == "${approvalId}"`,
      });
      if (answer) {
        // API route resolved the approval + transitioned needs_input -> running
        decision = answer.data.answer;
      } else {
        const settled = await step.run("settle-input-gate", () =>
          settleInputGate(projectId, approvalId, question.recommended_default),
        );
        if (settled.cancelled) return { status: "cancelled" };
        decision = settled.answer;
      }
    }

    // ---- Budget gate before the expensive draft ----
    if ((await budgetGate(step, projectId, "pre-draft")) === "cancelled") {
      return { status: "cancelled" };
    }

    // ---- Draft + artifact v1 ----
    const draft = await step.run("draft", () =>
      runDraftPhase(projectId, init.draftPhaseId, init.spec, outline, decision),
    );

    // ---- Review loop (Gate 4 + revisions) ----
    let approvalId = await step.run("enter-review", () =>
      enterReview(projectId, draft.artifactVersion),
    );

    let round = 1;
    let waitSeq = 0;
    while (round <= MAX_REVISION_ROUNDS) {
      const resolution = await step.waitForEvent(
        `review-decision-r${round}-w${waitSeq}`,
        {
          event: reviewResolved,
          timeout: GATE_DWELL,
          if: `async.data.approvalId == "${approvalId}"`,
        },
      );

      let action: "accept" | "revise" | "cancelled";
      let instructions = "";
      if (resolution) {
        action = resolution.data.action;
        instructions = resolution.data.instructions ?? "";
      } else {
        const recorded = await step.run(`review-recheck-r${round}-w${waitSeq}`, () =>
          getReviewResolution(projectId, approvalId),
        );
        if (!recorded) {
          // Reviewer just hasn't decided: re-arm the wait. This does NOT
          // consume a revision round — review waits indefinitely (PLAN §5).
          waitSeq++;
          continue;
        }
        action = recorded.action;
        instructions = recorded.action === "revise" ? recorded.instructions : "";
      }

      if (action === "cancelled") return { status: "cancelled" };
      if (action === "accept") return { status: "done", revisions: round - 1 };

      // Revision round. The route already resolved the delivery approval,
      // recorded the user message, and transitioned review -> running (or
      // getReviewResolution finished the transition on its behalf).
      if ((await budgetGate(step, projectId, `revision-${round}`)) === "cancelled") {
        return { status: "cancelled" };
      }
      const revised = await step.run(`revision-${round}`, () =>
        runRevisionPhase(projectId, instructions, round),
      );
      approvalId = await step.run(`enter-review-${round}`, () =>
        enterReview(projectId, revised.artifactVersion),
      );
      round++;
      waitSeq = 0;
    }

    // All 10 revisions used. The project stays in review; the route enforces
    // the same cap, so the only resolutions left are accept (handled
    // route-side: review -> done) or cancel — neither needs this run.
    return { status: "revision-limit-reached" };
  },
);

/**
 * Budget gate: if spent >= budget, pause and wait for a raise. On timeout
 * the DB decides: a recorded raise continues, a recorded stop (or a
 * genuinely unattended gate, or a cancelled project) ends the run cleanly.
 */
async function budgetGate(
  step: Step,
  projectId: string,
  label: string,
): Promise<"continue" | "cancelled"> {
  const check = await step.run(`budget-check-${label}`, () => checkBudget(projectId));
  if (!check.over) return "continue";

  const approvalId = await step.run(`open-budget-gate-${label}`, () =>
    openBudgetGate(projectId, { spentUsd: check.spentUsd, budgetUsd: check.budgetUsd }),
  );
  const raised = await step.waitForEvent(`wait-for-budget-${label}`, {
    event: budgetRaised,
    timeout: GATE_DWELL,
    if: `async.data.approvalId == "${approvalId}"`,
  });
  if (raised) return "continue"; // API route updated the budget + transitioned paused -> running

  return step.run(`settle-budget-gate-${label}`, () =>
    settleBudgetGate(projectId, approvalId),
  );
}
