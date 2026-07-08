import { and, desc, eq, sql } from "drizzle-orm";
import { GATE_DWELL_MS } from "@/lib/core/gates";
import {
  OutlineSchema,
  ProjectSpecSchema,
  RESEARCH_PLAN,
  type Outline,
  type ProjectSpec,
} from "@/lib/core/spec";
import { isTerminal, type PhaseState, type ProjectState } from "@/lib/core/states";
import {
  phaseTransition,
  transition,
  type PhaseEvent,
  type ProjectEvent,
} from "@/lib/core/transitions";
import { getDb } from "@/lib/db/client";
import { artifacts, messages, phases, projects, projectSpecs } from "@/lib/db/schema";
import { generateObject, generateText } from "@/lib/gateway";
import {
  DIGEST_SYSTEM,
  DRAFT_SYSTEM,
  draftPrompt,
  OUTLINE_SYSTEM,
  outlinePrompt,
  REVISION_SYSTEM,
  revisionPrompt,
} from "@/lib/prompts/research";
import { createApproval, getApprovalResolution, resolveApproval } from "./approvals";
import {
  assembleContext,
  CONTEXT_BUDGET_TOKENS,
  maybeRollUpDecisions,
  recordArtifactDigest,
  recordDecision,
} from "./context";
import { appendEvent } from "./events";
import { resolveRoute } from "./router";
import {
  applyPhaseTransition,
  applyProjectTransition,
  StateRaceError,
} from "./state";

// Step-callable units for the durable workflow (src/inngest/functions).
// Every function here is replay-safe: if a step is re-executed (crash after
// the work committed but before Inngest recorded the result, or a retry),
// it detects already-applied work — tolerated transitions, upserted
// approvals, one-artifact-per-phase — instead of duplicating it.

async function transitionProject(
  projectId: string,
  from: ProjectState,
  event: ProjectEvent,
): Promise<void> {
  try {
    await applyProjectTransition(projectId, from, event);
  } catch (err) {
    if (err instanceof StateRaceError) {
      const target = transition(from, event);
      const [row] = await getDb()
        .select({ state: projects.state })
        .from(projects)
        .where(eq(projects.id, projectId));
      if (row?.state === target) return; // step replay: already applied
    }
    throw err;
  }
}

async function transitionPhase(
  projectId: string,
  phaseId: string,
  from: PhaseState,
  event: PhaseEvent,
): Promise<void> {
  try {
    await applyPhaseTransition(projectId, phaseId, from, event);
  } catch (err) {
    if (err instanceof StateRaceError) {
      const target = phaseTransition(from, event);
      const [row] = await getDb()
        .select({ state: phases.state })
        .from(phases)
        .where(eq(phases.id, phaseId));
      if (row?.state === target) return;
    }
    throw err;
  }
}

async function loadSpec(projectId: string): Promise<ProjectSpec> {
  const [specRow] = await getDb()
    .select()
    .from(projectSpecs)
    .where(eq(projectSpecs.projectId, projectId))
    .orderBy(desc(projectSpecs.version))
    .limit(1);
  if (!specRow) throw new Error("No spec found for project");
  return ProjectSpecSchema.parse(specRow.spec);
}

async function getProjectState(projectId: string): Promise<ProjectState> {
  const [row] = await getDb()
    .select({ state: projects.state })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!row) throw new Error("Project not found");
  return row.state as ProjectState;
}

function gateDeadline(): Date {
  return new Date(Date.now() + GATE_DWELL_MS);
}

/** Ownership check + phase-row materialization. First step of every run. */
export async function initRun(projectId: string, userId: string) {
  const db = getDb();
  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!owned) {
    throw new Error(`Project ${projectId} not found for user ${userId}`);
  }

  const spec = await loadSpec(projectId);

  // Idempotent on step replay: reuse existing phase rows if present
  const existing = await db
    .select()
    .from(phases)
    .where(eq(phases.projectId, projectId));
  let rows = existing.filter((p) => p.phaseType !== "revision");
  if (rows.length === 0) {
    rows = await db
      .insert(phases)
      .values(
        RESEARCH_PLAN.phases.map((p) => ({
          projectId,
          idx: p.idx,
          name: p.name,
          phaseType: p.phase_type,
          state: "pending" as const,
        })),
      )
      .returning();
  }
  rows.sort((a, b) => a.idx - b.idx);
  return { spec, outlinePhaseId: rows[0].id, draftPhaseId: rows[1].id };
}

export async function runOutlinePhase(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
): Promise<Outline> {
  const db = getDb();
  const route = await resolveRoute("outline");

  // Replay guard: the phase already finished — reuse the persisted outline
  // instead of paying for a second model call.
  const [row] = await db.select().from(phases).where(eq(phases.id, phaseId));
  if (row?.state === "done" && row.output) {
    return OutlineSchema.parse(row.output);
  }

  await transitionPhase(projectId, phaseId, "pending", { type: "phase_started" });
  const result = await generateObject({
    projectId,
    phaseId,
    purpose: "outline",
    model: route.model,
    system: OUTLINE_SYSTEM,
    prompt: outlinePrompt(spec),
    schema: OutlineSchema,
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });
  const outline = result.object;
  await db
    .update(phases)
    .set({
      output: outline,
      outputSummary:
        `${outline.sections.length} sections: ` +
        outline.sections.map((s) => s.heading).join("; ") +
        (outline.blocking_question ? " — raised a blocking question" : ""),
      modelUsed: route.model,
      attempts: sql`${phases.attempts} + 1`,
    })
    .where(eq(phases.id, phaseId));
  await transitionPhase(projectId, phaseId, "running", { type: "phase_done" });
  return outline;
}

/** Consequential-decision gate: approval + running -> needs_input. */
export async function openInputGate(
  projectId: string,
  question: { question: string; recommended_default: string },
): Promise<string> {
  const approvalId = await createApproval(projectId, "needs_input", question, {
    expiresAt: gateDeadline(),
  });
  await transitionProject(projectId, "running", { type: "input_requested" });
  return approvalId;
}

export type InputSettlement =
  | { cancelled: true }
  | { cancelled: false; answer: string };

/**
 * Called when the needs_input wait times out. The DB is the source of
 * truth: if a route already resolved the gate (the event was missed or its
 * send failed), honor the recorded answer instead of the default.
 */
export async function settleInputGate(
  projectId: string,
  approvalId: string,
  defaultAnswer: string,
): Promise<InputSettlement> {
  if (isTerminal(await getProjectState(projectId))) return { cancelled: true };

  const recorded = await getApprovalResolution(approvalId);
  if (recorded) return applyRecordedInput(projectId, recorded);

  // Genuinely unanswered: expire to the recommended default (PLAN §5).
  const won = await resolveApproval(
    projectId,
    approvalId,
    "expired",
    `Proceeded with recommended default: ${defaultAnswer}`,
  );
  if (!won) {
    // A route resolved it between our read and the conditional update.
    const late = await getApprovalResolution(approvalId);
    if (late) return applyRecordedInput(projectId, late);
    throw new Error(`Approval ${approvalId} resolved but has no resolution`);
  }
  await getDb().insert(messages).values({
    projectId,
    role: "system",
    content: `No answer within the dwell time — proceeding with the recommended default: ${defaultAnswer}`,
    linkedApprovalId: approvalId,
  });
  await recordDecision(
    projectId,
    `Open question expired unanswered — proceeded with the recommended default: ${defaultAnswer}`,
    `approval:${approvalId}`,
  );
  await transitionProject(projectId, "needs_input", { type: "input_provided" });
  return { cancelled: false, answer: defaultAnswer };
}

async function applyRecordedInput(
  projectId: string,
  recorded: { status: string; note: string | null },
): Promise<InputSettlement> {
  if (recorded.status === "rejected") return { cancelled: true }; // cancel route closed it
  // 'approved' (answer route stores the answer as the note) or 'expired'
  // (a previous replay of this settle step already applied the default).
  await transitionProject(projectId, "needs_input", { type: "input_provided" });
  const answer =
    recorded.status === "approved"
      ? (recorded.note ?? "")
      : (recorded.note?.replace(/^Proceeded with recommended default: /, "") ?? "");
  return { cancelled: false, answer };
}

export async function checkBudget(projectId: string) {
  const [p] = await getDb()
    .select({ spentUsd: projects.spentUsd, budgetUsd: projects.budgetUsd })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const spent = Number(p.spentUsd);
  const budget = Number(p.budgetUsd);
  return { over: spent >= budget, spentUsd: spent, budgetUsd: budget };
}

/** Budget gate: approval + running -> paused. */
export async function openBudgetGate(
  projectId: string,
  figures: { spentUsd: number; budgetUsd: number },
): Promise<string> {
  const approvalId = await createApproval(projectId, "budget", figures, {
    expiresAt: gateDeadline(),
  });
  await transitionProject(projectId, "running", { type: "budget_exceeded" });
  return approvalId;
}

/**
 * Called when the budget wait times out. If a route already resolved the
 * gate, honor it: a recorded raise continues the run (never cancel a paid
 * raise because its event was missed); a recorded stop ends it. Only a
 * genuinely unattended gate expires to cancellation (PLAN §5).
 */
export async function settleBudgetGate(
  projectId: string,
  approvalId: string,
): Promise<"continue" | "cancelled"> {
  if (isTerminal(await getProjectState(projectId))) return "cancelled";

  const applyRecorded = async (recorded: { status: string }) => {
    if (recorded.status === "approved") {
      await transitionProject(projectId, "paused", { type: "resumed" });
      return "continue" as const;
    }
    return "cancelled" as const; // stopped by route, or expired by an earlier replay
  };

  const recorded = await getApprovalResolution(approvalId);
  if (recorded) return applyRecorded(recorded);

  const won = await resolveApproval(
    projectId,
    approvalId,
    "expired",
    "No decision within dwell time",
  );
  if (!won) {
    const late = await getApprovalResolution(approvalId);
    if (late) return applyRecorded(late);
    throw new Error(`Approval ${approvalId} resolved but has no resolution`);
  }
  await getDb().insert(messages).values({
    projectId,
    role: "system",
    content: "No budget decision within the dwell time — the run was cancelled.",
    linkedApprovalId: approvalId,
  });
  await transitionProject(projectId, "paused", { type: "cancelled" });
  return "cancelled";
}

export async function runDraftPhase(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
  outline: Outline,
  decision: string | null,
): Promise<{ artifactVersion: number }> {
  const db = getDb();
  const route = await resolveRoute("draft");

  // Replay guard: phase done means its artifact was written — reuse it.
  const [row] = await db.select().from(phases).where(eq(phases.id, phaseId));
  if (row?.state === "done") {
    const version = await findArtifactVersion(phaseId);
    if (version !== null) return { artifactVersion: version };
    throw new Error(`Draft phase ${phaseId} is done but has no artifact`);
  }

  await transitionPhase(projectId, phaseId, "pending", { type: "phase_started" });

  const draft = await generateText({
    projectId,
    phaseId,
    purpose: "draft",
    model: route.model,
    system: DRAFT_SYSTEM,
    prompt: draftPrompt(spec, outline, decision),
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });
  await db
    .update(phases)
    .set({
      outputSummary: `Drafted ${draft.text.length} chars`,
      modelUsed: route.model,
      attempts: sql`${phases.attempts} + 1`,
    })
    .where(eq(phases.id, phaseId));

  const version = await writeReportArtifact(projectId, phaseId, spec, draft.text, draft.costUsd);
  await transitionPhase(projectId, phaseId, "running", { type: "phase_done" });
  return { artifactVersion: version };
}

/** Revision loop body: new phase row + full re-draft + artifact vN+1. */
export async function runRevisionPhase(
  projectId: string,
  instructions: string,
  round: number,
): Promise<{ artifactVersion: number }> {
  const db = getDb();
  const route = await resolveRoute("revision");
  const spec = await loadSpec(projectId);

  // Idempotent on step replay: reuse this round's phase row if present
  const name = `Revision ${round}`;
  let [phase] = await db
    .select()
    .from(phases)
    .where(and(eq(phases.projectId, projectId), eq(phases.name, name)));
  if (!phase) {
    const existing = await db
      .select({ idx: phases.idx })
      .from(phases)
      .where(eq(phases.projectId, projectId))
      .orderBy(desc(phases.idx))
      .limit(1);
    [phase] = await db
      .insert(phases)
      .values({
        projectId,
        idx: (existing[0]?.idx ?? -1) + 1,
        name,
        phaseType: "revision",
        state: "pending",
      })
      .returning();
  }

  // Replay guard: this round already completed — reuse its artifact.
  if (phase.state === "done") {
    const version = await findArtifactVersion(phase.id);
    if (version !== null) return { artifactVersion: version };
    throw new Error(`Revision phase ${phase.id} is done but has no artifact`);
  }

  const [latest] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(desc(artifacts.version))
    .limit(1);
  if (!latest?.content) throw new Error("No artifact to revise");

  if (phase.state === "pending") {
    await transitionPhase(projectId, phase.id, "pending", { type: "phase_started" });
  }
  // Long-running projects: compact old decisions, then assemble the
  // token-budgeted context block (spec + decisions + latest digest).
  await maybeRollUpDecisions(projectId);
  const context = await assembleContext(projectId, CONTEXT_BUDGET_TOKENS);
  const revised = await generateText({
    projectId,
    phaseId: phase.id,
    purpose: "revision",
    model: route.model,
    system: REVISION_SYSTEM,
    prompt: revisionPrompt(context, latest.content, instructions),
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });
  await db
    .update(phases)
    .set({
      outputSummary: `Revised to ${revised.text.length} chars`,
      modelUsed: route.model,
      attempts: sql`${phases.attempts} + 1`,
    })
    .where(eq(phases.id, phase.id));

  const version = await writeReportArtifact(
    projectId,
    phase.id,
    spec,
    revised.text,
    revised.costUsd,
  );
  await transitionPhase(projectId, phase.id, "running", { type: "phase_done" });
  return { artifactVersion: version };
}

/** running -> review + delivery approval (Gate 4, waits indefinitely). */
export async function enterReview(
  projectId: string,
  artifactVersion: number,
): Promise<string> {
  await transitionProject(projectId, "running", { type: "run_completed" });
  return createApproval(projectId, "delivery", { artifactVersion });
}

export type ReviewResolution =
  | { action: "accept" }
  | { action: "revise"; instructions: string }
  | { action: "cancelled" };

/**
 * Called when a review wait times out. Null means the reviewer simply
 * hasn't decided — the caller re-arms the wait without consuming a
 * revision round. A recorded resolution (missed event / failed send /
 * route crash mid-sequence) is honored, including finishing any
 * transition the route didn't get to.
 */
export async function getReviewResolution(
  projectId: string,
  approvalId: string,
): Promise<ReviewResolution | null> {
  if (isTerminal(await getProjectState(projectId))) return { action: "cancelled" };

  const recorded = await getApprovalResolution(approvalId);
  if (!recorded) return null; // still pending — keep waiting

  if (recorded.status === "approved") {
    await transitionProject(projectId, "review", { type: "delivery_accepted" });
    return { action: "accept" };
  }
  // 'rejected' = revision requested (the cancel route also rejects, but
  // that path was caught by the terminal-state check above).
  const [msg] = await getDb()
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.linkedApprovalId, approvalId), eq(messages.role, "user")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  await transitionProject(projectId, "review", { type: "revision_requested" });
  return { action: "revise", instructions: msg?.content ?? recorded.note ?? "" };
}

/** onFailure hook: mark whatever active state the project is in as failed. */
export async function markRunFailed(projectId: string, reason: string): Promise<void> {
  const [row] = await getDb()
    .select({ state: projects.state })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!row) return;
  const state = row.state as ProjectState;
  if (state === "done" || state === "failed" || state === "cancelled") return;
  await applyProjectTransition(projectId, state, { type: "run_failed", reason }).catch(
    () => {},
  );
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}

async function findArtifactVersion(phaseId: string): Promise<number | null> {
  const [existing] = await getDb()
    .select({ version: artifacts.version })
    .from(artifacts)
    .where(eq(artifacts.phaseId, phaseId))
    .limit(1);
  return existing?.version ?? null;
}

async function writeReportArtifact(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
  content: string,
  draftCostUsd: number,
): Promise<number> {
  const db = getDb();

  // Replay guard: one artifact per phase (unique index). Checking before
  // the digest call means a replay repeats neither the insert nor the
  // paid Haiku call.
  const already = await findArtifactVersion(phaseId);
  if (already !== null) return already;

  const digestRoute = await resolveRoute("digest");
  const digest = await generateText({
    projectId,
    phaseId,
    purpose: "digest",
    model: digestRoute.model,
    system: DIGEST_SYSTEM,
    prompt: content,
    maxTokens: digestRoute.maxTokens,
    effort: digestRoute.effort,
    fallbackModel: digestRoute.fallbackModel,
  });

  const [latest] = await db
    .select({ version: artifacts.version })
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(desc(artifacts.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const filename = `${slugify(spec.title)}.md`;

  const [artifact] = await db
    .insert(artifacts)
    .values({
      projectId,
      phaseId,
      kind: "report",
      filename,
      content,
      version,
      digest: digest.text.trim(),
    })
    .onConflictDoNothing()
    .returning({ id: artifacts.id });
  if (!artifact) {
    // Lost a replay race on the unique index — the artifact exists.
    const version = await findArtifactVersion(phaseId);
    if (version !== null) return version;
    throw new Error(`Artifact insert for phase ${phaseId} conflicted but none found`);
  }
  await recordArtifactDigest(projectId, artifact.id, digest.text.trim());
  await appendEvent(projectId, "artifact_created", {
    artifactId: artifact.id,
    filename,
    kind: "report",
    version,
    chars: content.length,
    costUsd: draftCostUsd + digest.costUsd,
  });
  return version;
}
