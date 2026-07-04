import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit only needs this for migrate/push/studio, not for generate
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
