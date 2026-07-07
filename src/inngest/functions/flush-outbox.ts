import { cron } from "inngest";
import { inngest } from "@/inngest/client";
import { flushOutbox } from "@/lib/services/outbox";

// Outbox sweeper: re-sends workflow events whose inline send failed (e.g.
// the Inngest server was briefly unreachable from a route). Runs every
// minute so a project transitioned by a route is never left waiting on an
// undelivered event for long. Duplicate sends are harmless — every event
// carries an idempotency id.
export const flushOutboxFn = inngest.createFunction(
  { id: "flush-outbox", retries: 0, triggers: [cron("* * * * *")] },
  async () => flushOutbox(),
);
