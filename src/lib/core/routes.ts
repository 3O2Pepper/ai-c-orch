import type { Effort, ModelId } from "./pricing";
import type { PhaseType } from "./spec";

// Centralized Phase 1 model choices — one place to see and change which
// model handles which phase type, instead of scattering model IDs across
// intake/runner. This is NOT the Phase 3 router (no needs matching, no
// fallback chains, no budget checks) — it becomes the seed data for that
// config table when the router lands.

export interface PhaseRoute {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
}

export const PHASE_MODEL_ROUTES: Record<PhaseType, PhaseRoute> = {
  spec_extraction: { model: "claude-sonnet-5", effort: "medium", maxTokens: 4000 },
  outline: { model: "claude-opus-4-8", effort: "medium", maxTokens: 4000 },
  draft: { model: "claude-opus-4-8", effort: "high", maxTokens: 32000 },
  digest: { model: "claude-haiku-4-5", effort: "low", maxTokens: 512 },
};
