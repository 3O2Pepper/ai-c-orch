import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { ProjectSpecSchema, type ProjectSpec } from "@/lib/core/spec";
import { getDb } from "@/lib/db/client";
import { projects, projectSpecs } from "@/lib/db/schema";
import { generateObject } from "@/lib/gateway";
import { INTAKE_SYSTEM, intakePrompt } from "@/lib/prompts/intake";
import { createApproval } from "./approvals";
import { pinSpec } from "./context";
import { appendEvent } from "./events";
import { resolveRoute } from "./router";
import { applyProjectTransition } from "./state";

function isTransportError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return status === 429 || status >= 500;
  }
  return false;
}

/**
 * Intake: messy text -> project row -> spec via structured outputs ->
 * awaiting_plan_approval. Schema validity is enforced by the API; the single
 * retry below covers transport failures only (PLAN §0.4).
 */
export async function createProjectFromRequest(
  userId: string,
  rawRequest: string,
): Promise<{ projectId: string; spec: ProjectSpec }> {
  const db = getDb();

  const [project] = await db
    .insert(projects)
    .values({ userId, rawRequest, state: "draft", workflowTemplate: "research" })
    .returning({ id: projects.id });
  await appendEvent(project.id, "project_created", {
    requestChars: rawRequest.length,
  });

  await applyProjectTransition(project.id, "draft", { type: "intake_started" });

  try {
    let result;
    try {
      result = await extractSpec(project.id, rawRequest);
    } catch (err) {
      if (!isTransportError(err)) throw err;
      result = await extractSpec(project.id, rawRequest); // one transport retry
    }
    const spec = result.object;

    await db.insert(projectSpecs).values({
      projectId: project.id,
      version: 1,
      spec,
      createdBy: "system",
    });
    await pinSpec(project.id, spec, 1);
    await db
      .update(projects)
      .set({ title: spec.title })
      .where(eq(projects.id, project.id));
    await appendEvent(project.id, "spec_extracted", {
      title: spec.title,
      blockingQuestions: spec.blocking_questions.length,
      assumptions: spec.assumptions.length,
      costUsd: result.costUsd,
    });

    await applyProjectTransition(project.id, "specifying", { type: "spec_ready" });
    await createApproval(project.id, "plan", {
      specVersion: 1,
      title: spec.title,
    });
    return { projectId: project.id, spec };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await applyProjectTransition(project.id, "specifying", {
      type: "run_failed",
      reason,
    }).catch(() => {});
    throw err;
  }
}

async function extractSpec(projectId: string, rawRequest: string) {
  const route = await resolveRoute("spec_extraction");
  return generateObject({
    projectId,
    purpose: "spec_extraction",
    model: route.model,
    system: INTAKE_SYSTEM,
    prompt: intakePrompt(rawRequest),
    schema: ProjectSpecSchema,
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });
}
