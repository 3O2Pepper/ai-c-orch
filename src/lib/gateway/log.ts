/**
 * Metering: every model call writes a model_calls row and rolls the cost
 * into projects.spent_usd atomically (PLAN §4). The Neon HTTP driver has no
 * interactive transactions, so both statements go through db.batch(), which
 * Neon executes as a single transaction.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { modelCalls, projects } from "@/lib/db/schema";
import type { Usage } from "@/lib/core/pricing";

export interface ModelCallLog {
  projectId: string;
  phaseId?: string | null;
  provider: string;
  model: string;
  purpose: string;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  status: "ok" | "error";
  error?: string;
}

export async function logModelCall(entry: ModelCallLog): Promise<void> {
  const insert = db.insert(modelCalls).values({
    projectId: entry.projectId,
    phaseId: entry.phaseId ?? null,
    provider: entry.provider,
    model: entry.model,
    purpose: entry.purpose,
    inputTokens: entry.usage.inputTokens,
    outputTokens: entry.usage.outputTokens,
    cacheReadInputTokens: entry.usage.cacheReadInputTokens,
    cacheCreationInputTokens: entry.usage.cacheCreationInputTokens,
    costUsd: entry.costUsd.toFixed(6),
    latencyMs: entry.latencyMs,
    status: entry.status,
    error: entry.error ?? null,
  });

  if (entry.costUsd > 0) {
    const rollup = db
      .update(projects)
      .set({
        spentUsd: sql`${projects.spentUsd} + ${entry.costUsd.toFixed(6)}`,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, entry.projectId));
    await db.batch([insert, rollup]);
  } else {
    await insert;
  }
}
