import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

// Standalone gateway verification (PLAN commit 4): creates a scratch project,
// makes one cheap Haiku call through the gateway, and prints the metering
// trail. Requires DATABASE_URL (migrated + seeded) and ANTHROPIC_API_KEY.
//
//   npm run check:gateway

import { desc, eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { getDevUserId } from "../src/lib/db/dev-user";
import { modelCalls, projects } from "../src/lib/db/schema";
import { generateText } from "../src/lib/gateway";

async function main() {
  const db = getDb();
  const userId = await getDevUserId();

  const [project] = await db
    .insert(projects)
    .values({
      userId,
      title: "gateway check (scratch)",
      rawRequest: "gateway smoke test",
      state: "draft",
    })
    .returning();

  console.log(`Scratch project: ${project.id}`);

  const { text, usage, costUsd } = await generateText({
    projectId: project.id,
    purpose: "gateway_check",
    model: "claude-haiku-4-5",
    prompt: "Reply with exactly: gateway ok",
    maxTokens: 64,
    effort: "low",
  });

  console.log(`Response: ${text.trim()}`);
  console.log(`Usage: in=${usage.inputTokens} out=${usage.outputTokens}`);
  console.log(`Cost: $${costUsd.toFixed(6)}`);

  const [call] = await db
    .select()
    .from(modelCalls)
    .where(eq(modelCalls.projectId, project.id))
    .orderBy(desc(modelCalls.createdAt))
    .limit(1);
  console.log(
    `model_calls row: model=${call.model} status=${call.status} cost=$${call.costUsd}`,
  );

  const [p] = await db.select().from(projects).where(eq(projects.id, project.id));
  console.log(`projects.spent_usd: $${p.spentUsd}`);

  const drift = Math.abs(Number(p.spentUsd) - Number(call.costUsd));
  if (drift > 1e-9) {
    throw new Error(`spent_usd drifted from model_calls total by ${drift}`);
  }
  console.log("OK: metering consistent");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
