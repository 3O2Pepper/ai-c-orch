import { eq } from "drizzle-orm";
import { ProjectSpecSchema, type ProjectSpec } from "@/lib/core/spec";
import { db, getCurrentUserId } from "@/lib/db/client";
import { projectSpecs, projects } from "@/lib/db/schema";
import { generateObject } from "@/lib/gateway";
import { INTAKE_SYSTEM, intakeUserPrompt } from "@/lib/prompts/intake";
import { applyProjectTransition } from "./project-transitions";

export interface IntakeResult {
  projectId: string;
  spec: ProjectSpec;
  state: string;
}

export async function runIntake(rawRequest: string): Promise<IntakeResult> {
  const userId = await getCurrentUserId();
  const trimmed = rawRequest.trim();
  if (!trimmed) {
    throw new Error("Request text is required");
  }

  const [project] = await db
    .insert(projects)
    .values({
      userId,
      rawRequest: trimmed,
      state: "draft",
      workflowTemplate: "research",
    })
    .returning();

  const specifyingOk = await applyProjectTransition(
    userId,
    project.id,
    "draft",
    "intake_started",
  );
  if (!specifyingOk) {
    throw new Error("Failed to start intake");
  }

  const spec = await generateObject(
    {
      projectId: project.id,
      purpose: "spec_extraction",
    },
    {
      phaseType: "spec_extraction",
      system: INTAKE_SYSTEM,
      user: intakeUserPrompt(trimmed),
      schema: ProjectSpecSchema,
      maxTokens: 4096,
    },
  );

  await db.insert(projectSpecs).values({
    projectId: project.id,
    version: 1,
    spec,
    createdBy: "system",
  });

  const specReadyOk = await applyProjectTransition(
    userId,
    project.id,
    "specifying",
    "spec_ready",
    { title: spec.title },
  );
  if (!specReadyOk) {
    throw new Error("Failed to finalize spec");
  }

  await db
    .update(projects)
    .set({ title: spec.title, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  return {
    projectId: project.id,
    spec,
    state: "awaiting_plan_approval",
  };
}
