import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema";
import { appendEvent } from "./events";

export type Gate = "plan" | "needs_input" | "budget" | "delivery";
export type ApprovalStatus = "approved" | "rejected" | "expired";

export async function createApproval(
  projectId: string,
  gate: Gate,
  payload: Record<string, unknown>,
  phaseId?: string | null,
): Promise<string> {
  const db = getDb();
  const [approval] = await db
    .insert(approvals)
    .values({ projectId, phaseId: phaseId ?? null, gate, payload, status: "pending" })
    .returning({ id: approvals.id });
  await appendEvent(projectId, "approval_created", { approvalId: approval.id, gate });
  return approval.id;
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
