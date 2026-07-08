import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { ProjectSpec } from "@/lib/core/spec";
import { getDb } from "@/lib/db/client";
import { contextItems } from "@/lib/db/schema";
import { generateText } from "@/lib/gateway";
import { resolveRoute } from "./router";

// Context service (P3, PLAN §8): the project's working memory. Pinned
// items (spec, decisions) always survive; artifact digests and the rolling
// summary fill the remaining token budget. superseded_by versions items
// instead of deleting, so assembly reads only live rows and history stays
// auditable.
//
// Token counts are a chars/4 estimate, not the count-tokens API — assembly
// runs on every phase prompt and must not cost a network round-trip. The
// estimate over-counts prose slightly (safe direction: budgets bind early).

export type ContextKind =
  | "pinned_spec"
  | "decision"
  | "artifact_digest"
  | "rolling_summary";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Default assembly budget for phase prompts. */
export const CONTEXT_BUDGET_TOKENS = 8000;

type ContextItemRow = typeof contextItems.$inferSelect;

async function liveItems(projectId: string, kind?: ContextKind) {
  const db = getDb();
  const where = kind
    ? and(
        eq(contextItems.projectId, projectId),
        isNull(contextItems.supersededBy),
        eq(contextItems.kind, kind),
      )
    : and(eq(contextItems.projectId, projectId), isNull(contextItems.supersededBy));
  return db
    .select()
    .from(contextItems)
    .where(where)
    .orderBy(asc(contextItems.createdAt), asc(contextItems.id));
}

async function insertItem(
  projectId: string,
  kind: ContextKind,
  content: string,
  opts?: { pinned?: boolean; source?: string; supersedeIds?: string[] },
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(contextItems)
    .values({
      projectId,
      kind,
      content,
      tokens: estimateTokens(content),
      pinned: opts?.pinned ?? false,
      source: opts?.source ?? null,
    })
    .returning({ id: contextItems.id });
  if (opts?.supersedeIds && opts.supersedeIds.length > 0) {
    await db
      .update(contextItems)
      .set({ supersededBy: row.id })
      .where(inArray(contextItems.id, opts.supersedeIds));
  }
  return row.id;
}

/**
 * Pin the project spec. Supersedes any previously pinned spec (spec edits
 * create a new version rather than mutating). Idempotent for identical
 * content — a replayed call becomes a no-op.
 */
export async function pinSpec(
  projectId: string,
  spec: ProjectSpec,
  specVersion: number,
): Promise<void> {
  const content = JSON.stringify(spec, null, 2);
  const existing = await liveItems(projectId, "pinned_spec");
  if (existing.some((i) => i.content === content)) return; // replay no-op
  await insertItem(projectId, "pinned_spec", content, {
    pinned: true,
    source: `spec:v${specVersion}`,
    supersedeIds: existing.map((i) => i.id),
  });
}

/** Record a standing decision (gate answers, applied defaults). */
export async function recordDecision(
  projectId: string,
  content: string,
  source: string,
): Promise<void> {
  // Replay-safety: one decision per source (approval id).
  const existing = await liveItems(projectId, "decision");
  if (existing.some((i) => i.source === source)) return;
  await insertItem(projectId, "decision", content, { pinned: true, source });
}

/**
 * Record an artifact digest, superseding digests of earlier versions —
 * only the newest artifact's digest is live context.
 */
export async function recordArtifactDigest(
  projectId: string,
  artifactId: string,
  digest: string,
): Promise<void> {
  const existing = await liveItems(projectId, "artifact_digest");
  if (existing.some((i) => i.source === `artifact:${artifactId}`)) return;
  await insertItem(projectId, "artifact_digest", digest, {
    source: `artifact:${artifactId}`,
    supersedeIds: existing.map((i) => i.id),
  });
}

// Rolling summary: when decisions accumulate, compact the oldest into one
// summary item (keeping the most recent KEEP_RECENT verbatim) so assembly
// stays within budget on long-running projects.
const ROLLUP_THRESHOLD = 8;
const KEEP_RECENT = 4;

export async function maybeRollUpDecisions(projectId: string): Promise<boolean> {
  const decisions = await liveItems(projectId, "decision");
  if (decisions.length <= ROLLUP_THRESHOLD) return false;

  const toRoll = decisions.slice(0, decisions.length - KEEP_RECENT);
  const [previousSummary] = await liveItems(projectId, "rolling_summary");

  const route = await resolveRoute("digest");
  const summary = await generateText({
    projectId,
    purpose: "context_rollup",
    model: route.model,
    system:
      "Merge the prior summary (if any) and the listed decisions into one " +
      "compact summary of standing project decisions. Preserve every " +
      "decision's substance; drop the discussion. No preamble.",
    prompt: [
      ...(previousSummary ? [`Prior summary:\n${previousSummary.content}`] : []),
      `Decisions:\n${toRoll.map((d) => `- ${d.content}`).join("\n")}`,
    ].join("\n\n"),
    maxTokens: route.maxTokens,
    effort: route.effort,
    fallbackModel: route.fallbackModel,
  });

  await insertItem(projectId, "rolling_summary", summary.text.trim(), {
    source: `rollup:${toRoll.length}`,
    supersedeIds: [
      ...toRoll.map((d) => d.id),
      ...(previousSummary ? [previousSummary.id] : []),
    ],
  });
  return true;
}

/**
 * Assemble the prompt context block. Pinned items (spec, decisions) are
 * always included; the rolling summary and artifact digests fill whatever
 * budget remains, newest first. Cache-friendly order: most stable first.
 */
export async function assembleContext(
  projectId: string,
  budgetTokens: number,
): Promise<string> {
  const items = await liveItems(projectId);
  const byKind = (k: ContextKind) => items.filter((i) => i.kind === k);

  const sections: string[] = [];
  let spent = 0;

  const spec = byKind("pinned_spec");
  for (const s of spec) {
    sections.push(`Project spec:\n${s.content}`);
    spent += s.tokens;
  }

  const summary = byKind("rolling_summary");
  for (const s of summary) {
    if (spent + s.tokens > budgetTokens) break;
    sections.push(`Earlier decisions (summarized):\n${s.content}`);
    spent += s.tokens;
  }

  const decisions = byKind("decision");
  if (decisions.length > 0) {
    const lines: string[] = [];
    for (const d of decisions) {
      // pinned: include even at budget, decisions are load-bearing
      lines.push(`- ${d.content}`);
      spent += d.tokens;
    }
    sections.push(`Recorded decisions (honor these):\n${lines.join("\n")}`);
  }

  const digests = byKind("artifact_digest").reverse(); // newest first
  for (const d of digests) {
    if (spent + d.tokens > budgetTokens) break;
    sections.push(`Current artifact digest:\n${d.content}`);
    spent += d.tokens;
  }

  return sections.join("\n\n");
}
