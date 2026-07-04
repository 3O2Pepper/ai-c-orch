/**
 * Seeds the single dev user (Phase 1 has no auth).
 * Run with: npm run db:seed
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (copy .env.example to .env.local)");
  }
  const db = drizzle(neon(url), { schema });

  await db
    .insert(schema.users)
    .values({
      id: DEV_USER_ID,
      email: "dev@localhost",
      name: "Dev User",
      settings: {},
    })
    .onConflictDoNothing({ target: schema.users.id });

  console.log(`Seeded dev user ${DEV_USER_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
