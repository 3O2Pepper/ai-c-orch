import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { flushOutboxFn } from "@/inngest/functions/flush-outbox";
import { runProject } from "@/inngest/functions/run-project";

// Inngest runs inside the Next.js app (PLAN §0.1 — one deployable).
// Local dev requires the Inngest dev server: `npm run dev:inngest`.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runProject, flushOutboxFn],
});
