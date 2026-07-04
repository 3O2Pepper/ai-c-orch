/**
 * Standalone gateway smoke test. Requires DATABASE_URL, ANTHROPIC_API_KEY,
 * and a seeded dev user with at least one project row.
 *
 * Usage: npm run verify:gateway -- <project-id>
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { generate } from "../src/lib/gateway";
import * as schema from "../src/lib/db/schema";

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage: npm run verify:gateway -- <project-id>");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const db = drizzle(neon(url), { schema });
  const project = await db.query.projects.findFirst({
    where: (p, { eq }) => eq(p.id, projectId),
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);

  console.log("Calling gateway (Haiku digest route via summarize_digest)…");
  const text = await generate(
    { projectId, purpose: "verify_gateway" },
    {
      phaseType: "summarize_digest",
      system: "Reply with exactly: gateway ok",
      user: "Say gateway ok",
      maxTokens: 64,
    },
  );

  console.log("Response:", text.trim());
  console.log("Gateway verify complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
