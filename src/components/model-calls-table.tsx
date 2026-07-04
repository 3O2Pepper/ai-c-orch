export interface ModelCallRow {
  id: string;
  purpose: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  latencyMs: number | null;
  status: string;
  costUsd: string;
}

function tokens(n: number | null): string {
  return n == null ? "—" : n.toLocaleString();
}

/** Per-call metering detail — the receipts behind the aggregate cost meter. */
export function ModelCallsTable({ calls }: { calls: ModelCallRow[] }) {
  if (calls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Model calls appear here as the project runs.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            <th className="p-2 font-medium">Purpose</th>
            <th className="p-2 font-medium">Model</th>
            <th className="p-2 text-right font-medium">In</th>
            <th className="p-2 text-right font-medium">Out</th>
            <th className="p-2 text-right font-medium">Cache r/w</th>
            <th className="p-2 text-right font-medium">Latency</th>
            <th className="p-2 font-medium">Status</th>
            <th className="p-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.id} className="border-b last:border-0">
              <td className="p-2">{call.purpose ?? "—"}</td>
              <td className="p-2 font-mono">{call.model}</td>
              <td className="p-2 text-right font-mono">{tokens(call.inputTokens)}</td>
              <td className="p-2 text-right font-mono">{tokens(call.outputTokens)}</td>
              <td className="p-2 text-right font-mono">
                {tokens(call.cacheReadInputTokens)} / {tokens(call.cacheCreationInputTokens)}
              </td>
              <td className="p-2 text-right font-mono">
                {call.latencyMs == null ? "—" : `${(call.latencyMs / 1000).toFixed(1)}s`}
              </td>
              <td className="p-2">
                <span className={call.status === "ok" ? "text-green-600" : "text-red-600"}>
                  {call.status}
                </span>
              </td>
              <td className="p-2 text-right font-mono">
                ${Number(call.costUsd).toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
