import { NextResponse } from "next/server";
import { inngest, planApproved } from "@/inngest/client";
import type { ProjectState } from "@/lib/core/states";
import { TransitionError } from "@/lib/core/transitions";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { resolveApproval } from "@/lib/services/approvals";
import { applyProjectTransition, StateRaceError } from "@/lib/services/state";

// Gate 1 (plan approval): resolve the approval, transition, and hand the
// run to the durable workflow via the plan.approved event.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const userId = await getDevUserId();
    const q = forUser(userId);
    const project = await q.getProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const state = await applyProjectTransition(
      project.id,
      project.state as ProjectState,
      { type: "plan_approved" },
    );

    const approval = await q.getPendingApproval(project.id);
    if (approval?.gate === "plan") {
      await resolveApproval(project.id, approval.id, "approved");
    }

    await inngest.send(planApproved.create({ projectId: project.id, userId }));
    return NextResponse.json({ state });
  } catch (err) {
    if (err instanceof StateRaceError || err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("approve failed:", err);
    return NextResponse.json({ error: "Approve failed" }, { status: 500 });
  }
}
