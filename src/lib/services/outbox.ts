import { asc, eq, isNull } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { getDb } from "@/lib/db/client";
import { eventOutbox } from "@/lib/db/schema";

// Transition -> event publishing seam (P2 hardening). A route commits its
// state transition first, so the DB is the source of truth; this module
// guarantees the matching workflow event is delivered at least once:
//
//   1. record the event in event_outbox
//   2. attempt the send inline (fast path)
//   3. a cron sweeper (src/inngest/functions/flush-outbox.ts) re-sends
//      anything still unsent
//
// Duplicate delivery is prevented by the Inngest event idempotency `id`
// (dedupe_id), and every workflow waitForEvent matches on a specific
// approvalId, so a re-sent stale event can never satisfy a later gate.

export interface OutboundEvent {
  name: string;
  data: Record<string, unknown>;
}

/**
 * Publish a workflow event with outbox backing. Never throws on send
 * failure — the caller's state transition already committed, and the
 * sweeper will deliver the event. Returns whether the inline send worked.
 */
export async function publishEvent(
  projectId: string,
  event: OutboundEvent,
  dedupeId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .insert(eventOutbox)
    .values({ projectId, eventName: event.name, dedupeId, payload: event.data })
    .returning({ id: eventOutbox.id });

  try {
    await inngest.send({ name: event.name, data: event.data, id: dedupeId });
    await db
      .update(eventOutbox)
      .set({ sentAt: new Date(), attempts: 1 })
      .where(eq(eventOutbox.id, row.id));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`outbox: inline send failed for ${event.name} (${dedupeId}):`, message);
    await db
      .update(eventOutbox)
      .set({ attempts: 1, lastError: message })
      .where(eq(eventOutbox.id, row.id))
      .catch(() => {});
    return false;
  }
}

const FLUSH_BATCH = 50;

/** Re-send everything unsent, oldest first. Called by the cron sweeper. */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const pending = await db
    .select()
    .from(eventOutbox)
    .where(isNull(eventOutbox.sentAt))
    .orderBy(asc(eventOutbox.createdAt))
    .limit(FLUSH_BATCH);

  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      await inngest.send({
        name: row.eventName,
        data: row.payload as Record<string, unknown>,
        id: row.dedupeId,
      });
      await db
        .update(eventOutbox)
        .set({ sentAt: new Date(), attempts: row.attempts + 1, lastError: null })
        .where(eq(eventOutbox.id, row.id));
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(eventOutbox)
        .set({ attempts: row.attempts + 1, lastError: message })
        .where(eq(eventOutbox.id, row.id))
        .catch(() => {});
      failed++;
    }
  }
  return { sent, failed };
}
