"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { ProjectSpec } from "@/lib/core/spec";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PlanCardProps {
  projectId: string;
  spec: ProjectSpec;
}

export function PlanCard({ projectId, spec }: PlanCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"approve" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(async () => {
    setLoading("approve");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/approve`, {
        method: "POST",
      });
      if (res.status === 409) {
        setError("Someone else already approved this plan. Refreshing…");
        router.refresh();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Approval failed");
      }
      router.push(`/project/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setLoading(null);
    }
  }, [projectId, router]);

  const cancel = useCallback(async () => {
    setLoading("cancel");
    router.push("/dashboard");
  }, [router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{spec.title}</CardTitle>
        <CardDescription>Review the extracted plan before running.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section>
          <h3 className="mb-2 text-sm font-medium">Goal</h3>
          <p className="text-sm text-muted-foreground">{spec.goal}</p>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium">Deliverables</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {spec.deliverables.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>

        {spec.constraints.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Constraints</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {spec.constraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {spec.success_criteria.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Success criteria</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {spec.success_criteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        {spec.assumptions.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Assumptions</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {spec.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        )}

        {spec.blocking_questions.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Blocking questions</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-amber-800 dark:text-amber-200">
              {spec.blocking_questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={approve} disabled={loading !== null}>
          {loading === "approve" ? "Starting…" : "Approve & run"}
        </Button>
        <Button variant="outline" onClick={cancel} disabled={loading !== null}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}
