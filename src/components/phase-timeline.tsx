import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Phase {
  id: string;
  idx: number;
  name: string;
  state: string;
  outputSummary: string | null;
}

const PHASE_STATE_LABEL: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

export function PhaseTimeline({ phases }: { phases: Phase[] }) {
  if (phases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No phases yet.</p>
    );
  }

  return (
    <ol className="space-y-3">
      {phases.map((phase) => (
        <li
          key={phase.id}
          className="flex items-start gap-3 rounded-lg border p-3"
        >
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
              phase.state === "done" && "bg-green-100 text-green-800",
              phase.state === "running" && "bg-violet-100 text-violet-800",
              phase.state === "failed" && "bg-destructive/15 text-destructive",
              phase.state === "pending" && "bg-muted text-muted-foreground",
            )}
          >
            {phase.idx + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{phase.name}</span>
              <Badge variant="outline" className="font-normal">
                {PHASE_STATE_LABEL[phase.state] ?? phase.state}
              </Badge>
            </div>
            {phase.outputSummary && (
              <p className="mt-1 text-sm text-muted-foreground">
                {phase.outputSummary}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
