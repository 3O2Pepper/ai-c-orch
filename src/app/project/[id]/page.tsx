import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserId } from "@/lib/db/client";
import { getProjectDetail } from "@/lib/db/queries";
import { ArtifactPreview } from "@/components/artifact-preview";
import { CostMeter } from "@/components/cost-meter";
import { EventLog } from "@/components/event-log";
import { PhaseTimeline } from "@/components/phase-timeline";
import { PollingRefresh } from "@/components/polling-refresh";
import { StateChip } from "@/components/state-chip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  const detail = await getProjectDetail(userId, id);

  if (!detail) notFound();

  const { project, spec, phases, artifacts, events, modelCalls } = detail;
  const report = artifacts.find((a) => a.kind === "report");
  const isActive = !["done", "failed", "cancelled"].includes(project.state);
  const failedEvent = events.find((e) => e.type === "project.failed");

  return (
    <PollingRefresh active={isActive}>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {project.title ?? "Untitled project"}
              </h1>
              <StateChip state={project.state} />
            </div>
            {spec && (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {spec.goal}
              </p>
            )}
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>

        {project.state === "failed" && (
          <Alert variant="destructive">
            <AlertTitle>Project failed</AlertTitle>
            <AlertDescription>
              {(failedEvent?.payload as { reason?: string } | null)?.reason ??
                "The workflow encountered an error. Check the event log for details."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section>
              <h2 className="mb-3 text-sm font-medium">Phases</h2>
              <PhaseTimeline phases={phases} />
            </section>

            <ArtifactPreview
              filename={report?.filename ?? "report.md"}
              content={report?.content ?? null}
            />
          </div>

          <div className="space-y-6">
            <CostMeter spentUsd={project.spentUsd ?? "0"} modelCalls={modelCalls} />
            <EventLog events={events} />
          </div>
        </div>
      </main>
    </PollingRefresh>
  );
}
