import { and, desc, eq } from "drizzle-orm";
import { PHASE_MODEL_ROUTES } from "@/lib/core/routes";
import {
  OutlineSchema,
  ProjectSpecSchema,
  RESEARCH_PLAN,
  type Outline,
  type ProjectSpec,
} from "@/lib/core/spec";
import type { PhaseState, ProjectState } from "@/lib/core/states";
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
import { createApproval, resolveApproval } from "./approvals";
import { appendEvent } from "./events";
import {
  applyPhaseTransition,
  applyProjectTransition,
  StateRaceError,
} from "./state";

// Step-callable units for the durable workflow (src/inngest/functions).
// Each function is invoked inside step.run: if the process dies mid-step,
// Inngest re-invokes the step, so transitions tolerate "already applied"
// races (a completed step is memoized and never re-run).

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
  const route = PHASE_MODEL_ROUTES.outline;
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
  });
  const outline = result.object;
  await getDb()
    .update(phases)
    .set({
      outputSummary:
        `${outline.sections.length} sections: ` +
        outline.sections.map((s) => s.heading).join("; ") +
        (outline.blocking_question ? " — raised a blocking question" : ""),
      modelUsed: route.model,
      attempts: 1,
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
  const approvalId = await createApproval(projectId, "needs_input", question);
  await transitionProject(projectId, "running", { type: "input_requested" });
  return approvalId;
}

/** 7-day dwell expiry: proceed with the recommended default, recorded. */
export async function resolveInputGateByDefault(
  projectId: string,
  approvalId: string,
  defaultAnswer: string,
): Promise<void> {
  await resolveApproval(
    projectId,
    approvalId,
    "expired",
    `Proceeded with recommended default: ${defaultAnswer}`,
  );
  await getDb().insert(messages).values({
    projectId,
    role: "system",
    content: `No answer within the dwell time — proceeding with the recommended default: ${defaultAnswer}`,
    linkedApprovalId: approvalId,
  });
  await transitionProject(projectId, "needs_input", { type: "input_provided" });
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
  const approvalId = await createApproval(projectId, "budget", figures);
  await transitionProject(projectId, "running", { type: "budget_exceeded" });
  return approvalId;
}

/** Budget dwell expiry: treat as stop — expire the approval, cancel the run. */
export async function expireBudgetGate(
  projectId: string,
  approvalId: string,
): Promise<void> {
  await resolveApproval(projectId, approvalId, "expired", "No decision within dwell time");
  await transitionProject(projectId, "paused", { type: "cancelled" });
}

export async function runDraftPhase(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
  outline: Outline,
  decision: string | null,
): Promise<{ artifactVersion: number }> {
  const db = getDb();
  const route = PHASE_MODEL_ROUTES.draft;
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
  });
  await db
    .update(phases)
    .set({
      outputSummary: `Drafted ${draft.text.length} chars`,
      modelUsed: route.model,
      attempts: 1,
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
  const route = PHASE_MODEL_ROUTES.revision;
  const spec = await loadSpec(projectId);

  const [latest] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(desc(artifacts.version))
    .limit(1);
  if (!latest?.content) throw new Error("No artifact to revise");

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

  if (phase.state === "pending") {
    await transitionPhase(projectId, phase.id, "pending", { type: "phase_started" });
  }
  const revised = await generateText({
    projectId,
    phaseId: phase.id,
    purpose: "revision",
    model: route.model,
    system: REVISION_SYSTEM,
    prompt: revisionPrompt(spec, latest.content, instructions),
    maxTokens: route.maxTokens,
    effort: route.effort,
  });
  await db
    .update(phases)
    .set({
      outputSummary: `Revised to ${revised.text.length} chars`,
      modelUsed: route.model,
      attempts: 1,
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

/** running -> review + delivery approval (Gate 4). */
export async function enterReview(
  projectId: string,
  artifactVersion: number,
): Promise<string> {
  await transitionProject(projectId, "running", { type: "run_completed" });
  return createApproval(projectId, "delivery", { artifactVersion });
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

async function writeReportArtifact(
  projectId: string,
  phaseId: string,
  spec: ProjectSpec,
  content: string,
  draftCostUsd: number,
): Promise<number> {
  const db = getDb();
  const digestRoute = PHASE_MODEL_ROUTES.digest;
  const digest = await generateText({
    projectId,
    phaseId,
    purpose: "digest",
    model: digestRoute.model,
    system: DIGEST_SYSTEM,
    prompt: content,
    maxTokens: digestRoute.maxTokens,
    effort: digestRoute.effort,
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
    .returning({ id: artifacts.id });
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
