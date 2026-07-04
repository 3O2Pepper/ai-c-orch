"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Poll-based liveness for Phase 1 (PLAN §0.3 — no SSE). Refreshes the server
 * component tree on an interval while the project is in an active state.
 */
export function AutoRefresh({
  active,
  intervalMs = 2000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);

  return null;
}
