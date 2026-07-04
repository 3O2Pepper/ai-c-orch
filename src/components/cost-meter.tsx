import { cn } from "@/lib/utils";

export function CostMeter({
  spentUsd,
  budgetUsd,
}: {
  spentUsd: number;
  budgetUsd: number;
}) {
  const ratio = budgetUsd > 0 ? Math.min(spentUsd / budgetUsd, 1) : 0;
  return (
    <div className="w-44">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">Cost</span>
        <span className="font-mono">
          ${spentUsd.toFixed(3)} / ${budgetUsd.toFixed(2)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className={cn(
            "h-1.5 rounded-full",
            ratio < 0.7 ? "bg-green-500" : ratio < 0.95 ? "bg-amber-500" : "bg-red-500",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
