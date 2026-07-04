"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

// Blocking gate cards (Phase 2). Exactly one renders at a time, driven by
// project state + the pending approval. Every resolution is one focused
// action — no per-phase confirmations, no "are you sure?".

interface GatePanelProps {
  projectId: string;
  state: "needs_input" | "paused" | "review";
  approvalPayload: Record<string, unknown> | null;
}

export function GatePanel({ projectId, state, approvalPayload }: GatePanelProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const payload = approvalPayload ?? {};

  return (
    <div className="space-y-3">
      {state === "needs_input" && (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardHeader>
            <CardTitle className="text-base">The run needs your input</CardTitle>
            <CardDescription>{String(payload.question ?? "")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Your answer…"
              rows={2}
              disabled={busy}
            />
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              onClick={() => post("answer", { answer: text })}
              disabled={busy || text.trim().length === 0}
            >
              Answer
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                post("answer", { answer: String(payload.recommended_default ?? "") })
              }
            >
              Use recommended default
              {payload.recommended_default
                ? `: ${String(payload.recommended_default).slice(0, 60)}`
                : ""}
            </Button>
          </CardFooter>
        </Card>
      )}

      {state === "paused" && (
        <Card className="border-orange-300 dark:border-orange-700">
          <CardHeader>
            <CardTitle className="text-base">Budget reached</CardTitle>
            <CardDescription>
              Spent ${Number(payload.spentUsd ?? 0).toFixed(2)} of the $
              {Number(payload.budgetUsd ?? 0).toFixed(2)} budget. Raise it to continue,
              or stop the run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              type="number"
              min="0"
              step="1"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`New budget in USD (> ${Number(payload.spentUsd ?? 0).toFixed(2)})`}
              disabled={busy}
              className="w-56 rounded-md border bg-transparent px-3 py-1.5 text-sm"
            />
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button
              onClick={() => post("budget", { action: "raise", newBudgetUsd: Number(text) })}
              disabled={busy || !text || Number.isNaN(Number(text))}
            >
              Raise budget
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => post("budget", { action: "stop" })}
            >
              Stop the run
            </Button>
          </CardFooter>
        </Card>
      )}

      {state === "review" && (
        <Card className="border-purple-300 dark:border-purple-700">
          <CardHeader>
            <CardTitle className="text-base">Ready for review</CardTitle>
            <CardDescription>
              Read the report below, then accept it — or describe the changes you want
              and it re-enters the loop as a scoped revision.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Request a revision… e.g. add a column for free-tier limits"
              rows={2}
              disabled={busy}
            />
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button onClick={() => post("review", { action: "accept" })} disabled={busy}>
              Accept &amp; finish
            </Button>
            <Button
              variant="outline"
              onClick={() => post("review", { action: "revise", instructions: text })}
              disabled={busy || text.trim().length === 0}
            >
              Request revision
            </Button>
          </CardFooter>
        </Card>
      )}

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
