import { NextResponse } from "next/server";
import { reconcileGrowth, getLastReconciliation } from "@/lib/growth/sync";
import { loadGrowthView } from "@/lib/growth/view";
import {
  computeFunnel,
  computeAgenda,
  groupAgendaByDay,
  computeMeetingsPeriodFunnel,
  computeMeetingsPeriodFunnelByCloser,
  computeFollowUpQueue,
  isPendingAttention,
  isGanadoSinPagado,
  isVentaConfirmada,
  applyMetricAdjustments,
  meetingRowFromAppointment,
  type MeetingRow,
} from "@/lib/growth/metrics";
import { resolvePeriod, type PeriodType } from "@/lib/growth/period";
import { MissingCredentialsError as GhlMissingCredentials } from "@/lib/growth/ghl";
import { query, MissingCredentialsError as DbMissingCredentials } from "@/lib/growth/db";
import { madridDateOnly } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_PERIOD_TYPES = new Set(["hoy", "semana", "mes"]);

const LEADS_LABEL: Record<PeriodType, string> = {
  hoy: "Leads de hoy",
  semana: "Leads de la semana",
  mes: "Leads del mes",
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const now = new Date();
    const nowMadrid = madridDateOnly(now);

    const periodoParam = url.searchParams.get("periodo") || "hoy";
    const tipo: PeriodType = VALID_PERIOD_TYPES.has(periodoParam) ? (periodoParam as PeriodType) : "hoy";
    // "ref" viene de la query string — nunca se confía en su forma sin
    // validar. Un ref que no encaja con el tipo (p. ej. "mes" con algo que
    // no sea YYYY-MM) se trata como si no viniera ninguno, en vez de
    // dejarlo llegar a resolvePeriod y producir una Date inválida que
    // tumbaba la petición entera (caso real, Daniel, 2026-09-01).
    const rawRef = url.searchParams.get("ref");
    const refPattern = tipo === "mes" ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
    const ref = rawRef && refPattern.test(rawRef) ? rawRef : null;
    const closerFilter = url.searchParams.get("closer") || "all";

    let syncError: string | null = null;
    try {
      await reconcileGrowth();
    } catch (err) {
      // La sincronización puede fallar puntualmente (GHL caído) sin que el
      // dashboard deje de mostrar los últimos datos ya guardados — se avisa
      // en vez de romper la carga entera.
      syncError = err instanceof Error ? err.message : String(err);
    }

    const { opportunities, appointmentsByOpportunity, closers } = await loadGrowthView();
    const closerNames = new Map(closers.map((c) => [c.id, c.displayName]));

    // Fuente única del periodo activo — TODAS las secciones (agenda,
    // métricas, follow-ups, leads, comparativa) filtran contra este mismo
    // rango, nunca contra un filtro temporal propio e independiente.
    const periodo = resolvePeriod(tipo, ref, nowMadrid);
    const periodoStartMs = new Date(periodo.start).getTime();
    const periodoEndMs = new Date(periodo.end).getTime();

    function porCloser<T extends { closerId: string | null }>(list: T[]): T[] {
      if (closerFilter === "all") return list;
      if (closerFilter === "unassigned") return list.filter((o) => o.closerId === null);
      return list.filter((o) => o.closerId === closerFilter);
    }

    // Agenda: una fila por oportunidad (su cita ACTIVA — fecha real de la
    // reunión), filtrada al periodo activo.
    const agendaRows = computeAgenda(opportunities, periodo.start, periodo.end, closerNames, now);
    const agendaFiltrada = porCloser(agendaRows);
    const agendaPorDia = tipo === "hoy" ? null : groupAgendaByDay(agendaFiltrada);

    // KPIs del periodo (corregido 2026-08-28, ver docs/MEETING_ARCHITECTURE.md):
    // se calculan sobre REUNIONES (growth_appointments), no sobre
    // oportunidades — cada reunión cuenta en el periodo de SU PROPIA fecha,
    // con SU PROPIO resultado ya resuelto, exista o no todavía otra reunión
    // más reciente para la misma oportunidad. Así una Call 1 asistida en
    // agosto sigue contando en agosto aunque en septiembre se agende (y
    // pierda) una Call 2 — antes de esta corrección esa Call 1 desaparecía en
    // cuanto la oportunidad avanzaba, porque solo se guardaba UN resultado de
    // asistencia por oportunidad, no uno por reunión.
    const todasLasCitas: MeetingRow[] = [];
    for (const list of appointmentsByOpportunity.values()) {
      for (const a of list) {
        const { attendance, cancelled } = meetingRowFromAppointment(a);
        todasLasCitas.push({
          opportunityId: a.opportunityId,
          appointmentId: a.appointmentId,
          closerId: a.closerId,
          scheduledAt: a.scheduledAt,
          attendance,
          cancelled,
        });
      }
    }
    const meetingsEnPeriodo = todasLasCitas.filter((m) => {
      const t = new Date(m.scheduledAt).getTime();
      return t >= periodoStartMs && t < periodoEndMs;
    });
    const meetingsEnPeriodoFiltradas = porCloser(meetingsEnPeriodo);

    // Ventas: evento de OPORTUNIDAD (fase Pagado), con su propia fecha de
    // cierre congelada (pagado_confirmado_at) — nunca la fecha de una cita,
    // que es un concepto distinto (Fase 18/19 del brief).
    const opportunitiesPagadasEnPeriodo = opportunities.filter((o) => {
      if (!isVentaConfirmada(o) || !o.pagadoConfirmadoAt) return false;
      const t = new Date(o.pagadoConfirmadoAt).getTime();
      return t >= periodoStartMs && t < periodoEndMs;
    });
    const ventasPagadasFiltradas = porCloser(opportunitiesPagadasEnPeriodo).length;
    const ventasPagadasByCloser = new Map<string | null, number>();
    for (const o of opportunitiesPagadasEnPeriodo) {
      ventasPagadasByCloser.set(o.closerId, (ventasPagadasByCloser.get(o.closerId) ?? 0) + 1);
    }

    // Corrección histórica auditada (Fase 21/22): solo se aplica en la vista
    // "mes", contra el mes exacto (o "all") — ver
    // app/api/growth/metric-adjustments/route.ts y docs/MEETING_ARCHITECTURE.md.
    const adjustmentRows =
      tipo === "mes"
        ? await query<{ metric_type: "attended" | "no_show"; delta: number }>`
            select metric_type, delta from growth_metric_adjustments where period = ${periodo.ref} or period = 'all'
          `
        : [];
    const adjustments = adjustmentRows.map((r) => ({ metricType: r.metric_type, delta: r.delta }));

    const metricasPeriodo = applyMetricAdjustments(
      computeMeetingsPeriodFunnel(meetingsEnPeriodoFiltradas, ventasPagadasFiltradas),
      adjustments
    );
    const closerBreakdown = computeMeetingsPeriodFunnelByCloser(meetingsEnPeriodo, ventasPagadasByCloser, closerNames);

    // Pendientes vencidos: siempre GLOBAL (todos los periodos y closers) —
    // un pendiente atrasado no debe desaparecer solo porque se cambie de
    // vista, es la única alerta que se pide expresamente "global".
    const pendientesGlobal = opportunities.filter((o) => isPendingAttention(o, now));

    // "Ganado" en GHL sin estar en la fase "Pagado" es una contradicción de
    // datos (regla de Daniel, 2026-08-21) — se señala para revisión, nunca
    // se cuenta como venta ni se ignora en silencio.
    const inconsistenciasGanadoSinPagado = opportunities.filter(isGanadoSinPagado).map((o) => ({
      opportunityId: o.opportunityId,
      contacto: o.contactName,
      closer: o.closerId ? (closerNames.get(o.closerId) ?? "Otros closers") : "Sin asignar",
      estadoActual: o.stageName,
    }));

    // Follow-ups: "vencidos" respecto a AHORA (siempre necesitan atención,
    // se mire el periodo que se mire); "en el periodo" respecto al MISMO
    // rango que la agenda — deja de reutilizar el volumen del mes cuando se
    // ve Hoy/Semana, que era el bug reportado.
    const followUps = computeFollowUpQueue(porCloser(opportunities), closerNames, periodo.start, periodo.end, now);

    // Leads: bloque secundario, ahora filtrado por fecha real de entrada
    // (entry_at) dentro del MISMO periodo activo — antes usaba siempre el
    // mes en curso sin importar la vista seleccionada (bug reportado).
    const leadsEnPeriodo = opportunities.filter((o) => {
      const t = new Date(o.entryAt).getTime();
      return t >= periodoStartMs && t < periodoEndMs;
    });
    const leadsFiltrados = porCloser(leadsEnPeriodo);
    const leadsFunnel = computeFunnel(leadsFiltrados, now);
    // "Leads sin reunión": los que todavía no tienen cita activa — los que sí
    // ya se ven en la Agenda, mostrarlos otra vez aquí sería redundante. Es
    // este subconjunto el que de verdad necesita seguimiento comercial desde
    // este bloque (pedido explícito: mejorar la sección de leads sin reunión).
    const leadsSinReunion = leadsFiltrados.filter((o) => o.activeAppointmentAt === null && o.status === "open");
    const leadsRows = leadsSinReunion
      .map((o) => {
        const contactado = o.proximoPaso !== null && o.proximoPaso !== "No definido";
        const tiempoEsperaMs = contactado
          ? o.firstContactAt
            ? new Date(o.firstContactAt).getTime() - new Date(o.entryAt).getTime()
            : null
          : now.getTime() - new Date(o.entryAt).getTime();
        return {
          opportunityId: o.opportunityId,
          contacto: o.contactName,
          empresa: o.companyName,
          responsableId: o.closerId,
          responsable: o.closerId ? (closerNames.get(o.closerId) ?? "Otros closers") : "Sin asignar",
          estado: o.proximoPaso ?? "Sin contactar",
          proximoPasoRaw: o.proximoPaso,
          contactado,
          tiempoEsperaMs,
          entryAt: o.entryAt,
          stageId: o.pipelineStageId,
          stageName: o.stageName,
          status: o.status,
          asistioReunionRaw: o.asistioReunion,
          activeAttendance: o.activeAttendance,
          followUpDueAt: o.followUpDueAt,
          followUpTitle: o.followUpTitle,
          followUpTaskId: o.followUpTaskId,
        };
      })
      .sort((a, b) => {
        // Sin contactar primero (más urgente), luego el que más tiempo lleva
        // esperando dentro de cada grupo.
        if (a.contactado !== b.contactado) return a.contactado ? 1 : -1;
        return (b.tiempoEsperaMs ?? 0) - (a.tiempoEsperaMs ?? 0);
      });

    // Tiempo medio de primer contacto (solo leads del periodo que ya fueron
    // contactados Y de los que se pudo derivar una fecha real de contacto) —
    // métrica agregada pedida explícitamente ("medir cuánto se tarda en
    // realizar el primer contacto").
    const tiemposContacto = leadsFiltrados
      .filter((o) => o.firstContactAt)
      .map((o) => new Date(o.firstContactAt as string).getTime() - new Date(o.entryAt).getTime())
      .filter((ms) => ms >= 0);
    const tiempoMedioPrimerContactoMs =
      tiemposContacto.length > 0 ? tiemposContacto.reduce((a, b) => a + b, 0) / tiemposContacto.length : null;
    const leadsSinContactar = leadsSinReunion.filter((o) => o.proximoPaso === null || o.proximoPaso === "No definido").length;

    const operativaFull = agendaFiltrada.map((r) => ({
      ...r,
      historial: (appointmentsByOpportunity.get(r.opportunityId) ?? []).map((a) => ({
        meetingNumber: a.meetingNumber,
        scheduledAt: a.scheduledAt,
        ghlStatus: a.ghlStatus,
        attendance: a.attendance,
        isActive: a.isActive,
      })),
    }));

    const lastSyncedAt = await getLastReconciliation();

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      periodo,
      closerFilter,
      closers: closers.map((c) => ({ id: c.id, displayName: c.displayName, active: c.active, color: c.color })),
      metricasPeriodo,
      closerBreakdown,
      pendientesGlobalCount: pendientesGlobal.length,
      inconsistenciasGanadoSinPagado,
      agenda: operativaFull,
      agendaPorDia,
      followUps,
      leadsLabel: LEADS_LABEL[tipo],
      leadsFunnel,
      leadsRows,
      leadsSinContactar,
      tiempoMedioPrimerContactoMs,
      lastSyncedAt,
      syncError,
    });
  } catch (err) {
    if (err instanceof GhlMissingCredentials) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS", detail: "Falta GHL_PRIVATE_TOKEN" }, { status: 503 });
    }
    if (err instanceof DbMissingCredentials) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS", detail: "Falta DATABASE_URL" }, { status: 503 });
    }
    return NextResponse.json(
      { error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
