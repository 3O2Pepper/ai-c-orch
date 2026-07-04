import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const STATE_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  specifying: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  awaiting_plan_approval:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  running: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  review: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200",
  done: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function StateChip({
  state,
  className,
}: {
  state: string;
  className?: string;
}) {
  const label = state.replace(/_/g, " ");
  return (
    <Badge
      variant="secondary"
      className={cn("capitalize font-normal", STATE_STYLES[state], className)}
    >
      {label}
    </Badge>
  );
}

export function formatUsd(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "$0.00";
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
