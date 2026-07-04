"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlanCard } from "@/components/plan-card";
import type { ProjectSpec } from "@/lib/core/spec";

/**
 * Gate 1 rendered on the project page, so a project left in
 * awaiting_plan_approval (e.g. the user navigated away from /new) can still
 * be approved or cancelled.
 */
export function ApprovalPanel({
  projectId,
  spec,
}: {
  projectId: string;
  spec: ProjectSpec;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <PlanCard
        spec={spec}
        busy={busy}
        onApprove={() => act("approve")}
        onCancel={() => act("cancel")}
      />
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
