"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlanCard } from "@/components/plan-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectSpec } from "@/lib/core/spec";

type Stage =
  | { kind: "compose" }
  | { kind: "planned"; projectId: string; spec: ProjectSpec };

export default function NewProjectPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "compose" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStage({ kind: "planned", projectId: data.projectId, spec: data.spec });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function act(projectId: string, action: "approve" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(action === "approve" ? `/project/${projectId}` : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">New project</h1>

      {stage.kind === "compose" && (
        <div className="space-y-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe what you want — one messy paragraph is fine. Example: I need a comparison of the top 5 CRM tools for a 10-person sales team, with pricing."
            rows={8}
            disabled={busy}
          />
          <Button onClick={submit} disabled={busy || text.trim().length === 0}>
            {busy ? "Interpreting your request…" : "Create project"}
          </Button>
        </div>
      )}

      {stage.kind === "planned" && (
        <PlanCard
          spec={stage.spec}
          busy={busy}
          onApprove={() => act(stage.projectId, "approve")}
          onCancel={() => act(stage.projectId, "cancel")}
        />
      )}

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}
