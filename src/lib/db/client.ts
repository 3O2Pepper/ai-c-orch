import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

// Lazy init so importing this module never throws when DATABASE_URL is
// absent (e.g. during unit tests).
let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set — add it to .env.local");
    }
    db = drizzle(neon(url), { schema });
  }
  return db;
}
