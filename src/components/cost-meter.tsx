import { formatUsd } from "@/components/state-chip";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ModelCall {
  id: string;
  model: string;
  purpose: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string;
  status: string;
  latencyMs: number | null;
}

export function CostMeter({
  spentUsd,
  modelCalls,
}: {
  spentUsd: string;
  modelCalls: ModelCall[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cost</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-2xl font-semibold">{formatUsd(spentUsd)}</p>
          <p className="text-sm text-muted-foreground">Spent on this project</p>
        </div>

        {modelCalls.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Model calls</p>
            <ul className="divide-y rounded-md border text-sm">
              {modelCalls.map((call) => (
                <li key={call.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{call.purpose ?? call.model}</span>
                    <span>{formatUsd(call.costUsd)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {call.model} · {call.inputTokens ?? 0} in / {call.outputTokens ?? 0}{" "}
                    out
                    {call.latencyMs != null ? ` · ${call.latencyMs}ms` : ""}
                    {call.status === "error" ? " · failed" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No model calls yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
