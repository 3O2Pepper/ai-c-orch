import { describe, expect, it } from "vitest";
import { costUsd } from "./pricing";

describe("costUsd", () => {
  it("prices plain input/output tokens", () => {
    // Opus 4.8: $5/Mtok in, $25/Mtok out
    expect(costUsd("claude-opus-4-8", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(5);
    expect(costUsd("claude-opus-4-8", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(25);
  });

  it("prices cache reads at 0.1x and cache writes at 1.25x input", () => {
    const readOnly = costUsd("claude-haiku-4-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    expect(readOnly).toBeCloseTo(0.1, 10);

    const writeOnly = costUsd("claude-haiku-4-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
    });
    expect(writeOnly).toBeCloseTo(1.25, 10);
  });

  it("sums all components", () => {
    const total = costUsd("claude-sonnet-5", {
      inputTokens: 500_000, // 0.5 * $2 = $1
      outputTokens: 100_000, // 0.1 * $10 = $1
      cacheReadInputTokens: 1_000_000, // 1 * $2 * 0.1 = $0.20
      cacheCreationInputTokens: 200_000, // 0.2 * $2 * 1.25 = $0.50
    });
    expect(total).toBeCloseTo(2.7, 10);
  });

  it("prices web search requests at $10 per 1,000", () => {
    const total = costUsd("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      webSearchRequests: 3,
    });
    expect(total).toBeCloseTo(0.03, 10);
  });
});
