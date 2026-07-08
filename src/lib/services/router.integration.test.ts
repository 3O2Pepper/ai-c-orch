import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// Router contract: DB rows override the code registry; invalid rows and
// missing rows fall back to the code default (fail-open). Needs a real
// database; skips without DATABASE_URL.

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("model router (integration)", () => {
  afterAll(async () => {
    // Restore the seeded digest row we mutate below.
    const { getDb } = await import("@/lib/db/client");
    const { modelRoutes } = await import("@/lib/db/schema");
    const { PHASE_MODEL_ROUTES } = await import("@/lib/core/routes");
    const d = PHASE_MODEL_ROUTES.digest;
    await getDb()
      .update(modelRoutes)
      .set({
        model: d.model,
        effort: d.effort,
        maxTokens: d.maxTokens,
        fallbackModel: d.fallbackModel ?? null,
        webSearch: d.webSearch ?? false,
      })
      .where(eq(modelRoutes.phaseType, "digest"));
  });

  it("returns the seeded DB route for a known phase type", async () => {
    const { resolveRoute, invalidateRouteCache } = await import("./router");
    invalidateRouteCache();
    const route = await resolveRoute("outline");
    expect(route.model).toBe("claude-opus-4-8");
    expect(route.maxTokens).toBeGreaterThan(0);
  });

  it("applies a DB override after cache invalidation", async () => {
    const { resolveRoute, invalidateRouteCache } = await import("./router");
    const { getDb } = await import("@/lib/db/client");
    const { modelRoutes } = await import("@/lib/db/schema");

    await getDb()
      .update(modelRoutes)
      .set({ model: "claude-sonnet-5", maxTokens: 1024 })
      .where(eq(modelRoutes.phaseType, "digest"));
    invalidateRouteCache();

    const route = await resolveRoute("digest");
    expect(route.model).toBe("claude-sonnet-5");
    expect(route.maxTokens).toBe(1024);
  });

  it("falls back to the code default when the DB row is invalid", async () => {
    const { resolveRoute, invalidateRouteCache } = await import("./router");
    const { getDb } = await import("@/lib/db/client");
    const { modelRoutes } = await import("@/lib/db/schema");
    const { PHASE_MODEL_ROUTES } = await import("@/lib/core/routes");

    await getDb()
      .update(modelRoutes)
      .set({ model: "gpt-99-turbo" }) // not a known ModelId
      .where(eq(modelRoutes.phaseType, "digest"));
    invalidateRouteCache();

    const route = await resolveRoute("digest");
    expect(route).toEqual(PHASE_MODEL_ROUTES.digest);
  });
});
