import { NextResponse } from "next/server";
import { getDevUserId } from "@/lib/db/dev-user";
import { forUser } from "@/lib/db/queries";
import { contentTypeFor, loadArtifactBytes } from "@/lib/services/artifacts";

// Artifact download (P3): serves any version, text or binary, resolving
// content through the storage seam. User-scoped like every read.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id, artifactId } = await params;
  try {
    const userId = await getDevUserId();
    const q = forUser(userId);
    const artifacts = await q.listArtifacts(id); // ownership enforced inside
    const artifact = artifacts.find((a) => a.id === artifactId);
    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    const bytes = await loadArtifactBytes(artifact);
    if (!bytes) {
      return NextResponse.json({ error: "Artifact has no content" }, { status: 404 });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentTypeFor(artifact.filename),
        "Content-Disposition": `attachment; filename="${artifact.filename}"`,
        "Cache-Control": "private, max-age=0",
      },
    });
  } catch (err) {
    console.error("artifact download failed:", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
