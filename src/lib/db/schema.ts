import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// PLAN.md §4 schema. Phase 2 added approvals + messages (durable gates and
// the composer), then the hardening pass added event_outbox (reliable
// transition -> Inngest event publishing) and the replay-safety uniqueness
// rules. Phase 3 added model_routes (router config) and context_items
// (context service). Still [Later]: api_keys (P4).

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
  budgetUsd: numeric("budget_usd", { precision: 12, scale: 6 }).notNull().default("5"),
  // rolled up by the gateway; scale 6 = micro-dollar resolution, plenty for
  // per-token costs while keeping a defined rounding behavior
  spentUsd: numeric("spent_usd", { precision: 12, scale: 6 }).notNull().default("0"),
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
  // Structured phase result (e.g. the outline JSON). Persisted so a step
  // retry that finds the phase already 'done' can reuse the result instead
  // of paying for a second model call.
  output: jsonb("output"),
  outputSummary: text("output_summary"),
  modelUsed: text("model_used"),
  attempts: integer("attempts").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
});

export const artifacts = pgTable(
  "artifacts",
  {
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
  },
  (t) => [
    // Replay-safety: each phase produces at most one artifact, so a retried
    // step can detect "already written" and skip the insert + digest call.
    uniqueIndex("artifacts_phase_id_uq").on(t.phaseId),
  ],
);

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
  status: text("status").notNull(), // 'ok' | 'error'
  error: text("error"),
  ...timestamps,
});

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    phaseId: uuid("phase_id").references(() => phases.id),
    gate: text("gate").notNull(), // 'plan' | 'needs_input' | 'budget' | 'delivery'
    payload: jsonb("payload"), // what's being approved (question, budget figures, artifact ref)
    status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'expired'
    // When the gate self-resolves if nobody acts (null = waits indefinitely).
    // Informational for the UI; the authoritative timer is the workflow's
    // waitForEvent timeout.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    ...timestamps,
  },
  (t) => [
    index("approvals_project_status_idx").on(t.projectId, t.status),
    // Replay-safety: at most one open gate per (project, gate kind), so a
    // retried createApproval upserts instead of duplicating the gate.
    uniqueIndex("approvals_one_pending_per_gate_uq")
      .on(t.projectId, t.gate)
      .where(sql`status = 'pending'`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    role: text("role").notNull(), // 'user' | 'system'
    content: text("content").notNull(),
    linkedApprovalId: uuid("linked_approval_id").references(() => approvals.id),
    ...timestamps,
  },
  (t) => [
    index("messages_project_id_idx").on(t.projectId),
    index("messages_linked_approval_id_idx").on(t.linkedApprovalId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_project_id_idx").on(t.projectId)],
);

// Outbox for workflow events (P2 hardening). Routes write the state
// transition, record the event here, then attempt the send; a cron sweeper
// re-sends anything unsent, so a failed `inngest.send` can never strand a
// project in a state no workflow is listening to. dedupe_id doubles as the
// Inngest event idempotency id, so re-sends never double-deliver.
// Router config (P3). One row per phase type overrides the code-default
// registry in lib/core/routes.ts; a missing or invalid row falls back to
// the code default, so a bad config edit degrades instead of failing runs.
export const modelRoutes = pgTable("model_routes", {
  phaseType: text("phase_type").primaryKey(), // PhaseType
  model: text("model").notNull(), // ModelId — validated against the pricing registry on read
  effort: text("effort").notNull(), // Effort
  maxTokens: integer("max_tokens").notNull(),
  fallbackModel: text("fallback_model"), // tried once on overload-class errors
  webSearch: boolean("web_search").notNull().default(false),
  ...timestamps,
});

// Context service (P3): pinned spec/decisions, artifact digests, and the
// rolling summary that compacts old decisions. superseded_by versions items
// instead of deleting them — assembly reads only live (superseded_by IS
// NULL) rows, history stays auditable.
export const contextItems = pgTable(
  "context_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull(), // 'pinned_spec' | 'decision' | 'artifact_digest' | 'rolling_summary'
    content: text("content").notNull(),
    tokens: integer("tokens").notNull(), // chars/4 estimate at write time (see lib/services/context.ts)
    pinned: boolean("pinned").notNull().default(false),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => contextItems.id),
    source: text("source"), // provenance: phase/approval/artifact id
    ...timestamps,
  },
  (t) => [
    index("context_items_live_idx")
      .on(t.projectId, t.kind)
      .where(sql`superseded_by is null`),
  ],
);

export const eventOutbox = pgTable(
  "event_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    eventName: text("event_name").notNull(),
    dedupeId: text("dedupe_id").notNull(),
    payload: jsonb("payload").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index("event_outbox_unsent_idx").on(t.createdAt).where(sql`sent_at is null`)],
);
