import { describe, expect, it } from "vitest";
import {
  computeCostUsd,
  getPricing,
  MODEL_ROUTES,
  SONNET5_INTRO_PRICING_ENDS,
} from "./pricing";

const AFTER_INTRO = new Date("2026-09-15T00:00:00Z");
const DURING_INTRO = new Date("2026-07-15T00:00:00Z");

describe("getPricing", () => {
  it("uses Sonnet 5 intro pricing before 2026-09-01", () => {
    const p = getPricing("claude-sonnet-5", DURING_INTRO);
    expect(p.inputPerMtok).toBe(2);
    expect(p.outputPerMtok).toBe(10);
  });

  it("uses Sonnet 5 standard pricing after the intro window", () => {
    const p = getPricing("claude-sonnet-5", AFTER_INTRO);
    expect(p.inputPerMtok).toBe(3);
    expect(p.outputPerMtok).toBe(15);
  });

  it("intro cutoff is exact", () => {
    const p = getPricing("claude-sonnet-5", SONNET5_INTRO_PRICING_ENDS);
    expect(p.inputPerMtok).toBe(3);
  });
});

describe("computeCostUsd", () => {
  const noCache = { cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

  it("computes Opus 4.8 at $5/$25 per Mtok", () => {
    const cost = computeCostUsd(
      "claude-opus-4-8",
      { inputTokens: 1_000_000, outputTokens: 1_000_000, ...noCache },
      AFTER_INTRO,
    );
    expect(cost).toBe(30);
  });

  it("computes Haiku 4.5 at $1/$5 per Mtok", () => {
    const cost = computeCostUsd(
      "claude-haiku-4-5",
      { inputTokens: 2_000_000, outputTokens: 400_000, ...noCache },
      AFTER_INTRO,
    );
    expect(cost).toBe(4);
  });

  it("prices cache reads at 10% and cache writes at 125% of input", () => {
    const cost = computeCostUsd(
      "claude-opus-4-8",
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
      },
      AFTER_INTRO,
    );
    expect(cost).toBe(0.5 + 6.25);
  });

  it("handles a realistic small call", () => {
    // 1200 in / 800 out on Sonnet 5 intro pricing: 1200*2e-6 + 800*10e-6
    const cost = computeCostUsd(
      "claude-sonnet-5",
      { inputTokens: 1200, outputTokens: 800, ...noCache },
      DURING_INTRO,
    );
    expect(cost).toBeCloseTo(0.0104, 6);
  });

  it("returns 0 for zero usage", () => {
    const cost = computeCostUsd(
      "claude-sonnet-5",
      { inputTokens: 0, outputTokens: 0, ...noCache },
      AFTER_INTRO,
    );
    expect(cost).toBe(0);
  });
});

describe("MODEL_ROUTES", () => {
  it("routes every phase type in the registry", () => {
    expect(MODEL_ROUTES.spec_extraction.model).toBe("claude-sonnet-5");
    expect(MODEL_ROUTES.planning.model).toBe("claude-opus-4-8");
    expect(MODEL_ROUTES.synthesis_draft.model).toBe("claude-opus-4-8");
    expect(MODEL_ROUTES.summarize_digest.model).toBe("claude-haiku-4-5");
    expect(MODEL_ROUTES.summarize_digest.effort).toBe("low");
    expect(MODEL_ROUTES.revision.model).toBe("claude-sonnet-5");
  });
});
