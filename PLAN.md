# AI Project Router — Phase 1 Implementation Plan

> One-line positioning: "Type what you want. Get a finished project, not a conversation."
> This file is the in-repo source of truth for Phase 1. It supersedes the original planning
> document where they differ. Sections marked **[Later]** are reference for Phases 2–4 and
> must not be built in Phase 1.

---

## 0. Decisions applied from plan review (2026-07-02)

1. **One deployable.** No separate orchestrator worker. Inngest (Phase 2) serves its
   functions from a Next.js route handler. "Services" are modules under `src/lib/`.
2. **Phase 1 runs locally only** (`next dev`). The plain async workflow runner cannot
   survive serverless timeouts. First deploy happens in Phase 2, after Inngest owns
   long-running work.
3. **Deferred out of Phase 1:** auth (seed one user row; keep `user_id` columns
   everywhere), object storage (artifact content lives in a Postgres `text` column until
   Phase 3), BYO API keys (`ANTHROPIC_API_KEY` env var; `api_keys` table in Phase 4),
   SSE (2s polling on the project page), RLS (app-layer `user_id` scoping helper).
4. **Structured outputs are native, not retried.** Intake uses `client.messages.parse()`
   with a Zod schema (`zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`) — the API
   enforces the schema server-side. One retry for transport errors only; no
   schema-error-feedback loop.
5. **Optimistic concurrency on every state transition.** Transitions are conditional
   writes: `UPDATE projects SET state = $new WHERE id = $id AND state = $expected`,
   assert rows-affected = 1. Applies from the very first Approve button.
6. **Model table refreshed** (see §6). Sonnet 5 takes coding/spec routes; Opus 4.8 takes
   planning/synthesis/critique; Haiku 4.5 takes digests. Gateway exposes no sampling
   params (rejected with 400 on current models). Router gains a `revision` phase type.

---

## 1. Phase 1 scope — the vertical slice

**Goal:** messy text → structured spec → approved plan → one generated Research report
artifact → visible in UI with full cost/event trail.

In scope:
- Intake: one textarea → `ProjectSpec` (Zod-validated, structured outputs).
- Plan card: spec, assumptions, blocking questions rendered; **Approve** flips state.
- Hardcoded Research workflow (no tools, model-knowledge-only draft): spec → outline →
  draft → done. Plain async function triggered on approval.
- Versioned artifact (markdown report) stored in Postgres, rendered in UI.
- Event log (append-only `events` table) and per-project cost meter from `model_calls`.
- Dashboard listing projects with state chips.

**Exit test:** type a messy request, approve the plan, read the report in the browser,
and point at every model call and its cost in the DB.

Explicitly NOT in Phase 1: Inngest, needs_input gate, revision loop, budget gate,
web search, sandbox, xlsx/code templates, context service layers, router config file
(the runner hardcodes model choices), auth, deploy.

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript | as planned |
| UI | Tailwind + shadcn/ui | defaults; phase timeline / plan card / artifact preview are the only bespoke components |
| DB | Postgres on **Neon** | serverless, no local Docker needed on Windows |
| ORM | **Drizzle** | schema-first, types flow from schema, SQL-transparent migrations |
| LLM | `@anthropic-ai/sdk` (official) | structured outputs via `messages.parse`; multi-provider comes with the router in Phase 3 behind our own `generate()` seam |
| Tests | Vitest | unit tests on core domain (state machine, cost math) |
| Jobs [Later] | Inngest, served from a Next.js route handler | durable waits for gates, retries, resumability — Phase 2 |
| Storage [Later] | Cloudflare R2 | Phase 3, when xlsx/code artifacts arrive |
| Auth [Later] | Clerk | Phase 4, before external testers |
| Sandbox [Later] | E2B | Phase 3; generated code never runs in our process |

---

## 3. File structure

```
/PLAN.md
/drizzle/                     # generated migrations
/src
  /app
    /dashboard/page.tsx       # project list, state chips, cost-to-date
    /new/page.tsx             # textarea → plan card (client component)
    /project/[id]/page.tsx    # timeline | artifact preview | events + cost (2s polling)
    /api
      /projects/route.ts              # POST: intake (text → spec → rows)
      /projects/[id]/approve/route.ts # POST: gate 1 → transition → trigger runner
  /lib
    /core                     # PURE — zero Next/DB imports, unit-tested
      spec.ts                 #   ProjectSpec, WorkflowPlan, PhaseResult Zod schemas
      states.ts               #   project + phase state enums
      transitions.ts          #   transition(state, event) with exhaustive `never` checks
      pricing.ts              #   model capability/price registry (one source of truth)
    /db
      schema.ts               #   Drizzle schema (§4)
      client.ts               #   scoped query helper: every query takes userId
      seed.ts                 #   inserts the single dev user
    /gateway
      index.ts                #   generate() / generateObject() — the ONLY path to a model
      log.ts                  #   writes model_calls + rolls up projects.spent_usd (tx)
    /services
      intake.ts               #   raw text → ProjectSpec via messages.parse
      runner.ts               #   hardcoded Research workflow (plain async, Phase 1 only)
      events.ts               #   append-only event writer
    /prompts
      intake.ts, outline.ts, draft.ts   # versioned-in-git prompt templates
  /components
    plan-card.tsx, phase-timeline.tsx, artifact-preview.tsx, cost-meter.tsx, event-log.tsx
```

Rules:
- `lib/core` imports nothing from Next, Drizzle, or the SDK. It is the spec-as-code.
- All model calls go through `lib/gateway`. Metering cannot be bypassed because there is
  exactly one code path.
- Only `runner.ts` (later: the workflow engine) calls `transitions.ts` against the DB.
  The UI renders state; it never computes it.

---

## 4. Database schema (Phase 1 subset)

Timestamps (`created_at`, `updated_at`) on every table, implied below.

```sql
users(
  id uuid pk, email text unique, name text, settings jsonb
);
projects(
  id uuid pk, user_id uuid fk,
  title text,
  raw_request text not null,        -- original messy input, immutable
  state text not null,              -- §5 state machine value
  workflow_template text,           -- 'research' only in Phase 1
  budget_usd numeric default 5,
  spent_usd numeric not null default 0,   -- rolled up in gateway, transactionally
  archived_at timestamptz
);
project_specs(
  id uuid pk, project_id uuid fk, version int not null,
  spec jsonb not null,              -- goal, deliverables, constraints,
                                    -- success_criteria, assumptions[], blocking_questions[]
  created_by text not null          -- 'system' | 'user_edit'
);
phases(
  id uuid pk, project_id uuid fk,
  idx int not null, name text not null, phase_type text not null,
  state text not null,              -- pending|running|verifying|failed|done (subset in P1)
  input jsonb, output_summary text,
  model_used text, attempts int not null default 0,
  started_at timestamptz, finished_at timestamptz
);
artifacts(
  id uuid pk, project_id uuid fk, phase_id uuid fk,
  kind text not null,               -- 'report' only in Phase 1
  filename text not null,
  content text,                     -- Phase 1: inline. Phase 3: null + storage_key (R2)
  storage_key text,                 -- unused until Phase 3
  version int not null, digest text,
  verification jsonb
);
model_calls(
  id uuid pk, project_id uuid fk, phase_id uuid fk null,
  provider text not null, model text not null, purpose text,
  input_tokens int, output_tokens int,
  cache_read_input_tokens int, cache_creation_input_tokens int,
  cost_usd numeric not null, latency_ms int,
  status text not null, error text
);
events(
  id bigserial pk, project_id uuid fk,
  type text not null, payload jsonb
);
```

**[Later]** tables, added when their feature lands (do not create empty now):
`api_keys` (P4), `context_items` (P3 — pinned spec/decisions, digests, rolling summary,
`superseded_by` versioning), `approvals` (P2 — durable gates), `messages` (P2 — composer
and revision loop).

Concurrency: `projects.state` changes only via
`UPDATE … SET state=$next WHERE id=$id AND state=$expected` + rows-affected check.
Same pattern for `phases.state`.

---

## 5. State machines

Project (as built through Phase 2; `clarifying` remains [Later]):

```
draft → specifying → awaiting_plan_approval → running ⇄ needs_input
                                                 ⇅ paused (budget)
                                              running → review → done
                                                 review → running (revision, max 10)
failed / cancelled reachable from any active state
```

Phase: `pending → running → done`, with `running → failed`.
**[P4]** adds `verifying → fixing → verifying` (max 1 cycle).

Gate dwell times (P2 decision — deviates from the original "expire to paused"):
- `needs_input`: 7 days, then the run proceeds with the outline's
  `recommended_default`, recorded as a system message (assumption-first).
- `paused` (budget): 7 days, then the run is cancelled.
- `review`: waits indefinitely (re-armed per round, bounded by the revision cap).

Rules (enforced):
- Every transition writes an `events` row atomically with the state change
  (single-statement CTE — the neon-http driver has no transactions).
- Transitions live in one exhaustive-`switch` function in `lib/core/transitions.ts`;
  illegal transitions are compile errors (`never` check) and runtime errors.
- `failed` always carries a human-readable reason in the event payload.

---

## 6. Model registry (current as of 2026-07-02)

One source of truth: capability/pricing in `lib/core/pricing.ts`; the phase-type →
model mapping in `lib/core/routes.ts` (consumed by intake and the runner; becomes the
seed data for the Phase 3 router and Phase 4 plan-card estimates).

Phase 1 phase types are `spec_extraction`, `outline`, `draft`, `digest`.

| Route (phase_type) | Model | $/Mtok in/out | Notes |
|---|---|---|---|
| spec_extraction | `claude-sonnet-5` | 3 / 15 (intro 2 / 10 thru 2026-08-31) | structured outputs |
| outline | `claude-opus-4-8` | 5 / 25 | structured outputs, adaptive thinking |
| draft | `claude-opus-4-8` | 5 / 25 | streamed |
| digest | `claude-haiku-4-5` | 1 / 5 | no adaptive thinking/effort (pre-4.6 model) |
| planning **[P3]** | `claude-opus-4-8` | — | LLM-parameterized plans |
| research_gather **[P3]** | `claude-sonnet-5` | — | + web_search tool |
| implement_code / debug_fix / xlsx_build **[P3]** | `claude-sonnet-5` | — | + sandbox |
| critique **[P4]** | `claude-opus-4-8` | — | |
| revision **[P2]** | `claude-sonnet-5` | — | was missing from the original router table |

API constraints baked into the gateway:
- **No `temperature`/`top_p`/`top_k`** — rejected with 400 on Opus 4.8 / Sonnet 5. The
  `generate()` interface does not expose sampling params.
- Thinking is **adaptive** (`thinking: {type:"adaptive"}`); depth via
  `output_config: {effort: "low"|"medium"|"high"}`. Digests run at `low`.
- Structured outputs: `client.messages.parse()` + `zodOutputFormat(Schema)`; read
  `response.parsed_output`.
- Prompt caching is prefix-match with a ~2–4k-token minimum cacheable prefix — the
  Section-10 assembly order (stable spec/decisions first) is still right, but verify hits
  via `usage.cache_read_input_tokens`; log all four usage fields into `model_calls`.
- Stream any call that may exceed ~16k output tokens (draft phase): `messages.stream()`
  + `finalMessage()`.

---

## 7. Commit sequence (Phase 1)

1. **Scaffold** — `create-next-app` (TS, App Router, Tailwind), shadcn init, Drizzle +
   Neon connection, Vitest. This PLAN.md committed at repo root.
2. **Core domain** — `lib/core/`: Zod schemas (`ProjectSpec`, `WorkflowPlan`,
   `PhaseResult`), state enums, exhaustive transition function. Unit tests. No I/O.
3. **Schema + seed** — Drizzle schema (§4), first migration, seed script inserting the
   dev user. Scoped query helper in `db/client.ts`.
4. **Gateway** — `generate()`/`generateObject()` wrapping `@anthropic-ai/sdk`; price map
   from `pricing.ts`; every call logged to `model_calls` and rolled into
   `projects.spent_usd` in one transaction. Verified with a standalone script before any
   UI exists.
5. **Intake** — `POST /api/projects`: raw text → `messages.parse` → `projects` +
   `project_specs` + `events` rows. One transport retry.
6. **Plan card** — `/new`: textarea → submit → render spec, assumptions, questions,
   Approve/Cancel. Approve calls the conditional-update transition and returns 409 on a
   state race.
7. **Runner** — hardcoded Research workflow (outline → draft), writes `phases`,
   streams the draft, writes the `artifacts` row (content inline), appends events,
   transitions project to `review` → `done` (auto-done in P1; the review gate becomes
   real in P2).
8. **Project page** — `/project/[id]`: phase timeline, rendered markdown artifact
   (sanitized), event log, cost meter. 2s polling via router refresh.
9. **Dashboard** — project list, state chips, cost-to-date, New Project button.
10. **Hardening pass** — empty/error states, failed-run surfacing, `spent_usd` vs
    `sum(model_calls.cost_usd)` consistency check in a test.

---

## 8. Phase 2–4 map (unchanged intent, one-line each) [Later]

- **P2 — engine + gates (BUILT):** Inngest inside Next.js; full state machines with
  durable `waitForEvent`; `approvals` + `messages` tables; needs_input + delivery gates;
  revision loop (max 10 rounds); budget gate. Gate dwell: 7 days — needs_input expires
  to the recommended default; budget expiry cancels. Deploy remains a manual step
  (Vercel + Inngest Cloud) when wanted; local dev uses `npm run dev:inngest`.
- **P3 — router + tools + templates (BUILT):** `model_routes` config table (seeded
  from `lib/core/routes.ts`, fail-open validation, 60s cache) + one-shot model
  fallback on overload; web search (`research_gather` phase, per-search cost
  metered); E2B sandbox seam; Build + Analyze templates behind an Opus planner
  (hard-validated, capability-gated plans; planning is the run's first durable
  step); `context_items` service (pinned spec/decisions, digests, rolling summary
  with `superseded_by`, chars/4 token budgets); R2 artifact storage seam
  (inline-Postgres fallback for text); artifact versioning UI + download route;
  kind-aware revisions. Deviations: E2B and R2 are env-gated and UNVERIFIED
  against live services (no credentials yet) — without them, code artifacts ship
  unverified (recorded as a system message) and Analyze degrades to a markdown
  report; the planner never emits phases the environment can't run. Research
  keeps its fixed plan (P2 stability); planner-driven research is deferred.
- **P4 — verify + harden:** per-kind verification with one fix cycle; sandboxed iframe
  previews + sanitization; secret redaction on intake; SSRF guards on fetch tools;
  Clerk auth + `api_keys` (encrypted); per-user daily caps; cost estimates on plan cards;
  5-user test.

Deliberately after v1: auto-approval policies, embeddings retrieval, custom workflows,
integrations, billing.

---

## 9. Security invariants that survive every phase

- Provider keys never enter any prompt-assembly path (env → gateway only).
- Generated code never executes in our process — sandbox only (P3+).
- Model-generated markdown/HTML is sanitized; HTML previews render only in a sandboxed
  iframe (P4 formalizes; P1 sanitizes markdown).
- Every DB query goes through the `userId`-scoped helper, even while there is one user.
- All tool output is data, not instructions (delimited, framed) once tools exist (P3+).
