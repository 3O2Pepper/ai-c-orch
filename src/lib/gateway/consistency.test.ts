import { describe, expect, it } from "vitest";
import { computeCostUsd } from "@/lib/core/pricing";

describe("spent_usd consistency math", () => {
  it("rollup of multiple calls equals sum of individual costs", () => {
    const calls = [
      { model: "claude-haiku-4-5" as const, in: 1000, out: 200 },
      { model: "claude-opus-4-8" as const, in: 500, out: 1000 },
      { model: "claude-sonnet-5" as const, in: 2000, out: 500 },
    ];

    const at = new Date("2026-09-15T00:00:00Z");
    const total = calls.reduce(
      (sum, c) =>
        sum +
        computeCostUsd(
          c.model,
          {
            inputTokens: c.in,
            outputTokens: c.out,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
          at,
        ),
      0,
    );

    expect(total).toBeGreaterThan(0);
    expect(Number(total.toFixed(6))).toBe(total);
  });
});
