import { and, desc, eq } from "drizzle-orm";
import { PHASE_MODEL_ROUTES } from "@/lib/core/routes";
import {
  OutlineSchema,
  ProjectSpecSchema,
  RESEARCH_PLAN,
  type Outline,
  type ProjectSpec,
} from "@/lib/core/spec";
import { getDb } from "@/lib/db/client";
import { artifacts, phases, projects, projectSpecs } from "@/lib/db/schema";
import { generateObject, generateText } from "@/lib/gateway";
import {
  DIGEST_SYSTEM,
  DRAFT_SYSTEM,
  draftPrompt,
  OUTLINE_SYSTEM,
  outlinePrompt,
} from "@/lib/prompts/research";
import { appendEvent } from "./events";
import { applyPhaseTransition, applyProjectTransition } from "./state";

// Phase 1 workflow runner: a plain async function that walks the hardcoded
// Research plan. Runs in the dev-server process (PLAN §0.2 — local only);
// Inngest replaces this loop in Phase 2. The project auto-advances
// review -> done; the review gate becomes real in Phase 2.

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}

export async function runProject(projectId: string, userId: string): Promise<void> {
  const db = getDb();
  let currentPhase: { id: string } | null = null;

  // Re-verify ownership at the trust boundary: every child write below
  // (phases, artifacts, events, model calls) descends from this check, so
  // the userId seam survives even if a future caller forgets to scope
  // (PLAN §9 tenant isolation).
  const [owned] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!owned) {
    throw new Error(`Project ${projectId} not found for user ${userId}`);
  }

  try {
    const [specRow] = await db
      .select()
      .from(projectSpecs)
      .where(eq(projectSpecs.projectId, projectId))
      .orderBy(desc(projectSpecs.version))
      .limit(1);
    if (!specRow) throw new Error("No spec found for project");
    const spec: ProjectSpec = ProjectSpecSchema.parse(specRow.spec);

    // Materialize the plan as pending phase rows
    const phaseRows = await db
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
    phaseRows.sort((a, b) => a.idx - b.idx);
    const [outlinePhase, draftPhase] = phaseRows;

    // Phase 0: outline
    currentPhase = outlinePhase;
    await applyPhaseTransition(projectId, outlinePhase.id, "pending", {
      type: "phase_started",
    });
    const outlineRoute = PHASE_MODEL_ROUTES.outline;
    const outlineResult = await generateObject({
      projectId,
      phaseId: outlinePhase.id,
      purpose: "outline",
      model: outlineRoute.model,
      system: OUTLINE_SYSTEM,
      prompt: outlinePrompt(spec),
      schema: OutlineSchema,
      maxTokens: outlineRoute.maxTokens,
      effort: outlineRoute.effort,
    });
    const outline: Outline = outlineResult.object;
    await db
      .update(phases)
      .set({
        outputSummary: `${outline.sections.length} sections: ${outline.sections
          .map((s) => s.heading)
          .join("; ")}`,
        modelUsed: outlineRoute.model,
        attempts: 1,
      })
      .where(eq(phases.id, outlinePhase.id));
    await applyPhaseTransition(projectId, outlinePhase.id, "running", {
      type: "phase_done",
    });

    // Phase 1: draft
    currentPhase = draftPhase;
    await applyPhaseTransition(projectId, draftPhase.id, "pending", {
      type: "phase_started",
    });
    const draftRoute = PHASE_MODEL_ROUTES.draft;
    const draftResult = await generateText({
      projectId,
      phaseId: draftPhase.id,
      purpose: "draft",
      model: draftRoute.model,
      system: DRAFT_SYSTEM,
      prompt: draftPrompt(spec, outline),
      maxTokens: draftRoute.maxTokens,
      effort: draftRoute.effort,
    });
    await db
      .update(phases)
      .set({
        outputSummary: `Drafted ${draftResult.text.length} chars`,
        modelUsed: draftRoute.model,
        attempts: 1,
      })
      .where(eq(phases.id, draftPhase.id));

    // Artifact digest (cheap tier) for future context assembly
    const digestRoute = PHASE_MODEL_ROUTES.digest;
    const digestResult = await generateText({
      projectId,
      phaseId: draftPhase.id,
      purpose: "digest",
      model: digestRoute.model,
      system: DIGEST_SYSTEM,
      prompt: draftResult.text,
      maxTokens: digestRoute.maxTokens,
      effort: digestRoute.effort,
    });

    const filename = `${slugify(spec.title)}.md`;
    const [artifact] = await db
      .insert(artifacts)
      .values({
        projectId,
        phaseId: draftPhase.id,
        kind: "report",
        filename,
        content: draftResult.text,
        version: 1,
        digest: digestResult.text.trim(),
      })
      .returning({ id: artifacts.id });
    await appendEvent(projectId, "artifact_created", {
      artifactId: artifact.id,
      filename,
      kind: "report",
      version: 1,
      chars: draftResult.text.length,
      costUsd: draftResult.costUsd + digestResult.costUsd,
    });

    await applyPhaseTransition(projectId, draftPhase.id, "running", {
      type: "phase_done",
    });

    // review gate is Phase 2 — auto-accept in Phase 1
    await applyProjectTransition(projectId, "running", { type: "run_completed" });
    await appendEvent(projectId, "auto_accepted", {
      note: "Phase 1 auto-accepts delivery; the review gate lands in Phase 2",
    });
    await applyProjectTransition(projectId, "review", { type: "delivery_accepted" });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (currentPhase) {
      await applyPhaseTransition(projectId, currentPhase.id, "running", {
        type: "phase_failed",
        reason,
      }).catch(() => {}); // phase may not have reached 'running'
    }
    const [project] = await getDb()
      .select({ state: projects.state })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (project && project.state === "running") {
      await applyProjectTransition(projectId, "running", {
        type: "run_failed",
        reason,
      }).catch(() => {});
    }
    throw err;
  }
}
