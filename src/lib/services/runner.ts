import { createHash } from "crypto";
import { desc, eq } from "drizzle-orm";
import { RESEARCH_WORKFLOW } from "@/lib/core/spec";
import { transitionPhase } from "@/lib/core/transitions";
import type { ProjectSpec } from "@/lib/core/spec";
import type { ProjectState } from "@/lib/core/states";
import {
  db,
  getCurrentUserId,
  scopedProjects,
  transitionPhaseState,
} from "@/lib/db/client";
import { artifacts, phases, projectSpecs } from "@/lib/db/schema";
import { generate, generateStream } from "@/lib/gateway";
import { DRAFT_SYSTEM, draftUserPrompt } from "@/lib/prompts/draft";
import { OUTLINE_SYSTEM, outlineUserPrompt } from "@/lib/prompts/outline";
import { appendEvent } from "./events";
import { applyProjectTransition } from "./project-transitions";

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function getLatestSpec(projectId: string): Promise<ProjectSpec> {
  const rows = await db
    .select()
    .from(projectSpecs)
    .where(eq(projectSpecs.projectId, projectId))
    .orderBy(desc(projectSpecs.version))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Project spec not found");
  return row.spec as ProjectSpec;
}

async function failProject(
  userId: string,
  projectId: string,
  reason: string,
): Promise<void> {
  const project = await scopedProjects(userId).get(projectId);
  if (!project || ["done", "failed", "cancelled"].includes(project.state)) {
    return;
  }
  await applyProjectTransition(
    userId,
    projectId,
    project.state as ProjectState,
    "fail",
    { reason },
  );
}

/**
 * Hardcoded Research workflow (Phase 1): outline → draft → artifact.
 * Plain async — triggered fire-and-forget on plan approval.
 */
export async function runResearchWorkflow(projectId: string): Promise<void> {
  const userId = await getCurrentUserId();

  try {
    const spec = await getLatestSpec(projectId);

    const phaseRows = await db
      .insert(phases)
      .values(
        RESEARCH_WORKFLOW.phases.map((p) => ({
          projectId,
          idx: p.idx,
          name: p.name,
          phaseType: p.phase_type,
          state: "pending",
        })),
      )
      .returning();

    const outlinePhase = phaseRows[0];
    const draftPhase = phaseRows[1];

    // --- Outline phase ---
    const outlineNext = transitionPhase("pending", "start");
    const outlineStarted = await transitionPhaseState(
      outlinePhase.id,
      "pending",
      outlineNext,
      { startedAt: new Date() },
    );
    if (!outlineStarted) throw new Error("Outline phase start race");

    await appendEvent(projectId, "phase.started", {
      phaseId: outlinePhase.id,
      name: outlinePhase.name,
    });

    const outline = await generate(
      {
        projectId,
        phaseId: outlinePhase.id,
        purpose: "planning",
      },
      {
        phaseType: "planning",
        system: OUTLINE_SYSTEM,
        user: outlineUserPrompt(spec),
        maxTokens: 4096,
      },
    );

    const outlineDone = transitionPhase("running", "complete");
    await transitionPhaseState(outlinePhase.id, "running", outlineDone, {
      finishedAt: new Date(),
      outputSummary: "Report outline generated",
      modelUsed: "claude-opus-4-8",
    });

    await appendEvent(projectId, "phase.completed", {
      phaseId: outlinePhase.id,
      name: outlinePhase.name,
    });

    // --- Draft phase ---
    const draftNext = transitionPhase("pending", "start");
    const draftStarted = await transitionPhaseState(
      draftPhase.id,
      "pending",
      draftNext,
      { startedAt: new Date() },
    );
    if (!draftStarted) throw new Error("Draft phase start race");

    await appendEvent(projectId, "phase.started", {
      phaseId: draftPhase.id,
      name: draftPhase.name,
    });

    const reportContent = await generateStream(
      {
        projectId,
        phaseId: draftPhase.id,
        purpose: "synthesis_draft",
      },
      {
        phaseType: "synthesis_draft",
        system: DRAFT_SYSTEM,
        user: draftUserPrompt(spec, outline),
        maxTokens: 16384,
      },
    );

    const reportFilename = `${spec.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "report"}.md`;

    await db.insert(artifacts).values({
      projectId,
      phaseId: draftPhase.id,
      kind: "report",
      filename: reportFilename,
      content: reportContent,
      version: 1,
      digest: digest(reportContent),
    });

    const draftDone = transitionPhase("running", "complete");
    await transitionPhaseState(draftPhase.id, "running", draftDone, {
      finishedAt: new Date(),
      outputSummary: "Research report drafted",
      modelUsed: "claude-opus-4-8",
    });

    await appendEvent(projectId, "phase.completed", {
      phaseId: draftPhase.id,
      name: draftPhase.name,
    });

    // Project: running → review → done (auto-done in P1)
    const reviewOk = await applyProjectTransition(
      userId,
      projectId,
      "running",
      "run_completed",
    );
    if (!reviewOk) return;

    const doneOk = await applyProjectTransition(
      userId,
      projectId,
      "review",
      "delivery_accepted",
    );
    if (!doneOk) return;
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Workflow failed unexpectedly";
    await failProject(userId, projectId, reason);
    await appendEvent(projectId, "project.failed", { reason });
    throw err;
  }
}
