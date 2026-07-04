import { NextResponse } from "next/server";
import { runIntake } from "@/lib/services/intake";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawRequest = body?.rawRequest;
    if (typeof rawRequest !== "string" || !rawRequest.trim()) {
      return NextResponse.json(
        { error: "rawRequest is required" },
        { status: 400 },
      );
    }

    const result = await runIntake(rawRequest);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Intake failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Intake failed" },
      { status: 500 },
    );
  }
}
