# AI Project Router

"Type what you want. Get a finished project, not a conversation."

Phase 1 vertical slice: messy text → structured spec → approved plan → generated
research report, with a full cost and event trail. See [PLAN.md](./PLAN.md) for
scope and architecture.

## Setup

1. Copy the env template and fill it in:

   ```sh
   cp .env.example .env.local
   ```

   - `DATABASE_URL` — a Neon Postgres connection string (free tier is fine)
   - `ANTHROPIC_API_KEY` — an Anthropic API key

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

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server (still local-only — no deploy yet) |
| `npm run dev:inngest` | Inngest dev server (required for runs; dashboard at :8288) |
| `npm test` | Unit tests (+ a DB-backed metering test when `DATABASE_URL` is set) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Regenerate migrations from `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Insert the single dev user |
| `npm run check:gateway` | One cheap Haiku call through the gateway; asserts metering consistency |
