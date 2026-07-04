/**
 * Drizzle schema — Phase 1 subset (PLAN §4).
 * [Later] tables (api_keys, context_items, approvals, messages) are added
 * when their feature lands; do not create them empty now.
 */
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

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
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
  /** Original messy input, immutable. */
  rawRequest: text("raw_request").notNull(),
  /** §5 state machine value. */
  state: text("state").notNull(),
  /** 'research' only in Phase 1. */
  workflowTemplate: text("workflow_template"),
  budgetUsd: numeric("budget_usd", { precision: 12, scale: 6 }).default("5"),
  /** Rolled up in the gateway, transactionally, from model_calls. */
  spentUsd: numeric("spent_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
});

export const projectSpecs = pgTable("project_specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  version: integer("version").notNull(),
  /** goal, deliverables, constraints, success_criteria, assumptions[], blocking_questions[] */
  spec: jsonb("spec").notNull(),
  /** 'system' | 'user_edit' */
  createdBy: text("created_by").notNull(),
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
  /** pending|running|verifying|failed|done (subset in P1). */
  state: text("state").notNull(),
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
  /** 'report' only in Phase 1. */
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  /** Phase 1: inline. Phase 3: null + storage_key (R2). */
  content: text("content"),
  /** Unused until Phase 3. */
  storageKey: text("storage_key"),
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
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull(),
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
  ...timestamps,
});
