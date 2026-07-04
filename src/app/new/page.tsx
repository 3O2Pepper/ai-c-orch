"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlanCard } from "@/components/plan-card";
import type { ProjectSpec } from "@/lib/core/spec";

export default function NewProjectPage() {
  const router = useRouter();
  const [rawRequest, setRawRequest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    projectId: string;
    spec: ProjectSpec;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawRequest.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawRequest }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create project");
      }

      const data = await res.json();
      setResult({ projectId: data.projectId, spec: data.spec });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Type what you want. Get a finished project, not a conversation.
        </p>
      </div>

      {!result ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            placeholder="Describe your project in plain language…"
            value={rawRequest}
            onChange={(e) => setRawRequest(e.target.value)}
            rows={10}
            disabled={loading}
            className="min-h-48 resize-y"
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={loading || !rawRequest.trim()}>
              {loading ? "Extracting spec…" : "Create plan"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/dashboard")}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <PlanCard projectId={result.projectId} spec={result.spec} />
      )}
    </main>
  );
}
