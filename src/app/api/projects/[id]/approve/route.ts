import { NextResponse } from "next/server";
import type { ProjectState } from "@/lib/core/states";
import { TransitionError } from "@/lib/core/transitions";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { runProject } from "@/lib/services/runner";
import { applyProjectTransition, StateRaceError } from "@/lib/services/state";

// Gate 1 (plan approval). Approval triggers the Phase 1 runner in-process
// (fire-and-forget; the runner handles its own failure transition).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const userId = await getDevUserId();
    const project = await forUser(userId).getProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const state = await applyProjectTransition(
      project.id,
      project.state as ProjectState,
      { type: "plan_approved" },
    );
    runProject(project.id).catch((err) => {
      console.error(`run failed for project ${project.id}:`, err);
    });
    return NextResponse.json({ state });
  } catch (err) {
    if (err instanceof StateRaceError || err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("approve failed:", err);
    return NextResponse.json({ error: "Approve failed" }, { status: 500 });
  }
}
