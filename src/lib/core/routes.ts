import type { Effort, ModelId } from "./pricing";
import type { PhaseType } from "./spec";

// Code-default model choices per phase type. Since Phase 3 these are the
// SEED VALUES and runtime fallback for the model_routes config table — the
// router service (lib/services/router.ts) overlays DB rows on top of this
// registry, so a missing/invalid row degrades to these defaults instead of
// failing the run.

export interface PhaseRoute {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  /** Tried once when the primary model fails with an overload-class error. */
  fallbackModel?: ModelId;
  /** Attach the web_search server tool to this phase's calls. */
  webSearch?: boolean;
}

export const PHASE_MODEL_ROUTES: Record<PhaseType, PhaseRoute> = {
  spec_extraction: {
    model: "claude-sonnet-5",
    effort: "medium",
    maxTokens: 4000,
    fallbackModel: "claude-opus-4-8",
  },
  planning: {
    model: "claude-opus-4-8",
    effort: "high",
    maxTokens: 4000,
    fallbackModel: "claude-sonnet-5",
  },
  outline: {
    model: "claude-opus-4-8",
    effort: "medium",
    maxTokens: 4000,
    fallbackModel: "claude-sonnet-5",
  },
  research_gather: {
    model: "claude-sonnet-5",
    effort: "medium",
    maxTokens: 8000,
    fallbackModel: "claude-opus-4-8",
    webSearch: true,
  },
  draft: {
    model: "claude-opus-4-8",
    effort: "high",
    maxTokens: 32000,
    fallbackModel: "claude-sonnet-5",
  },
  implement_code: {
    model: "claude-sonnet-5",
    effort: "high",
    maxTokens: 32000,
    fallbackModel: "claude-opus-4-8",
  },
  xlsx_build: {
    model: "claude-sonnet-5",
    effort: "high",
    maxTokens: 16000,
    fallbackModel: "claude-opus-4-8",
  },
  digest: {
    model: "claude-haiku-4-5",
    effort: "low",
    maxTokens: 512,
    fallbackModel: "claude-sonnet-5",
  },
  revision: {
    model: "claude-sonnet-5",
    effort: "high",
    maxTokens: 32000,
    fallbackModel: "claude-opus-4-8",
  },
};
