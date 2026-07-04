"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes server component data every `intervalMs` (PLAN: 2s polling). */
export function PollingRefresh({
  intervalMs = 2000,
  active = true,
  children,
}: {
  intervalMs?: number;
  active?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, active]);

  return <>{children}</>;
}
