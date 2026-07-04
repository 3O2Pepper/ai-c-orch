import { Badge } from "@/components/ui/badge";
import type { ProjectState } from "@/lib/core/states";

const STYLES: Record<ProjectState, string> = {
  draft: "bg-muted text-muted-foreground",
  specifying: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  awaiting_plan_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  review: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  done: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-muted text-muted-foreground",
};

const LABELS: Record<ProjectState, string> = {
  draft: "Draft",
  specifying: "Specifying",
  awaiting_plan_approval: "Needs approval",
  running: "Running",
  review: "Review",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function StateBadge({ state }: { state: ProjectState }) {
  return <Badge className={STYLES[state]}>{LABELS[state]}</Badge>;
}
