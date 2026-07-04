import { NextResponse } from "next/server";
import { z } from "zod";
import { getDevUserId } from "@/lib/db/dev-user";
import { createProjectFromRequest } from "@/lib/services/intake";

const BodySchema = z.object({
  text: z.string().trim().min(1, "Request text is required"),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  try {
    const userId = await getDevUserId();
    const { projectId, spec } = await createProjectFromRequest(
      userId,
      parsed.data.text,
    );
    return NextResponse.json({ projectId, spec }, { status: 201 });
  } catch (err) {
    console.error("intake failed:", err);
    const message = err instanceof Error ? err.message : "Intake failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
