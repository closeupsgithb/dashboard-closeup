import { NextResponse } from "next/server";
import { getAllTabsData, MissingCredentialsError } from "@/lib/sheets";
import { requireAdmin } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof Response) return session;
  try {
    const tabs = await getAllTabsData();
    return NextResponse.json({ generatedAt: new Date().toISOString(), tabs });
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    }
    return NextResponse.json(
      { error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
