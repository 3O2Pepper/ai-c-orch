import { getObject, putObject, storageConfigured } from "@/lib/storage";

// Artifact content placement (P3): text artifacts go to R2 when configured
// (artifacts.content null + storage_key set), inline in Postgres otherwise
// — the P1/P2 path. Binary artifacts REQUIRE object storage; callers gate
// on storageConfigured() before planning binary-producing phases.

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  py: "text/x-python; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Binary artifact kinds never store inline. */
export function isBinaryFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".xlsx");
}

function artifactKey(projectId: string, version: number, filename: string): string {
  return `projects/${projectId}/artifacts/v${version}/${filename}`;
}

export interface StoredContent {
  content: string | null;
  storageKey: string | null;
}

/** Store text artifact content: R2 when configured, inline otherwise. */
export async function storeArtifactText(
  projectId: string,
  filename: string,
  version: number,
  text: string,
): Promise<StoredContent> {
  if (!storageConfigured()) return { content: text, storageKey: null };
  const key = artifactKey(projectId, version, filename);
  await putObject(key, text, contentTypeFor(filename));
  return { content: null, storageKey: key };
}

/** Store binary artifact content. Requires object storage — no inline path. */
export async function storeArtifactBinary(
  projectId: string,
  filename: string,
  version: number,
  bytes: Buffer,
): Promise<StoredContent> {
  const key = artifactKey(projectId, version, filename);
  await putObject(key, bytes, contentTypeFor(filename)); // throws when unconfigured
  return { content: null, storageKey: key };
}

/** Resolve a text artifact's content wherever it lives. Null for binary. */
export async function loadArtifactText(artifact: {
  filename: string;
  content: string | null;
  storageKey: string | null;
}): Promise<string | null> {
  if (isBinaryFilename(artifact.filename)) return null;
  if (artifact.content !== null) return artifact.content;
  if (!artifact.storageKey) return null;
  return (await getObject(artifact.storageKey)).toString("utf8");
}

/** Resolve raw bytes (downloads). */
export async function loadArtifactBytes(artifact: {
  content: string | null;
  storageKey: string | null;
}): Promise<Buffer | null> {
  if (artifact.content !== null) return Buffer.from(artifact.content, "utf8");
  if (!artifact.storageKey) return null;
  return getObject(artifact.storageKey);
}
