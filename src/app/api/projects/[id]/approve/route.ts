import { NextResponse } from "next/server";
import { getCurrentUserId, scopedProjects } from "@/lib/db/client";
import { runResearchWorkflow } from "@/lib/services/runner";
import { applyProjectTransition } from "@/lib/services/project-transitions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  try {
    const userId = await getCurrentUserId();
    const project = await scopedProjects(userId).get(projectId);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.state !== "awaiting_plan_approval") {
      return NextResponse.json(
        { error: `Cannot approve project in state "${project.state}"` },
        { status: 400 },
      );
    }

    const ok = await applyProjectTransition(
      userId,
      projectId,
      "awaiting_plan_approval",
      "plan_approved",
    );

    if (!ok) {
      return NextResponse.json(
        { error: "Project state changed concurrently" },
        { status: 409 },
      );
    }

    // Fire-and-forget — Phase 1 plain async runner (local dev only).
    void runResearchWorkflow(projectId).catch((err) => {
      console.error(`Workflow failed for ${projectId}:`, err);
    });

    return NextResponse.json({ projectId, state: "running" });
  } catch (err) {
    console.error("Approve failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Approval failed" },
      { status: 500 },
    );
  }
}
