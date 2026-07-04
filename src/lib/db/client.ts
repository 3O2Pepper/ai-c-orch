/**
 * DB client + userId-scoped query helper (security invariant §9.4:
 * every query goes through the scoped helper, even with one user).
 *
 * Phase 1 has no auth, so getCurrentUserId() returns the seeded dev user.
 * When Clerk lands in Phase 4, only that function changes.
 */
import { neon } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/** Stable UUID for the single seeded dev user (see seed.ts). */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

let _db: NeonHttpDatabase<typeof schema> | undefined;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set (copy .env.example to .env.local)",
      );
    }
    _db = drizzle(neon(url), { schema });
  }
  return _db;
}

/** Lazy proxy so importing this module does not require DATABASE_URL at build time. */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export type Db = typeof db;

export async function getCurrentUserId(): Promise<string> {
  return DEV_USER_ID;
}

/**
 * All project reads/writes go through this scope so a user can only ever
 * touch their own rows. RLS replaces the app-layer check later.
 */
export function scopedProjects(userId: string) {
  const owned = (projectId: string) =>
    and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId));

  return {
    userId,

    async list() {
      return getDb()
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.userId, userId))
        .orderBy(sql`${schema.projects.createdAt} desc`);
    },

    async get(projectId: string) {
      const rows = await getDb()
        .select()
        .from(schema.projects)
        .where(owned(projectId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Ownership guard for child-table queries. Throws if not owned. */
    async assertOwned(projectId: string) {
      const project = await this.get(projectId);
      if (!project) {
        throw new ProjectNotFoundError(projectId);
      }
      return project;
    },

    /**
     * Optimistic-concurrency state transition (PLAN §4): conditional UPDATE
     * with a rows-affected check. Returns false when the row was not in the
     * expected state (someone else transitioned first).
     */
    async transitionState(
      projectId: string,
      expected: string,
      next: string,
    ): Promise<boolean> {
      const rows = await getDb()
        .update(schema.projects)
        .set({ state: next, updatedAt: new Date() })
        .where(and(owned(projectId), eq(schema.projects.state, expected)))
        .returning({ id: schema.projects.id });
      return rows.length === 1;
    },
  };
}

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

/** Same conditional-write pattern for phases.state. */
export async function transitionPhaseState(
  phaseId: string,
  expected: string,
  next: string,
  extra: Partial<{
    startedAt: Date;
    finishedAt: Date;
    outputSummary: string;
    modelUsed: string;
  }> = {},
): Promise<boolean> {
  const rows = await getDb()
    .update(schema.phases)
    .set({ state: next, updatedAt: new Date(), ...extra })
    .where(
      and(eq(schema.phases.id, phaseId), eq(schema.phases.state, expected)),
    )
    .returning({ id: schema.phases.id });
  return rows.length === 1;
}
