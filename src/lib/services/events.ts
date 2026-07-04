import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";

/** Append-only event writer — feeds the UI log and future debugging. */
export async function appendEvent(
  projectId: string,
  type: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(events).values({ projectId, type, payload: payload ?? null });
}
