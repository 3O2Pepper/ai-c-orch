import { MODELS } from "@/lib/core/pricing";
import { PHASE_MODEL_ROUTES, type PhaseRoute } from "@/lib/core/routes";
import type { PhaseType } from "@/lib/core/spec";
import { getDb } from "@/lib/db/client";
import { modelRoutes } from "@/lib/db/schema";

// The Phase 3 router: model_routes rows override the code-default registry
// per phase type. Fail-open by design — a missing table, missing row, or
// invalid row falls back to the code default (with a logged warning), so a
// bad config edit can degrade quality but never strand a run.

const CACHE_TTL_MS = 60_000;

interface RouteCache {
  rows: Map<string, typeof modelRoutes.$inferSelect>;
  loadedAt: number;
}

let cache: RouteCache | null = null;

async function loadRows(): Promise<RouteCache["rows"]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const all = await getDb().select().from(modelRoutes);
  cache = { rows: new Map(all.map((r) => [r.phaseType, r])), loadedAt: now };
  return cache.rows;
}

/** Test/ops hook: force the next resolveRoute to re-read the DB. */
export function invalidateRouteCache(): void {
  cache = null;
}

const EFFORTS = ["low", "medium", "high"] as const;

function validated(row: typeof modelRoutes.$inferSelect): PhaseRoute | null {
  if (!(row.model in MODELS)) return null;
  if (!EFFORTS.includes(row.effort as (typeof EFFORTS)[number])) return null;
  const model = row.model as PhaseRoute["model"];
  if (row.maxTokens <= 0 || row.maxTokens > MODELS[model].maxOutput) return null;
  if (row.fallbackModel !== null && !(row.fallbackModel in MODELS)) return null;
  return {
    model,
    effort: row.effort as PhaseRoute["effort"],
    maxTokens: row.maxTokens,
    fallbackModel: (row.fallbackModel as PhaseRoute["fallbackModel"]) ?? undefined,
    webSearch: row.webSearch,
  };
}

/**
 * Resolve the route for a phase type: DB config if present and valid,
 * otherwise the code default. Never throws on config problems.
 */
export async function resolveRoute(phaseType: PhaseType): Promise<PhaseRoute> {
  const fallback = PHASE_MODEL_ROUTES[phaseType];
  let row: typeof modelRoutes.$inferSelect | undefined;
  try {
    row = (await loadRows()).get(phaseType);
  } catch (err) {
    console.warn(`router: model_routes read failed, using code default:`, err);
    return fallback;
  }
  if (!row) return fallback;
  const route = validated(row);
  if (!route) {
    console.warn(
      `router: invalid model_routes row for '${phaseType}' — using code default`,
    );
    return fallback;
  }
  return route;
}
