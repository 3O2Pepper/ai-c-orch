import Link from "next/link";
import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import type { ProjectState } from "@/lib/core/states";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await getDevUserId();
  const projects = await forUser(userId).listProjects();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Button render={<Link href="/new" />}>New Project</Button>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            No projects yet. Describe what you want and get a finished project, not a
            conversation.
          </p>
          <Button render={<Link href="/new" />} className="mt-4">
            Create your first project
          </Button>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/project/${project.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {project.title ?? "Untitled project"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {project.rawRequest}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    ${Number(project.spentUsd).toFixed(3)}
                  </span>
                  <StateBadge state={project.state as ProjectState} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
