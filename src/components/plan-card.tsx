"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ProjectSpec } from "@/lib/core/spec";

interface PlanCardProps {
  spec: ProjectSpec;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

function SpecList({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">{heading}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanCard({ spec, busy, onApprove, onCancel }: PlanCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{spec.title}</CardTitle>
          <Badge variant="secondary">research</Badge>
        </div>
        <CardDescription>{spec.goal}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">
            Deliverables
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {spec.deliverables.map((d, i) => (
              <li key={i}>
                <span className="font-medium">{d.kind}</span> — {d.description}
              </li>
            ))}
          </ul>
        </div>
        <SpecList heading="Constraints" items={spec.constraints} />
        <SpecList heading="Success criteria" items={spec.success_criteria} />
        <SpecList heading="Assumptions" items={spec.assumptions} />
        {spec.blocking_questions.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
            <h3 className="mb-1 text-sm font-medium">
              Open questions (answered by assumption if you approve as-is)
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {spec.blocking_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button onClick={onApprove} disabled={busy}>
          {busy ? "Working…" : "Approve plan"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}
