# AI Project Router

"Type what you want. Get a finished project, not a conversation."

Messy text → structured spec → approved plan → a finished deliverable, with a
full cost and event trail. Phase 3 added the model router, web search, the
Build (code) and Analyze (spreadsheet) templates behind an LLM planner, the
context service, and artifact versioning. See [PLAN.md](./PLAN.md) for scope
and architecture.

## Setup

1. Copy the env template and fill it in:

   ```sh
   cp .env.example .env.local
   ```

   Required:

   - `DATABASE_URL` — a Neon Postgres connection string (free tier is fine)
   - `ANTHROPIC_API_KEY` — an Anthropic API key

   Optional (Phase 3 capability gates — features degrade cleanly without
   them and the degradation is recorded as a system message on the project):

   - `E2B_API_KEY` — E2B sandbox. Without it, generated code is **not
     executed** (artifacts are delivered unverified) and xlsx builds are
     unavailable. Code NEVER runs in the app process either way.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
     `R2_BUCKET` — Cloudflare R2 object storage. Without it, text artifact
     content stays inline in Postgres (fine for reports/code); binary
     artifacts (xlsx) are unavailable.

   Both integrations are verified against the live services (`npm run
   check:storage`, `npm run check:sandbox`, plus end-to-end Build and
   Analyze runs).

2. Apply the schema and seed the dev user:

   ```sh
   npm run db:migrate
   npm run db:seed
   ```

3. (Optional) verify the model gateway + metering end to end:

   ```sh
   npm run check:gateway
   ```

4. Run it — **two processes** (the durable workflow engine needs the Inngest
   dev server):

   ```sh
   # terminal 1
   npm run dev:inngest

   # terminal 2
   npm run dev
   ```

   Open http://localhost:3000 → New Project → type a messy request → approve the
   plan → watch the run → answer questions if asked → review, revise, accept.
   The Inngest dashboard (http://localhost:8288) shows the durable run, its
   steps, and any gates it is waiting on.

   Reliability notes (P2 hardening): gate resolutions are written to the
   database first and published to Inngest through an outbox (`event_outbox`),
   with a once-a-minute sweeper re-sending anything undelivered — so resolving
   a gate while the Inngest dev server is down delays the run by at most a
   minute after it returns, and never strands it. Every gate timeout re-checks
   the approvals table before acting, so the recorded decision always wins
   over "no event arrived".

## Phase 3 in one paragraph

Intake maps the primary deliverable to a template: **report → research**
(gather sources via web search → outline → draft), **code → build**,
**spreadsheet → analyze**. Build/Analyze plans are produced by an Opus
planner and hard-validated (allowed phase types per template, capability
gating, exactly one artifact phase). Model choices live in the
`model_routes` table (seeded from `src/lib/core/routes.ts`; invalid rows
fail open to code defaults) with a one-shot fallback model on overload
errors. Every run maintains `context_items` — pinned spec, recorded gate
decisions, artifact digests, and a rolling summary — assembled under a
token budget into revision/template prompts. Artifacts are versioned; the
project page has a version picker and a download route, and revisions are
kind-aware (reports re-draft, code gets a full-file revision, spreadsheets
rebuild).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server (still local-only — no deploy yet) |
| `npm run dev:inngest` | Inngest dev server (required for runs; dashboard at :8288) |
| `npm test` | Unit tests (+ a DB-backed metering test when `DATABASE_URL` is set) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Regenerate migrations from `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Insert the dev user + seed `model_routes` from the code registry |
| `npm run check:gateway` | One cheap Haiku call through the gateway; asserts metering consistency |
| `npm run check:storage` | R2 round-trip (put/get/delete) through the storage seam |
| `npm run check:sandbox` | E2B python run + output-file collection through the sandbox seam |
