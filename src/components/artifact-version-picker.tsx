import Link from "next/link";
import { cn } from "@/lib/utils";

// Artifact versioning UI (P3): every revision bumps the version; the
// picker links back to the project page with ?v=<version>.
export function ArtifactVersionPicker({
  projectId,
  versions,
  selected,
}: {
  projectId: string;
  versions: number[];
  selected: number;
}) {
  if (versions.length <= 1) return null;
  return (
    <nav aria-label="Artifact versions" className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-muted-foreground">Versions:</span>
      {versions.map((v) => (
        <Link
          key={v}
          href={`/project/${projectId}?v=${v}`}
          aria-current={v === selected ? "page" : undefined}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs",
            v === selected
              ? "border-foreground/40 bg-muted font-semibold"
              : "text-muted-foreground hover:bg-muted/50",
          )}
        >
          v{v}
        </Link>
      ))}
    </nav>
  );
}
