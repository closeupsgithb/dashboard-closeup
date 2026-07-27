import { NextResponse } from "next/server";
import { fetchFunnelOpportunities, fetchOnboardingOpportunities, MissingCredentialsError } from "@/lib/ghl";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const [funnel, onboarding] = await Promise.all([fetchFunnelOpportunities(), fetchOnboardingOpportunities()]);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      funnel: { count: funnel.length, sample: funnel.slice(0, 5) },
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
