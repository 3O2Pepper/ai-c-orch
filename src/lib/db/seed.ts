import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { DEV_USER_EMAIL } from "./dev-user";
import { users } from "./schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — add it to .env.local");
  }
  const db = drizzle(neon(url));

  const inserted = await db
    .insert(users)
    .values({ email: DEV_USER_EMAIL, name: "Dev User" })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  if (inserted.length > 0) {
    console.log(`Seeded dev user ${DEV_USER_EMAIL} (${inserted[0].id})`);
  } else {
    console.log(`Dev user ${DEV_USER_EMAIL} already exists — nothing to do`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
