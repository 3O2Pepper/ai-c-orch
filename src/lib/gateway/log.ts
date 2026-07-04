import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { costUsd, type ModelId, type Usage } from "@/lib/core/pricing";
import { MODELS } from "@/lib/core/pricing";

export interface ModelCallLog {
  projectId: string;
  phaseId?: string | null;
  model: ModelId;
  purpose: string;
  usage: Usage | null;
  latencyMs: number;
  status: "ok" | "error";
  error?: string;
}

// Insert the model_calls row and roll the cost into projects.spent_usd in a
// single statement (CTE) — atomic without needing driver transaction support,
// so the meter can never drift from the log.
export async function logModelCall(log: ModelCallLog): Promise<number> {
  const db = getDb();
  const cost = log.usage ? costUsd(log.model, log.usage) : 0;
  const provider = MODELS[log.model].provider;

  await db.execute(sql`
    WITH ins AS (
      INSERT INTO model_calls (
        project_id, phase_id, provider, model, purpose,
        input_tokens, output_tokens,
        cache_read_input_tokens, cache_creation_input_tokens,
        cost_usd, latency_ms, status, error
      ) VALUES (
        ${log.projectId}, ${log.phaseId ?? null}, ${provider}, ${log.model}, ${log.purpose},
        ${log.usage?.inputTokens ?? null}, ${log.usage?.outputTokens ?? null},
        ${log.usage?.cacheReadInputTokens ?? null}, ${log.usage?.cacheCreationInputTokens ?? null},
        ${cost}, ${log.latencyMs}, ${log.status}, ${log.error ?? null}
      )
      RETURNING project_id, cost_usd
    )
    UPDATE projects
    SET spent_usd = projects.spent_usd + ins.cost_usd, updated_at = now()
    FROM ins
    WHERE projects.id = ins.project_id
  `);

  return cost;
}
