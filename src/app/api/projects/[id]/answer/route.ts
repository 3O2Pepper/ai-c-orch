import { NextResponse } from "next/server";
import { z } from "zod";
import { inputProvided } from "@/inngest/client";
import { TransitionError } from "@/lib/core/transitions";
import { getDb } from "@/lib/db/client";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { messages } from "@/lib/db/schema";
import { resolveApproval } from "@/lib/services/approvals";
import { recordDecision } from "@/lib/services/context";
import { publishEvent } from "@/lib/services/outbox";
import { applyProjectTransition, StateRaceError } from "@/lib/services/state";

const BodySchema = z.object({
  answer: z.string().trim().min(1, "Answer is required"),
});

// Resolves the needs_input gate: record the decision, resume the run.
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
    if (project.state !== "needs_input") {
      return NextResponse.json(
        { error: "Project is not waiting for input" },
        { status: 409 },
      );
    }
    const approval = await q.getPendingApproval(id);
    if (!approval || approval.gate !== "needs_input") {
      return NextResponse.json({ error: "No open question found" }, { status: 409 });
    }

    const answer = parsed.data.answer;
    const resolved = await resolveApproval(id, approval.id, "approved", answer);
    if (!resolved) {
      return NextResponse.json({ error: "Question already resolved" }, { status: 409 });
    }
    await getDb().insert(messages).values({
      projectId: id,
      role: "user",
      content: answer,
      linkedApprovalId: approval.id,
    });
    const question =
      (approval.payload as { question?: string } | null)?.question ?? "open question";
    await recordDecision(
      id,
      `Q: ${question} — user decided: ${answer}`,
      `approval:${approval.id}`,
    );
    await applyProjectTransition(id, "needs_input", { type: "input_provided" });
    await publishEvent(
      id,
      inputProvided.create({ projectId: id, approvalId: approval.id, answer }),
      `input:${approval.id}`,
    );
    return NextResponse.json({ state: "running" });
  } catch (err) {
    if (err instanceof StateRaceError || err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("answer failed:", err);
    return NextResponse.json({ error: "Answer failed" }, { status: 500 });
  }
}
