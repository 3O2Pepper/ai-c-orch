import Link from "next/link";
import { getCurrentUserId } from "@/lib/db/client";
import { listProjects } from "@/lib/db/queries";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatUsd, StateChip } from "@/components/state-chip";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = await getCurrentUserId();
  const projects = await listProjects(userId);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your projects and spend to date.
          </p>
        </div>
        <Button asChild>
          <Link href="/new">New project</Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              Describe what you want and the router will extract a plan, run
              research, and deliver a report.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/new">Create your first project</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-lg border">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/project/${project.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {project.title ?? "Untitled project"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {project.createdAt.toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {formatUsd(project.spentUsd)}
                  </span>
                  <StateChip state={project.state} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
