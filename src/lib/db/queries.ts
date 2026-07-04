import { asc, desc, eq, sql } from "drizzle-orm";
import type { ProjectSpec } from "@/lib/core/spec";
import { db, scopedProjects } from "@/lib/db/client";
import {
  artifacts,
  events,
  modelCalls,
  phases,
  projectSpecs,
  projects,
} from "@/lib/db/schema";

export interface ProjectListItem {
  id: string;
  title: string | null;
  state: string;
  spentUsd: string;
  createdAt: Date;
}

export interface ProjectDetail {
  project: NonNullable<Awaited<ReturnType<ReturnType<typeof scopedProjects>["get"]>>>;
  spec: ProjectSpec | null;
  phases: (typeof phases.$inferSelect)[];
  artifacts: (typeof artifacts.$inferSelect)[];
  events: (typeof events.$inferSelect)[];
  modelCalls: (typeof modelCalls.$inferSelect)[];
  totalCostFromCalls: number;
}

export async function listProjects(userId: string): Promise<ProjectListItem[]> {
  const rows = await scopedProjects(userId).list();
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    state: p.state,
    spentUsd: p.spentUsd ?? "0",
    createdAt: p.createdAt,
  }));
}

export async function getProjectDetail(
  userId: string,
  projectId: string,
): Promise<ProjectDetail | null> {
  const project = await scopedProjects(userId).get(projectId);
  if (!project) return null;

  const [specRows, phaseRows, artifactRows, eventRows, callRows] =
    await Promise.all([
      db
        .select()
        .from(projectSpecs)
        .where(eq(projectSpecs.projectId, projectId))
        .orderBy(desc(projectSpecs.version))
        .limit(1),
      db
        .select()
        .from(phases)
        .where(eq(phases.projectId, projectId))
        .orderBy(asc(phases.idx)),
      db
        .select()
        .from(artifacts)
        .where(eq(artifacts.projectId, projectId))
        .orderBy(desc(artifacts.version)),
      db
        .select()
        .from(events)
        .where(eq(events.projectId, projectId))
        .orderBy(asc(events.id)),
      db
        .select()
        .from(modelCalls)
        .where(eq(modelCalls.projectId, projectId))
        .orderBy(asc(modelCalls.createdAt)),
    ]);

  const totalCostFromCalls = callRows.reduce(
    (sum, c) => sum + parseFloat(c.costUsd ?? "0"),
    0,
  );

  return {
    project,
    spec: (specRows[0]?.spec as ProjectSpec) ?? null,
    phases: phaseRows,
    artifacts: artifactRows,
    events: eventRows,
    modelCalls: callRows,
    totalCostFromCalls,
  };
}

/** Consistency check: spent_usd should match sum(model_calls.cost_usd). */
export async function verifySpentConsistency(projectId: string): Promise<{
  spentUsd: number;
  sumCalls: number;
  ok: boolean;
}> {
  const [project] = await db
    .select({ spentUsd: projects.spentUsd })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const [agg] = await db
    .select({
      sum: sql<string>`coalesce(sum(${modelCalls.costUsd}::numeric), 0)`,
    })
    .from(modelCalls)
    .where(eq(modelCalls.projectId, projectId));

  const spentUsd = parseFloat(project?.spentUsd ?? "0");
  const sumCalls = parseFloat(agg?.sum ?? "0");
  const ok = Math.abs(spentUsd - sumCalls) < 0.000001;

  return { spentUsd, sumCalls, ok };
}
