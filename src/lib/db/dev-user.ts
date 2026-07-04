import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { users } from "./schema";

// Single-user MVP: every request runs as the seeded dev user. Phase 4
// replaces this with the authenticated session's user id — which is why all
// queries are already scoped by userId (see queries.ts).
export const DEV_USER_EMAIL = "dev@local";

export async function getDevUserId(): Promise<string> {
  const db = getDb();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEV_USER_EMAIL))
    .limit(1);
  if (!user) {
    throw new Error("Dev user not found — run `npm run db:seed` first");
  }
  return user.id;
}
