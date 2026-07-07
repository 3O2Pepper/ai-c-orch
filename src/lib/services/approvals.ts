import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema";
import { appendEvent } from "./events";

export type Gate = "plan" | "needs_input" | "budget" | "delivery";
export type ApprovalStatus = "approved" | "rejected" | "expired";

/**
 * Create (or, on a step replay, find) the open approval for a gate.
 * Idempotent: the partial unique index approvals_one_pending_per_gate_uq
 * allows at most one pending approval per (project, gate), so a retried
 * insert hits the conflict and we return the existing row instead of
 * duplicating the gate.
 */
export async function createApproval(
  projectId: string,
  gate: Gate,
  payload: Record<string, unknown>,
  opts?: { phaseId?: string | null; expiresAt?: Date | null },
): Promise<string> {
  const db = getDb();
  const [approval] = await db
    .insert(approvals)
    .values({
      projectId,
      phaseId: opts?.phaseId ?? null,
      gate,
      payload,
      status: "pending",
      expiresAt: opts?.expiresAt ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: approvals.id });

  if (approval) {
    await appendEvent(projectId, "approval_created", { approvalId: approval.id, gate });
    return approval.id;
  }

  // Replay path: the pending approval already exists — reuse it.
  const [existing] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(
        eq(approvals.projectId, projectId),
        eq(approvals.gate, gate),
        eq(approvals.status, "pending"),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error(`Approval upsert for ${gate} on ${projectId} found no pending row`);
  }
  return existing.id;
}

/**
 * Conditional resolve: only flips a still-pending approval, so a double
 * click or a race with a timeout resolves exactly once. Returns false if
 * someone else won.
 */
export async function resolveApproval(
  projectId: string,
  approvalId: string,
  status: ApprovalStatus,
  note?: string,
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(approvals)
    .set({ status, resolvedAt: new Date(), resolutionNote: note ?? null })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning({ id: approvals.id });
  if (updated.length === 0) return false;
  await appendEvent(projectId, "approval_resolved", { approvalId, status, note });
  return true;
}

/** Read a gate's recorded resolution — null while still pending. */
export async function getApprovalResolution(
  approvalId: string,
): Promise<{ status: ApprovalStatus; note: string | null } | null> {
  const [row] = await getDb()
    .select({ status: approvals.status, note: approvals.resolutionNote })
    .from(approvals)
    .where(eq(approvals.id, approvalId))
    .limit(1);
  if (!row || row.status === "pending") return null;
  return { status: row.status as ApprovalStatus, note: row.note };
}
