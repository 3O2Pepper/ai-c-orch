"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ArtifactPreviewProps {
  filename: string;
  content: string | null;
}

export function ArtifactPreview({ filename, content }: ArtifactPreviewProps) {
  if (!content) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report</CardTitle>
          <CardDescription>{filename}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Report not ready yet. It will appear here when the draft phase completes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Report</CardTitle>
        <CardDescription>{filename}</CardDescription>
      </CardHeader>
      <CardContent>
        <article className="prose prose-neutral dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-pre:bg-muted">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </CardContent>
    </Card>
  );
}
