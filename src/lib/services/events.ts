import { db } from "@/lib/db/client";
import { events } from "@/lib/db/schema";

export async function appendEvent(
  projectId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(events).values({
    projectId,
    type,
    payload,
  });
}
