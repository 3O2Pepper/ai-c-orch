import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

// Schema is wired in here in Commit 3. Lazy init so importing this module
// never throws when DATABASE_URL is absent (e.g. during unit tests).
let db: NeonHttpDatabase | null = null;

export function getDb(): NeonHttpDatabase {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set — add it to .env.local");
    }
    db = drizzle(neon(url));
  }
  return db;
}
