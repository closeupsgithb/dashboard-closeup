import { NextResponse } from "next/server";
import { fetchOwnCampaignSpendByMonth, MissingCredentialsError } from "@/lib/metaAds";
import { requireAdmin } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof Response) return session;
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") ?? "2026-01-01";
  const until = searchParams.get("until") ?? new Date().toISOString().slice(0, 10);

  try {
    const spend = await fetchOwnCampaignSpendByMonth(since, until);
    return NextResponse.json({ generatedAt: new Date().toISOString(), since, until, spend });
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
