import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/components/approval-panel";
import { ArtifactPreview } from "@/components/artifact-preview";
import { AutoRefresh } from "@/components/auto-refresh";
import { CostMeter } from "@/components/cost-meter";
import { EventLog } from "@/components/event-log";
import { PhaseTimeline } from "@/components/phase-timeline";
import { StateBadge } from "@/components/state-badge";
import { ProjectSpecSchema } from "@/lib/core/spec";
import { isTerminal, type ProjectState } from "@/lib/core/states";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getDevUserId();
  const q = forUser(userId);

  const project = await q.getProject(id);
  if (!project) notFound();

  const [phases, artifacts, events] = await Promise.all([
    q.listPhases(id),
    q.listArtifacts(id),
    q.listEvents(id),
  ]);
  const latestArtifact = artifacts[0] ?? null;
  const state = project.state as ProjectState;

  let pendingSpec = null;
  if (state === "awaiting_plan_approval") {
    const specRow = await q.getLatestSpec(id);
    const parsed = specRow ? ProjectSpecSchema.safeParse(specRow.spec) : null;
    pendingSpec = parsed?.success ? parsed.data : null;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <AutoRefresh active={!isTerminal(state)} />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold">{project.title ?? "Untitled project"}</h1>
          <StateBadge state={state} />
        </div>
        <CostMeter
          spentUsd={Number(project.spentUsd)}
          budgetUsd={Number(project.budgetUsd)}
        />
      </header>

      {pendingSpec && <ApprovalPanel projectId={project.id} spec={pendingSpec} />}

      {state === "failed" && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          This run failed — see the event log for the reason. Re-planning arrives in
          Phase 2.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr_280px]">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Phases
          </h2>
          <PhaseTimeline phases={phases} />
        </section>

        <section className="min-w-0 rounded-lg border p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Artifact
          </h2>
          <ArtifactPreview artifact={latestArtifact} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Event log
          </h2>
          <EventLog events={events} />
        </section>
      </div>
    </main>
  );
}
