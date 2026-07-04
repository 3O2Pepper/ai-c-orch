import { cn } from "@/lib/utils";
import type { PhaseState } from "@/lib/core/states";

export interface TimelinePhase {
  id: string;
  idx: number;
  name: string;
  state: string;
  outputSummary: string | null;
  modelUsed: string | null;
}

const DOT: Record<PhaseState, string> = {
  pending: "bg-muted-foreground/30",
  running: "bg-blue-500 animate-pulse",
  done: "bg-green-500",
  failed: "bg-red-500",
};

export function PhaseTimeline({ phases }: { phases: TimelinePhase[] }) {
  if (phases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Phases appear here once the run starts.
      </p>
    );
  }
  return (
    <ol className="space-y-4">
      {phases.map((phase) => (
        <li key={phase.id} className="flex gap-3">
          <span
            className={cn(
              "mt-1 h-3 w-3 shrink-0 rounded-full",
              DOT[phase.state as PhaseState] ?? "bg-muted-foreground/30",
            )}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {phase.idx + 1}. {phase.name}
              {phase.modelUsed && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {phase.modelUsed}
                </span>
              )}
            </p>
            {phase.outputSummary && (
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                {phase.outputSummary}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
