/**
 * Model capability/price registry — the one source of truth (PLAN §6).
 * Consumed by the gateway for cost calc; later by the router (P3) and
 * plan-card estimates (P4). Prices are USD per million tokens.
 * PURE MODULE — no Next/DB/SDK imports.
 */
import type { PhaseType } from "./spec";

export type ModelId = "claude-sonnet-5" | "claude-opus-4-8" | "claude-haiku-4-5";

export type Effort = "low" | "medium" | "high";

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPerMtok: number;
  /** USD per 1M output tokens */
  outputPerMtok: number;
  /** Cache reads are billed at 10% of the input rate. */
  cacheReadPerMtok: number;
  /** Cache writes (5m TTL) are billed at 125% of the input rate. */
  cacheWritePerMtok: number;
}

/** Sonnet 5 intro pricing ($2/$10) runs through 2026-08-31 (UTC). */
export const SONNET5_INTRO_PRICING_ENDS = new Date("2026-09-01T00:00:00Z");

const SONNET5_INTRO: ModelPricing = {
  inputPerMtok: 2,
  outputPerMtok: 10,
  cacheReadPerMtok: 0.2,
  cacheWritePerMtok: 2.5,
};

const SONNET5_STANDARD: ModelPricing = {
  inputPerMtok: 3,
  outputPerMtok: 15,
  cacheReadPerMtok: 0.3,
  cacheWritePerMtok: 3.75,
};

const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  "claude-sonnet-5": SONNET5_STANDARD,
  "claude-opus-4-8": {
    inputPerMtok: 5,
    outputPerMtok: 25,
    cacheReadPerMtok: 0.5,
    cacheWritePerMtok: 6.25,
  },
  "claude-haiku-4-5": {
    inputPerMtok: 1,
    outputPerMtok: 5,
    cacheReadPerMtok: 0.1,
    cacheWritePerMtok: 1.25,
  },
};

export function getPricing(model: ModelId, at: Date = new Date()): ModelPricing {
  if (model === "claude-sonnet-5" && at < SONNET5_INTRO_PRICING_ENDS) {
    return SONNET5_INTRO;
  }
  return MODEL_PRICING[model];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/**
 * Cost in USD for one call. `input_tokens` from the API already excludes
 * cached tokens, so the four buckets are additive.
 */
export function computeCostUsd(
  model: ModelId,
  usage: Usage,
  at: Date = new Date(),
): number {
  const p = getPricing(model, at);
  const cost =
    (usage.inputTokens / 1_000_000) * p.inputPerMtok +
    (usage.outputTokens / 1_000_000) * p.outputPerMtok +
    (usage.cacheReadInputTokens / 1_000_000) * p.cacheReadPerMtok +
    (usage.cacheCreationInputTokens / 1_000_000) * p.cacheWritePerMtok;
  // Round to 6 decimal places to keep numeric columns tidy.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Router table (PLAN §6). Phase 1's runner reads this map directly;
 * the config-table router replaces the lookup in Phase 3.
 */
export const MODEL_ROUTES: Record<
  PhaseType,
  { model: ModelId; effort: Effort }
> = {
  spec_extraction: { model: "claude-sonnet-5", effort: "medium" },
  planning: { model: "claude-opus-4-8", effort: "high" },
  research_gather: { model: "claude-sonnet-5", effort: "medium" }, // [P3]
  synthesis_draft: { model: "claude-opus-4-8", effort: "high" },
  implement_code: { model: "claude-sonnet-5", effort: "medium" }, // [P3]
  debug_fix: { model: "claude-sonnet-5", effort: "medium" }, // [P3]
  xlsx_build: { model: "claude-sonnet-5", effort: "medium" }, // [P3]
  summarize_digest: { model: "claude-haiku-4-5", effort: "low" },
  critique: { model: "claude-opus-4-8", effort: "high" }, // [P4]
  revision: { model: "claude-sonnet-5", effort: "medium" }, // [P2]
};
