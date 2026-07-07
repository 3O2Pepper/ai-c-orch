import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { budgetRaised, projectCancelled } from "@/inngest/client";
import { TransitionError } from "@/lib/core/transitions";
import { getDb } from "@/lib/db/client";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { projects } from "@/lib/db/schema";
import { resolveApproval } from "@/lib/services/approvals";
import { publishEvent } from "@/lib/services/outbox";
import { applyProjectTransition, StateRaceError } from "@/lib/services/state";

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("raise"),
    newBudgetUsd: z.number().positive("Budget must be positive"),
  }),
  z.object({ action: z.literal("stop") }),
]);

// Gate 2 (budget): raise resumes the run; stop cancels it.
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
    if (project.state !== "paused") {
      return NextResponse.json(
        { error: "Project is not paused on a budget gate" },
        { status: 409 },
      );
    }
    const approval = await q.getPendingApproval(id);
    if (!approval || approval.gate !== "budget") {
      return NextResponse.json({ error: "No budget gate open" }, { status: 409 });
    }

    if (parsed.data.action === "raise") {
      const newBudget = parsed.data.newBudgetUsd;
      if (newBudget <= Number(project.spentUsd)) {
        return NextResponse.json(
          { error: `New budget must exceed current spend ($${project.spentUsd})` },
          { status: 400 },
        );
      }
      const resolved = await resolveApproval(
        id,
        approval.id,
        "approved",
        `Budget raised to $${newBudget}`,
      );
      if (!resolved) {
        return NextResponse.json({ error: "Already resolved" }, { status: 409 });
      }
      await getDb()
        .update(projects)
        .set({ budgetUsd: String(newBudget) })
        .where(eq(projects.id, id));
      await applyProjectTransition(id, "paused", { type: "resumed" });
      await publishEvent(
        id,
        budgetRaised.create({
          projectId: id,
          approvalId: approval.id,
          newBudgetUsd: newBudget,
        }),
        `budget-raised:${approval.id}`,
      );
      return NextResponse.json({ state: "running" });
    }

    // stop
    const resolved = await resolveApproval(id, approval.id, "rejected", "Stopped");
    if (!resolved) {
      return NextResponse.json({ error: "Already resolved" }, { status: 409 });
    }
    await applyProjectTransition(id, "paused", { type: "cancelled" });
    await publishEvent(
      id,
      projectCancelled.create({ projectId: id }),
      `cancelled:${id}`,
    );
    return NextResponse.json({ state: "cancelled" });
  } catch (err) {
    if (err instanceof StateRaceError || err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("budget action failed:", err);
    return NextResponse.json({ error: "Budget action failed" }, { status: 500 });
  }
}
