import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { artifacts, events, modelCalls, phases, projects, projectSpecs } from "./schema";

// Every read goes through here and is scoped by userId — the tenant-isolation
// seam PLAN.md §9 requires even while there is a single user. Project-child
// reads verify project ownership first.

export function forUser(userId: string) {
  const db = getDb();

  async function requireProject(projectId: string) {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    return project ?? null;
  }

  return {
    db,

    listProjects() {
      return db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(desc(projects.createdAt));
    },

    getProject: requireProject,

    async getLatestSpec(projectId: string) {
      if (!(await requireProject(projectId))) return null;
      const [spec] = await db
        .select()
        .from(projectSpecs)
        .where(eq(projectSpecs.projectId, projectId))
        .orderBy(desc(projectSpecs.version))
        .limit(1);
      return spec ?? null;
    },

    async listPhases(projectId: string) {
      if (!(await requireProject(projectId))) return [];
      return db
        .select()
        .from(phases)
        .where(eq(phases.projectId, projectId))
        .orderBy(asc(phases.idx));
    },

    async listArtifacts(projectId: string) {
      if (!(await requireProject(projectId))) return [];
      return db
        .select()
        .from(artifacts)
        .where(eq(artifacts.projectId, projectId))
        .orderBy(desc(artifacts.version));
    },

    async listEvents(projectId: string) {
      if (!(await requireProject(projectId))) return [];
      return db
        .select()
        .from(events)
        .where(eq(events.projectId, projectId))
        .orderBy(asc(events.id));
    },

    async listModelCalls(projectId: string) {
      if (!(await requireProject(projectId))) return [];
      return db
        .select()
        .from(modelCalls)
        .where(eq(modelCalls.projectId, projectId))
        .orderBy(asc(modelCalls.createdAt));
    },
  };
}
