import {
  bigserial,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Phase 1 subset of the PLAN.md §4 schema. [Later] tables (api_keys,
// context_items, approvals, messages) are added with their features in
// Phases 2-4 — do not create them early.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  settings: jsonb("settings"),
  ...timestamps,
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title"),
  rawRequest: text("raw_request").notNull(), // original messy input, immutable
  state: text("state").notNull(), // ProjectState — transitions via conditional UPDATE only
  workflowTemplate: text("workflow_template"), // 'research' only in Phase 1
  budgetUsd: numeric("budget_usd").notNull().default("5"),
  spentUsd: numeric("spent_usd").notNull().default("0"), // rolled up by the gateway
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
});

export const projectSpecs = pgTable("project_specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  version: integer("version").notNull(),
  spec: jsonb("spec").notNull(), // ProjectSpec JSON
  createdBy: text("created_by").notNull(), // 'system' | 'user_edit'
  ...timestamps,
});

export const phases = pgTable("phases", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  idx: integer("idx").notNull(),
  name: text("name").notNull(),
  phaseType: text("phase_type").notNull(),
  state: text("state").notNull(), // PhaseState
  input: jsonb("input"),
  outputSummary: text("output_summary"),
  modelUsed: text("model_used"),
  attempts: integer("attempts").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
});

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  phaseId: uuid("phase_id").references(() => phases.id),
  kind: text("kind").notNull(), // 'report' only in Phase 1
  filename: text("filename").notNull(),
  content: text("content"), // Phase 1: inline. Phase 3: null + storageKey (R2)
  storageKey: text("storage_key"), // unused until Phase 3
  version: integer("version").notNull(),
  digest: text("digest"),
  verification: jsonb("verification"),
  ...timestamps,
});

export const modelCalls = pgTable("model_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  phaseId: uuid("phase_id").references(() => phases.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  purpose: text("purpose"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadInputTokens: integer("cache_read_input_tokens"),
  cacheCreationInputTokens: integer("cache_creation_input_tokens"),
  costUsd: numeric("cost_usd").notNull(),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull(), // 'ok' | 'error'
  error: text("error"),
  ...timestamps,
});

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
