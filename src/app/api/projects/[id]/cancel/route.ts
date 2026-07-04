import { NextResponse } from "next/server";
import type { ProjectState } from "@/lib/core/states";
import { TransitionError } from "@/lib/core/transitions";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { applyProjectTransition, StateRaceError } from "@/lib/services/state";

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
      { type: "cancelled" },
    );
    return NextResponse.json({ state });
  } catch (err) {
    if (err instanceof StateRaceError || err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("cancel failed:", err);
    return NextResponse.json({ error: "Cancel failed" }, { status: 500 });
  }
}
