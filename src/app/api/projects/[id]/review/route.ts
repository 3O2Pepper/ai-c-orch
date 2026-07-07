import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewResolved } from "@/inngest/client";
import { MAX_REVISION_ROUNDS } from "@/lib/core/gates";
import { TransitionError } from "@/lib/core/transitions";
import { getDb } from "@/lib/db/client";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { messages, phases } from "@/lib/db/schema";
import { resolveApproval } from "@/lib/services/approvals";
import { publishEvent } from "@/lib/services/outbox";
import { applyProjectTransition, StateRaceError } from "@/lib/services/state";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({
    action: z.literal("revise"),
    instructions: z.string().trim().min(1, "Revision instructions are required"),
  }),
]);

// Gate 4 (delivery): accept finishes the project; revise loops it back
// through a scoped revision phase.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  try {
    const userId = await getDevUserId();
    const q = forUser(userId);
    const project = await q.getProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.state !== "review") {
      return NextResponse.json({ error: "Project is not in review" }, { status: 409 });
    }
    const approval = await q.getPendingApproval(id);
    if (!approval || approval.gate !== "delivery") {
      return NextResponse.json({ error: "No delivery gate open" }, { status: 409 });
    }

    if (parsed.data.action === "accept") {
      const resolved = await resolveApproval(id, approval.id, "approved");
      if (!resolved) {
        return NextResponse.json({ error: "Already resolved" }, { status: 409 });
      }
      await applyProjectTransition(id, "review", { type: "delivery_accepted" });
      await publishEvent(
        id,
        reviewResolved.create({
          projectId: id,
          approvalId: approval.id,
          action: "accept",
        }),
        `review:${approval.id}`,
      );
      return NextResponse.json({ state: "done" });
    }

    // revise — bounded: the workflow loop caps at MAX_REVISION_ROUNDS
    const db = getDb();
    const revisionCount = (
      await db
        .select({ id: phases.id })
        .from(phases)
        .where(and(eq(phases.projectId, id), eq(phases.phaseType, "revision")))
    ).length;
    if (revisionCount >= MAX_REVISION_ROUNDS) {
      return NextResponse.json(
        { error: `Revision limit reached (${MAX_REVISION_ROUNDS}) — accept or cancel` },
        { status: 409 },
      );
    }

    const instructions = parsed.data.instructions;
    const resolved = await resolveApproval(
      id,
      approval.id,
      "rejected",
      "Revision requested",
    );
    if (!resolved) {
      return NextResponse.json({ error: "Already resolved" }, { status: 409 });
    }
    await db.insert(messages).values({
      projectId: id,
      role: "user",
      content: instructions,
      linkedApprovalId: approval.id,
    });
    await applyProjectTransition(id, "review", { type: "revision_requested" });
    await publishEvent(
      id,
      reviewResolved.create({
        projectId: id,
        approvalId: approval.id,
        action: "revise",
        instructions,
      }),
      `review:${approval.id}`,
    );
    return NextResponse.json({ state: "running" });
  } catch (err) {
    if (err instanceof StateRaceError || err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("review action failed:", err);
    return NextResponse.json({ error: "Review action failed" }, { status: 500 });
  }
}
