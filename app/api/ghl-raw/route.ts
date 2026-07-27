import { NextResponse } from "next/server";
import { fetchOnboardingOpportunities, MissingCredentialsError } from "@/lib/ghl";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const onboarding = await fetchOnboardingOpportunities();
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      onboarding: { count: onboarding.length, sample: onboarding.slice(0, 5) },
    });
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
