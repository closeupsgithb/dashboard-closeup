import { NextResponse } from "next/server";
import { getAllTabsData, MissingCredentialsError as SheetsMissingCredentials } from "@/lib/sheets";
import { fetchOnboardingOpportunities, MissingCredentialsError as GhlMissingCredentials } from "@/lib/ghl";
import { fetchOwnCampaignSpendByMonth, MissingCredentialsError as MetaMissingCredentials } from "@/lib/metaAds";
import {
  buildMonthSnapshots,
  parseSbyTab,
  parseTabRows,
  computeCac,
  computeChurn,
  computeLtv,
  computePendingFollowUp,
  computeOnboardingStageBreakdown,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const [tabsData, onboarding] = await Promise.all([getAllTabsData(), fetchOnboardingOpportunities()]);

    // Pestañas de periodo en el orden en que aparecen en el Sheet (izquierda a
    // derecha) — se asume que los meses se van añadiendo en ese orden.
    const periodTabOrder = Object.keys(tabsData).filter((t) => t !== "SBY" && t !== "Hoja 1");
    const snapshots = buildMonthSnapshots(tabsData, periodTabOrder);
    const sbyEntries = parseSbyTab(tabsData["SBY"] ?? []);

    const meses = snapshots.map((s) => s.mes).filter((m): m is string => m !== null);
    const since = meses.length > 0 ? `${meses[0]}-01` : "2026-01-01";
    const until = new Date().toISOString().slice(0, 10);
    const spendByMonth = await fetchOwnCampaignSpendByMonth(since, until);

    const cac = computeCac(snapshots, spendByMonth);
    const churn = computeChurn(snapshots, sbyEntries);
    const ltv = computeLtv(snapshots, churn);
    const pendientes = computePendingFollowUp(snapshots);
    const onboardingStages = computeOnboardingStageBreakdown(onboarding);

    // Pestaña editable desde el dashboard: siempre la última de la lista (el
    // mes que Daniel esté rellenando ahora), reportada o no.
    const ultimoPeriodo = periodTabOrder[periodTabOrder.length - 1] ?? null;
    const roster = ultimoPeriodo
      ? parseTabRows(tabsData[ultimoPeriodo] ?? []).map((e) => ({
          cliente: e.cliente,
          estado: e.estado,
          importeRaw: e.importe.raw,
        }))
      : [];

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      ingresoMensualConfirmado: snapshots.map((s) => ({
        periodo: s.periodo,
        mes: s.mes,
        reportado: s.reportado,
        ingreso: s.ingresoConfirmado,
        ingresoPendiente: s.ingresoPendiente,
        entradasNoInterpretables: s.entradasNoInterpretables,
      })),
      cac,
      churn,
      ltv,
      seguimientoPendientes: pendientes,
      estadoOnboarding: onboardingStages,
      clientesEnPausa: sbyEntries.map((s) => ({ cliente: s.cliente, comentario: s.comentario })),
      periodoEditable: ultimoPeriodo,
      rosterEditable: roster,
    });
  } catch (err) {
    if (err instanceof SheetsMissingCredentials || err instanceof GhlMissingCredentials || err instanceof MetaMissingCredentials) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    }
    return NextResponse.json(
      { error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
