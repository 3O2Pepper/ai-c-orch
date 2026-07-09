import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/components/approval-panel";
import { ArtifactPreview } from "@/components/artifact-preview";
import { ArtifactVersionPicker } from "@/components/artifact-version-picker";
import { AutoRefresh } from "@/components/auto-refresh";
import { CostMeter } from "@/components/cost-meter";
import { EventLog } from "@/components/event-log";
import { GatePanel } from "@/components/gate-panel";
import { ModelCallsTable } from "@/components/model-calls-table";
import { PhaseTimeline } from "@/components/phase-timeline";
import { StateBadge } from "@/components/state-badge";
import { ProjectSpecSchema } from "@/lib/core/spec";
import { isTerminal, type ProjectState } from "@/lib/core/states";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { isBinaryFilename, loadArtifactText } from "@/lib/services/artifacts";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const userId = await getDevUserId();
  const q = forUser(userId);

  const project = await q.getProject(id);
  if (!project) notFound();

  const [phases, artifacts, events, modelCalls, messages, pendingApproval] =
    await Promise.all([
      q.listPhases(id),
      q.listArtifacts(id),
      q.listEvents(id),
      q.listModelCalls(id),
      q.listMessages(id),
      q.getPendingApproval(id),
    ]);
  // Artifact versioning UI (P3): ?v= selects a version, newest by default.
  const requestedVersion = Number(v);
  const selectedArtifact =
    artifacts.find((a) => a.version === requestedVersion) ?? artifacts[0] ?? null;
  // Content may live in object storage (P3) — resolve through the seam.
  const selectedArtifactContent = selectedArtifact
    ? await loadArtifactText(selectedArtifact)
    : null;
  const state = project.state as ProjectState;
  const gateState =
    state === "needs_input" || state === "paused" || state === "review"
      ? state
      : null;

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

      {gateState && (
        <GatePanel
          projectId={project.id}
          state={gateState}
          approvalPayload={
            (pendingApproval?.payload as Record<string, unknown> | null) ?? null
          }
          expiresAt={pendingApproval?.expiresAt?.toISOString() ?? null}
        />
      )}

      {state === "failed" && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          This run failed — see the event log for the reason. Re-planning arrives in
          Phase 3.
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Artifact
            </h2>
            <ArtifactVersionPicker
              projectId={project.id}
              versions={artifacts.map((a) => a.version).sort((a, b) => a - b)}
              selected={selectedArtifact?.version ?? 0}
            />
          </div>
          <ArtifactPreview
            artifact={
              selectedArtifact
                ? {
                    ...selectedArtifact,
                    content: selectedArtifactContent,
                    isBinary: isBinaryFilename(selectedArtifact.filename),
                    downloadHref: `/api/projects/${project.id}/artifacts/${selectedArtifact.id}`,
                  }
                : null
            }
          />
        </section>

        <section className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Event log
            </h2>
            <EventLog events={events} />
          </div>
          {messages.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Decisions &amp; messages
              </h2>
              <ol className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id} className="text-xs">
                    <span className="font-medium">
                      {m.role === "user" ? "You" : "System"}:
                    </span>{" "}
                    {m.content}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Model calls
        </h2>
        <ModelCallsTable calls={modelCalls} />
      </section>
    </main>
  );
}
