import { NextResponse } from "next/server";
import {
  getAllTabsData,
  getManualAttendanceOverrides,
  MANUAL_ATTENDANCE_TAB,
  MissingCredentialsError as SheetsMissingCredentials,
} from "@/lib/sheets";
import {
  fetchOnboardingOpportunities,
  fetchFbFormNativoPostMeetingOpportunities,
  fetchLatestMeetingByContact,
  MissingCredentialsError as GhlMissingCredentials,
} from "@/lib/ghl";
import { fetchOwnCampaignSpendByMonth, MissingCredentialsError as MetaMissingCredentials } from "@/lib/metaAds";
import {
  buildMonthSnapshots,
  parseSbyTab,
  parseTabRows,
  computeCac,
  computeChurn,
  computeLtv,
  computeLtvCacRatio,
  computePendingFollowUp,
  computeOnboardingStageBreakdown,
  resolveMeetings,
  filterResolutionsFiables,
  computeReunionStats,
  computeCloserBreakdown,
  computeRoas,
} from "@/lib/metrics";

// Desde que existe el pipeline FB Form Nativo (2026-03-23), con margen.
const CALENDAR_LOOKBACK_START = new Date("2026-01-01T00:00:00Z").getTime();
const CALENDAR_LOOKAHEAD_END = Date.now() + 1000 * 60 * 60 * 24 * 60;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const [tabsData, onboarding, fbFormNativoPostMeeting, calendarMeetings, manualOverrides] = await Promise.all([
      getAllTabsData(),
      fetchOnboardingOpportunities(),
      fetchFbFormNativoPostMeetingOpportunities(),
      fetchLatestMeetingByContact(CALENDAR_LOOKBACK_START, CALENDAR_LOOKAHEAD_END),
      getManualAttendanceOverrides(),
    ]);

    // Pestañas de periodo en el orden en que aparecen en el Sheet (izquierda a
    // derecha) — se asume que los meses se van añadiendo en ese orden. Excluye
    // también "Asistencia Manual" (registro de marcado manual, no un mes de pago).
    const periodTabOrder = Object.keys(tabsData).filter(
      (t) => t !== "SBY" && t !== "Hoja 1" && t !== MANUAL_ATTENDANCE_TAB
    );
    const snapshots = buildMonthSnapshots(tabsData, periodTabOrder);
    const sbyEntries = parseSbyTab(tabsData["SBY"] ?? []);

    const resolutions = resolveMeetings(fbFormNativoPostMeeting, calendarMeetings, manualOverrides);

    // El rango de gasto de Meta Ads tiene que cubrir tanto los meses del Sheet
    // como los meses reales de reunión (fecha de calendario/manual/aproximada)
    // — son series independientes y la segunda arranca antes (desde que existe
    // la campaña), no solo desde el primer mes con pestaña en el Sheet.
    const mesesSheet = snapshots.map((s) => s.mes).filter((m): m is string => m !== null);
    const mesesReunion = resolutions.map((r) => r.mes).filter((m): m is string => m !== null);
    const todosLosMeses = [...mesesSheet, ...mesesReunion].sort();
    const since = todosLosMeses.length > 0 ? `${todosLosMeses[0]}-01` : "2026-01-01";
    const until = new Date().toISOString().slice(0, 10);
    const spendByMonth = await fetchOwnCampaignSpendByMonth(since, until);

    const cac = computeCac(snapshots, spendByMonth);
    const churn = computeChurn(snapshots, sbyEntries);
    const ltv = computeLtv(snapshots, churn);
    // Se compara contra el último periodo REPORTADO (no el último de la lista
    // sin más, que puede ser un mes en blanco recién creado a partir de la
    // plantilla anterior).
    const ultimoReportadoIdx = snapshots.map((s) => s.reportado).lastIndexOf(true);
    const ltvCacRatio = computeLtvCacRatio(ltv, ultimoReportadoIdx >= 0 ? cac[ultimoReportadoIdx] : undefined);
    const pendientes = computePendingFollowUp(snapshots);
    const onboardingStages = computeOnboardingStageBreakdown(onboarding);
    // Marzo-junio 2026 se excluyen de las estadísticas agregadas (no fiables,
    // ver lib/metrics.ts) — el roster completo (`resolutions`) sigue
    // devolviéndose entero para poder buscar/marcar un contacto antiguo.
    const resolucionesFiables = filterResolutionsFiables(resolutions);
    const reunionStats = computeReunionStats(resolucionesFiables, spendByMonth);
    const closerBreakdown = computeCloserBreakdown(resolucionesFiables);
    const roas = computeRoas(snapshots, onboarding, spendByMonth);

    // Pestaña editable desde el dashboard: la primera SIN reportar en orden
    // cronológico (el mes que Daniel tiene que rellenar ahora) — ya no es
    // "la última de la lista sin más" porque ahora existen pestañas de meses
    // futuros precreadas de antemano (hasta ENERO). Si no queda ninguna sin
    // reportar (todas rellenadas), se usa la última para poder seguir
    // corrigiéndola.
    const primeraSinReportar = snapshots.find((s) => !s.reportado)?.periodo;
    const ultimoPeriodo = primeraSinReportar ?? periodTabOrder[periodTabOrder.length - 1] ?? null;

    // Roster editable de TODAS las pestañas de periodo (no solo la
    // seleccionada por defecto) — el selector de mes en el dashboard elige
    // cuál mostrar sin necesidad de otra petición al servidor, ya que
    // getAllTabsData() ya las trae todas de una vez.
    //
    // Un cliente actualmente en pausa (SBY) se OCULTA de cualquier mes cuya
    // fila para ese cliente siga en blanco (todavía sin Estado) — pedido
    // explícito de Daniel: al marcar STAND BY, deja de pedirse importe/
    // factura en los meses siguientes, sin tener que tocar esas pestañas ya
    // precreadas. Un mes donde YA se registró algo (el mes real en que pasó
    // a STAND BY, o meses ya facturados antes) no se toca ni se oculta —
    // esto no es un borrado de datos, es solo dejar de listar filas vacías
    // para alguien pausado. Si se reactiva (sale de SBY), vuelve a aparecer
    // solo porque el filtro se recalcula en cada carga, sin ningún paso extra.
    const clientesEnPausaNormalizados = new Set(sbyEntries.map((s) => s.clienteNormalizado));
    const rostersPorPeriodo = periodTabOrder.map((periodo) => ({
      periodo,
      roster: parseTabRows(tabsData[periodo] ?? [])
        .filter((e) => !(e.estado === "" && clientesEnPausaNormalizados.has(e.clienteNormalizado)))
        .map((e) => ({
          cliente: e.cliente,
          estado: e.estado,
          importeRaw: e.importe.raw,
          facturaEmitida: e.facturaEmitida,
        })),
    }));

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
      ltvCacRatio,
      roas,
      seguimientoPendientes: pendientes,
      estadoOnboarding: onboardingStages,
      clientesEnPausa: sbyEntries.map((s) => ({
        cliente: s.cliente,
        comentario: s.comentario,
        estado: s.estado,
        importeRaw: s.importeRaw,
        facturaEmitida: s.facturaEmitida,
      })),
      periodoEditable: ultimoPeriodo,
      rostersPorPeriodo,
      reunionStats,
      closerBreakdown,
      reunionRoster: resolutions,
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
