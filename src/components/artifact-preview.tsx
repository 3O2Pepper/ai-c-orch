import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface PreviewArtifact {
  id: string;
  filename: string;
  kind: string;
  version: number;
  content: string | null;
  /** Binary artifacts (xlsx) have no inline preview — download only. */
  isBinary?: boolean;
  downloadHref?: string;
}

// react-markdown does NOT render raw HTML by default (no rehype-raw) — that
// is the sanitization guarantee for model-generated content (PLAN §9).
// Keep it that way. Code artifacts render inside a fenced block, not as
// markdown, for the same reason.
export function ArtifactPreview({ artifact }: { artifact: PreviewArtifact | null }) {
  if (!artifact) {
    return (
      <p className="text-sm text-muted-foreground">
        The artifact preview appears here once the producing phase completes.
      </p>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{artifact.filename}</span>
        <span>v{artifact.version}</span>
        {artifact.downloadHref && (
          <a href={artifact.downloadHref} className="ml-auto hover:underline" download>
            Download
          </a>
        )}
      </div>
      {artifact.isBinary ? (
        <p className="text-sm text-muted-foreground">
          Binary artifact ({artifact.kind}) — use Download to open it.
        </p>
      ) : artifact.kind === "code" ? (
        <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
          <code>{artifact.content ?? "// Artifact content is empty."}</code>
        </pre>
      ) : (
        <article className="prose prose-sm max-w-none dark:prose-invert [&_h1]:text-xl [&_h2]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_table]:text-xs [&_ul]:list-disc [&_ol]:list-decimal [&_ul,&_ol]:pl-5 [&>*+*]:mt-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {artifact.content ?? "_Artifact content is empty._"}
          </ReactMarkdown>
        </article>
      )}
    </div>
  );
}
