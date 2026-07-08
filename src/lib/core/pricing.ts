// One source of truth for model capability + price. Consumed by the gateway
// (cost calc); later by the Phase 3 router and Phase 4 plan-card estimates.
//
// Prices are USD per million tokens. Sonnet 5 values are the introductory
// rate valid through 2026-08-31 — bump to 3/15 after that date.

export const PROVIDER = "anthropic" as const;

export interface ModelInfo {
  provider: typeof PROVIDER;
  inputPerMtok: number;
  outputPerMtok: number;
  contextWindow: number;
  maxOutput: number;
  /** Supports thinking: {type: "adaptive"} (4.6+ models; Haiku 4.5 does not). */
  adaptiveThinking: boolean;
  /** Supports output_config.effort (errors on Haiku 4.5). */
  effort: boolean;
}

export const MODELS = {
  "claude-opus-4-8": {
    provider: PROVIDER,
    inputPerMtok: 5,
    outputPerMtok: 25,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    adaptiveThinking: true,
    effort: true,
  },
  "claude-sonnet-5": {
    provider: PROVIDER,
    inputPerMtok: 2, // intro pricing through 2026-08-31 (then 3)
    outputPerMtok: 10, // intro pricing through 2026-08-31 (then 15)
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    adaptiveThinking: true,
    effort: true,
  },
  "claude-haiku-4-5": {
    provider: PROVIDER,
    inputPerMtok: 1,
    outputPerMtok: 5,
    contextWindow: 200_000,
    maxOutput: 64_000,
    adaptiveThinking: false,
    effort: false,
  },
} as const satisfies Record<string, ModelInfo>;

export type ModelId = keyof typeof MODELS;

/** Depth control for models that support output_config.effort. */
export type Effort = "low" | "medium" | "high";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  /** Server-side web_search tool invocations (billed per search). */
  webSearchRequests?: number;
}

// Cache reads bill at ~0.1x input price, cache writes at ~1.25x (5m TTL).
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

// Web search server tool: $10 per 1,000 searches, on top of the tokens the
// results consume (which land in the normal usage fields).
export const WEB_SEARCH_COST_PER_REQUEST = 0.01;

export function costUsd(model: ModelId, usage: Usage): number {
  const m = MODELS[model];
  const perTokIn = m.inputPerMtok / 1_000_000;
  const perTokOut = m.outputPerMtok / 1_000_000;
  return (
    usage.inputTokens * perTokIn +
    usage.outputTokens * perTokOut +
    (usage.cacheReadInputTokens ?? 0) * perTokIn * CACHE_READ_MULTIPLIER +
    (usage.cacheCreationInputTokens ?? 0) * perTokIn * CACHE_WRITE_MULTIPLIER +
    (usage.webSearchRequests ?? 0) * WEB_SEARCH_COST_PER_REQUEST
  );
}
