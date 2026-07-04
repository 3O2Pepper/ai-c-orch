export interface LogEvent {
  id: number;
  type: string;
  payload: unknown;
  createdAt: Date;
}

function describe(event: LogEvent): string {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "project_created":
      return "Project created";
    case "state_transition":
      return `State: ${p.from} → ${p.to}${p.reason ? ` (${p.reason})` : ""}`;
    case "phase_transition":
      return `Phase ${p.from} → ${p.to}${p.reason ? ` (${p.reason})` : ""}`;
    case "spec_extracted":
      return `Spec extracted — ${p.assumptions ?? 0} assumptions, ${p.blockingQuestions ?? 0} open questions`;
    case "artifact_created":
      return `Artifact ${p.filename} v${p.version} created ($${Number(p.costUsd ?? 0).toFixed(3)})`;
    case "auto_accepted":
      return "Delivery auto-accepted (review gate arrives in Phase 2)";
    default:
      return event.type;
  }
}

export function EventLog({ events }: { events: LogEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="text-xs">
          <span className="text-muted-foreground">
            {event.createdAt.toLocaleTimeString()}
          </span>{" "}
          {describe(event)}
        </li>
      ))}
    </ol>
  );
}
