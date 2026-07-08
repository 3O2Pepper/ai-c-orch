import type { GetStepTools } from "inngest";
import type { GatherNotes } from "@/lib/core/spec";
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
  runGatherPhase,
  runOutlinePhase,
  settleBudgetGate,
  settleInputGate,
} from "@/lib/services/phases";
import {
  runAnalysisDraftPhase,
  runAnyRevisionPhase,
  runImplementPhase,
  runPlanningPhase,
  runXlsxBuildPhase,
} from "@/lib/services/template-phases";

// The durable workflow engine (P2), extended with P3 templates. Research
// keeps the exact P2 step sequence and IDs (gates, dwell policy, review
// loop); Build/Analyze runs are planner-parameterized and join the same
// review loop. Gates are step.waitForEvent — they survive restarts.
//
// Reliability model (P2 hardening, unchanged):
// - Every wait matches on a specific approvalId, and every wait timeout
//   re-checks the DB before acting — the approvals table, not the event
//   stream, is the source of truth. A missed or undelivered event costs at
//   most one dwell of latency, never a wrong outcome.
// - retries: 1 — every step is replay-safe (tolerated transitions, upserted
//   approvals, one artifact per phase, persisted outputs), so a transient
//   DB/API failure gets one more attempt instead of failing the run.
// - Review waits re-arm indefinitely (PLAN §5); dwell timeouts do NOT
//   consume revision rounds.

type Step = GetStepTools<typeof inngest>;

type RunResult =
  | { status: "cancelled" }
  | { status: "done"; revisions: number }
  | { status: "revision-limit-reached" };

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

    // ---- Build / Analyze (P3): planner-parameterized phases ----
    if (init.template !== "research") {
      const template = init.template;
      const plan = await step.run("plan-workflow", () =>
        runPlanningPhase(projectId, template, init.spec),
      );

      let gather: GatherNotes | null = null;
      let artifactVersion: number | null = null;
      for (const phase of plan.phases) {
        if ((await budgetGate(step, projectId, `phase-${phase.idx}`)) === "cancelled") {
          return { status: "cancelled" } satisfies RunResult;
        }
        switch (phase.phaseType) {
          case "research_gather":
            gather = await step.run(`phase-${phase.idx}-gather`, () =>
              runGatherPhase(projectId, phase.phaseId, init.spec),
            );
            break;
          case "draft":
            artifactVersion = (
              await step.run(`phase-${phase.idx}-analysis`, () =>
                runAnalysisDraftPhase(
                  projectId,
                  phase.phaseId,
                  init.spec,
                  phase.objective,
                  gather,
                ),
              )
            ).artifactVersion;
            break;
          case "implement_code":
            artifactVersion = (
              await step.run(`phase-${phase.idx}-implement`, () =>
                runImplementPhase(
                  projectId,
                  phase.phaseId,
                  init.spec,
                  phase.objective,
                  gather,
                ),
              )
            ).artifactVersion;
            break;
          case "xlsx_build":
            artifactVersion = (
              await step.run(`phase-${phase.idx}-xlsx`, () =>
                runXlsxBuildPhase(
                  projectId,
                  phase.phaseId,
                  init.spec,
                  phase.objective,
                  gather,
                ),
              )
            ).artifactVersion;
            break;
          default:
            // validatePlannedPhases guarantees this can't happen
            throw new Error(`Plan contained unrunnable phase type '${phase.phaseType}'`);
        }
      }
      if (artifactVersion === null) {
        throw new Error("Plan finished without producing an artifact");
      }
      return reviewLoop(step, projectId, artifactVersion);
    }

    // ---- Research: the stable P2 flow (+ P3 gather in front) ----

    // Gather (P3: web search; null phaseId = pre-P3 project, skip)
    let gather: GatherNotes | null = null;
    if (init.gatherPhaseId) {
      const gatherPhaseId = init.gatherPhaseId;
      if ((await budgetGate(step, projectId, "pre-gather")) === "cancelled") {
        return { status: "cancelled" } satisfies RunResult;
      }
      gather = await step.run("gather", () =>
        runGatherPhase(projectId, gatherPhaseId, init.spec),
      );
    }

    if (!init.outlinePhaseId || !init.draftPhaseId) {
      throw new Error("Research run is missing outline/draft phase rows");
    }
    const outlinePhaseId = init.outlinePhaseId;
    const draftPhaseId = init.draftPhaseId;

    // ---- Outline (may raise the consequential-decision gate) ----
    const outline = await step.run("outline", () =>
      runOutlinePhase(projectId, outlinePhaseId, init.spec, gather),
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
        if (settled.cancelled) return { status: "cancelled" } satisfies RunResult;
        decision = settled.answer;
      }
    }

    // ---- Budget gate before the expensive draft ----
    if ((await budgetGate(step, projectId, "pre-draft")) === "cancelled") {
      return { status: "cancelled" } satisfies RunResult;
    }

    // ---- Draft + artifact v1 ----
    const draft = await step.run("draft", () =>
      runDraftPhase(projectId, draftPhaseId, init.spec, outline, gather, decision),
    );

    return reviewLoop(step, projectId, draft.artifactVersion);
  },
);

/**
 * The shared review loop (Gate 4 + revisions). Step IDs are IDENTICAL to
 * the P2 research flow so in-flight runs replay cleanly; Build/Analyze
 * runs join the same loop. Revisions are kind-aware (report re-draft,
 * code full-file revision, spreadsheet rebuild).
 */
async function reviewLoop(
  step: Step,
  projectId: string,
  firstArtifactVersion: number,
): Promise<RunResult> {
  let approvalId = await step.run("enter-review", () =>
    enterReview(projectId, firstArtifactVersion),
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
    const capturedRound = round;
    const capturedInstructions = instructions;
    const revised = await step.run(`revision-${round}`, () =>
      runAnyRevisionPhase(projectId, capturedInstructions, capturedRound),
    );
    approvalId = await step.run(`enter-review-${round}`, () =>
      enterReview(projectId, revised.artifactVersion),
    );
    round++;
    waitSeq = 0;
  }

  // All revisions used. The project stays in review; the route enforces
  // the same cap, so the only resolutions left are accept (handled
  // route-side: review -> done) or cancel — neither needs this run.
  return { status: "revision-limit-reached" };
}

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
