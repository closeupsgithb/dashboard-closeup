import { GROWTH_STAGES, FOLLOW_UP_REQUIRED_STEPS } from "@/lib/growth/ghl";
import { madridDateOnly } from "@/lib/format";

export type GrowthOpportunityView = {
  opportunityId: string;
  contactName: string | null;
  companyName: string | null;
  pipelineStageId: string;
  status: string; // open | won | lost | abandoned
  closerId: string | null;
  entryMonth: string;
  entryAt: string; // fecha/hora real de entrada (congelada la primera vez que se ve el lead)
  asistioReunion: string | null; // Sí | No | Pendiente | null
  proximoPaso: string | null;
  activeAppointmentAt: string | null; // scheduled_at de la cita activa (is_active=true), si existe
  hasAnyAppointment: boolean; // alguna vez tuvo al menos una cita (activa o no)
};

export type Attendance = "asistio" | "no_show" | "pendiente";

const AGENDA_REACHED_STAGES = new Set<string>([
  GROWTH_STAGES.agendadoPendiente,
  GROWTH_STAGES.agendadoConfirmado,
  GROWTH_STAGES.solicitaReagendar,
  GROWTH_STAGES.noShowRecuperacion,
  GROWTH_STAGES.reunionRealizada,
  GROWTH_STAGES.followUpCall2,
  GROWTH_STAGES.pagado,
]);

const MEETING_HAPPENED_STAGES = new Set<string>([
  GROWTH_STAGES.reunionRealizada,
  GROWTH_STAGES.followUpCall2,
  GROWTH_STAGES.pagado,
]);

// Nunca se infiere "No show" solo porque la fecha ya pasó — solo cuenta una
// señal explícita: el campo asistio_reunion marcado "No", o la fase
// "No-show | Recuperación". Igual para "asistió": el campo marcado "Sí", o
// haber avanzado a una fase que solo existe si hubo reunión.
export function resolveAttendance(o: GrowthOpportunityView): Attendance {
  if (o.asistioReunion === "Sí" || MEETING_HAPPENED_STAGES.has(o.pipelineStageId)) return "asistio";
  if (o.asistioReunion === "No" || o.pipelineStageId === GROWTH_STAGES.noShowRecuperacion) return "no_show";
  return "pendiente";
}

// Regla definitiva de ventas (Daniel, 2026-08-21): la fuente canónica de una
// venta es la fase "Pagado" de GHL, NUNCA el estado "Ganado" por sí solo.
// "Próximo paso = Pago", una tarea de pago, una factura o un "Ganado" sin
// estar sincronizado con esta fase no cuentan como venta.
export function isVentaConfirmada(o: GrowthOpportunityView): boolean {
  return o.pipelineStageId === GROWTH_STAGES.pagado;
}

// "Ganado" en GHL sin estar en la fase "Pagado" es una contradicción de
// datos, no una venta — se señala para revisión en vez de contarse o
// ignorarse en silencio.
export function isGanadoSinPagado(o: GrowthOpportunityView): boolean {
  return o.status === "won" && o.pipelineStageId !== GROWTH_STAGES.pagado;
}

// "Reunión celebrable" = su cita activa ya debía haber ocurrido (fecha en el
// pasado). Una reunión futura, o un lead que nunca llegó a tener una cita
// con fecha ya pasada, no entra en el denominador de show rate / no-show
// rate — así lo pide la especificación explícitamente.
export function isMeetingCelebrable(o: GrowthOpportunityView, asOf: Date): boolean {
  const attendance = resolveAttendance(o);
  if (attendance !== "pendiente") return true; // ya resuelta = por definición ya pasó
  if (!o.activeAppointmentAt) return false;
  return new Date(o.activeAppointmentAt).getTime() < asOf.getTime();
}

export function isPendingAttention(o: GrowthOpportunityView, asOf: Date): boolean {
  if (o.status !== "open") return false;
  if (resolveAttendance(o) !== "pendiente") return false;
  if (o.pipelineStageId === GROWTH_STAGES.solicitaReagendar) return false; // ya se sabe que hay que reagendar, no es "pendiente de marcar"
  if (!o.activeAppointmentAt) return false;
  return new Date(o.activeAppointmentAt).getTime() < asOf.getTime();
}

export type RowStatus = "pendiente_vencido" | "pendiente_paso" | "trabajada" | "futura";

// Sistema visual de estados (Daniel, 2026-08-21): ámbar = necesita acción,
// verde = ya trabajada de verdad, gris = todavía no toca. Una reunión
// "Asistió" sin un próximo paso válido NO cuenta como trabajada — sigue en
// ámbar hasta que se defina (ver ejemplos explícitos del prompt).
export function computeRowStatus(o: GrowthOpportunityView, asOf: Date): RowStatus {
  if (isPendingAttention(o, asOf)) return "pendiente_vencido";
  const attendance = resolveAttendance(o);
  if (attendance === "asistio") {
    const pasoValido = o.proximoPaso !== null && o.proximoPaso !== "No definido";
    return pasoValido ? "trabajada" : "pendiente_paso";
  }
  if (attendance === "no_show") return "trabajada"; // ya procesado: movido a No-show | Recuperación
  return "futura";
}

export type FunnelCounts = {
  leadsCualificados: number;
  reunionesAgendadas: number;
  asistieron: number;
  noShows: number;
  pagados: number;
  tasaAgenda: number | null;
  showRate: number | null;
  noShowRate: number | null;
  closeRate: number | null;
  leadACliente: number | null;
};

export function computeFunnel(opportunities: GrowthOpportunityView[], asOf: Date): FunnelCounts {
  const leadsCualificados = opportunities.length;
  const reunionesAgendadas = opportunities.filter(
    (o) => o.hasAnyAppointment || AGENDA_REACHED_STAGES.has(o.pipelineStageId)
  ).length;

  const celebrables = opportunities.filter((o) => isMeetingCelebrable(o, asOf));
  const asistieron = opportunities.filter((o) => resolveAttendance(o) === "asistio").length;
  const noShows = opportunities.filter((o) => resolveAttendance(o) === "no_show").length;
  const pagados = opportunities.filter(isVentaConfirmada).length;

  const denomCelebrable = celebrables.length;

  return {
    leadsCualificados,
    reunionesAgendadas,
    asistieron,
    noShows,
    pagados,
    tasaAgenda: leadsCualificados > 0 ? reunionesAgendadas / leadsCualificados : null,
    showRate: denomCelebrable > 0 ? asistieron / denomCelebrable : null,
    noShowRate: denomCelebrable > 0 ? noShows / denomCelebrable : null,
    closeRate: asistieron > 0 ? pagados / asistieron : null,
    leadACliente: leadsCualificados > 0 ? pagados / leadsCualificados : null,
  };
}

export type CloserFunnelRow = FunnelCounts & { closerId: string | null; closerName: string };

export function computeFunnelByCloser(
  opportunities: GrowthOpportunityView[],
  asOf: Date,
  closerNames: Map<string, string>
): CloserFunnelRow[] {
  const byCloser = new Map<string | null, GrowthOpportunityView[]>();
  for (const o of opportunities) {
    const list = byCloser.get(o.closerId) ?? [];
    list.push(o);
    byCloser.set(o.closerId, list);
  }
  return [...byCloser.entries()]
    .map(([closerId, list]) => ({
      closerId,
      closerName: closerId ? (closerNames.get(closerId) ?? "Otros closers") : "Sin asignar",
      ...computeFunnel(list, asOf),
    }))
    .sort((a, b) => {
      const rank = (id: string | null) => (id === null ? 1 : 0);
      return rank(a.closerId) - rank(b.closerId) || a.closerName.localeCompare(b.closerName);
    });
}

// Meses disponibles para el selector: todos los entry_month vistos en datos
// + mes actual + mes siguiente, sin listas fijas — se generan solos a
// partir de lo que hay realmente.
export function availableMonths(entryMonths: string[], nowMadrid: string): string[] {
  const currentMonth = nowMadrid.slice(0, 7);
  const [y, m] = currentMonth.split("-").map(Number);
  const nextMonthDate = new Date(Date.UTC(y, m, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const set = new Set([...entryMonths, currentMonth, nextMonth]);
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Agenda (Hoy / Semana / Mes): una fila por oportunidad — la cita ACTIVA de
// cada una, no todo su historial. "Reunión N" viene de meeting_number de esa
// cita activa (guardado en growth_appointments, ver lib/growth/view.ts).
// ---------------------------------------------------------------------------

export type AgendaOpportunity = GrowthOpportunityView & {
  contactName: string | null;
  companyName: string | null;
  stageName: string;
  activeMeetingNumber: number | null;
};

export type AgendaRow = {
  opportunityId: string;
  contactName: string | null;
  companyName: string | null;
  closerId: string | null;
  closerName: string;
  meetingNumber: number | null;
  scheduledAt: string;
  stageId: string;
  stageName: string;
  status: string;
  attendance: Attendance;
  asistioReunionRaw: string | null;
  proximoPaso: string | null;
  pendienteAtencion: boolean;
  rowStatus: RowStatus;
};

// Orden pedido explícitamente: primero lo que necesita acción (vencidos más
// antiguos primero = más urgentes, luego los que solo les falta próximo
// paso), después lo futuro en orden ascendente, y lo ya trabajado al final
// — nunca desplaza a lo pendiente aunque sea cronológicamente anterior.
const ROW_STATUS_RANK: Record<RowStatus, number> = {
  pendiente_vencido: 0,
  pendiente_paso: 1,
  futura: 2,
  trabajada: 3,
};

export function computeAgenda(
  opportunities: AgendaOpportunity[],
  periodStartIso: string,
  periodEndIso: string,
  closerNames: Map<string, string>,
  asOf: Date
): AgendaRow[] {
  const startMs = new Date(periodStartIso).getTime();
  const endMs = new Date(periodEndIso).getTime();
  return opportunities
    .filter((o) => o.activeAppointmentAt !== null)
    .filter((o) => {
      const t = new Date(o.activeAppointmentAt!).getTime();
      return t >= startMs && t < endMs;
    })
    .map((o) => ({
      opportunityId: o.opportunityId,
      contactName: o.contactName,
      companyName: o.companyName,
      closerId: o.closerId,
      closerName: o.closerId ? (closerNames.get(o.closerId) ?? "Otros closers") : "Sin asignar",
      meetingNumber: o.activeMeetingNumber,
      scheduledAt: o.activeAppointmentAt as string,
      stageId: o.pipelineStageId,
      stageName: o.stageName,
      status: o.status,
      attendance: resolveAttendance(o),
      asistioReunionRaw: o.asistioReunion,
      proximoPaso: o.proximoPaso,
      pendienteAtencion: isPendingAttention(o, asOf),
      rowStatus: computeRowStatus(o, asOf),
    }))
    .sort((a, b) => {
      const rank = ROW_STATUS_RANK[a.rowStatus] - ROW_STATUS_RANK[b.rowStatus];
      if (rank !== 0) return rank;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });
}

export function groupAgendaByDay(rows: AgendaRow[]): { date: string; rows: AgendaRow[] }[] {
  const byDay = new Map<string, AgendaRow[]>();
  for (const r of rows) {
    const day = madridDateOnly(r.scheduledAt);
    const list = byDay.get(day) ?? [];
    list.push(r);
    byDay.set(day, list);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayRows]) => ({ date, rows: dayRows }));
}

export type PeriodFunnel = {
  reunionesAgendadas: number;
  reunionesRealizadas: number;
  noShows: number;
  ventasPagadas: number;
  showRate: number | null;
  closeRate: number | null;
};

// Se calcula sobre el MISMO conjunto que ya alimenta la agenda del periodo
// (citas activas cuya fecha cae en el rango) — así las tarjetas de arriba
// nunca pueden descuadrar con lo que se ve debajo en la agenda.
export function computePeriodFunnel(periodOpportunities: GrowthOpportunityView[], asOf: Date): PeriodFunnel {
  const asistieron = periodOpportunities.filter((o) => resolveAttendance(o) === "asistio");
  const noShows = periodOpportunities.filter((o) => resolveAttendance(o) === "no_show");
  const celebrables = periodOpportunities.filter((o) => isMeetingCelebrable(o, asOf));
  const pagados = periodOpportunities.filter(isVentaConfirmada);
  return {
    reunionesAgendadas: periodOpportunities.length,
    reunionesRealizadas: asistieron.length,
    noShows: noShows.length,
    ventasPagadas: pagados.length,
    showRate: celebrables.length > 0 ? asistieron.length / celebrables.length : null,
    closeRate: asistieron.length > 0 ? pagados.length / asistieron.length : null,
  };
}

export type PeriodCloserRow = PeriodFunnel & { closerId: string | null; closerName: string };

export function computePeriodFunnelByCloser(
  periodOpportunities: GrowthOpportunityView[],
  asOf: Date,
  closerNames: Map<string, string>
): PeriodCloserRow[] {
  const byCloser = new Map<string | null, GrowthOpportunityView[]>();
  for (const o of periodOpportunities) {
    const list = byCloser.get(o.closerId) ?? [];
    list.push(o);
    byCloser.set(o.closerId, list);
  }
  return [...byCloser.entries()]
    .map(([closerId, list]) => ({
      closerId,
      closerName: closerId ? (closerNames.get(closerId) ?? "Otros closers") : "Sin asignar",
      ...computePeriodFunnel(list, asOf),
    }))
    .sort((a, b) => {
      const rank = (id: string | null) => (id === null ? 1 : 0);
      return rank(a.closerId) - rank(b.closerId) || a.closerName.localeCompare(b.closerName);
    });
}

// ---------------------------------------------------------------------------
// Cola de Follow-ups: leads abiertos cuyo Próximo paso requiere seguimiento
// con fecha propia (no una reunión — eso ya vive en la Agenda). La fecha
// viene de la tarea de GHL más próxima sin completar (ver
// lib/growth/sync.ts, resolveFollowUpDueAt) — null si no hay ninguna.
// ---------------------------------------------------------------------------

export type FollowUpOpportunity = GrowthOpportunityView & {
  contactName: string | null;
  companyName: string | null;
  stageName: string;
  followUpDueAt: string | null;
  followUpTitle: string | null;
  followUpTaskId: string | null;
};

export type FollowUpRow = {
  opportunityId: string;
  contactName: string | null;
  companyName: string | null;
  closerId: string | null;
  closerName: string;
  proximoPaso: string | null;
  dueAt: string | null;
  accion: string | null;
  taskId: string | null;
  stageId: string;
  stageName: string;
  status: string;
  asistioReunionRaw: string | null;
};

// 3 cajones, relativos al periodo activo (Daniel, 2026-08-21: "debe
// respetar exactamente Hoy/Semana/Mes" — nada de un cajón "semana" fijo
// visible aunque se esté viendo Hoy). "Vencidos" es siempre respecto a
// AHORA, no al periodo — algo atrasado necesita atención se mire el
// periodo que se mire. "En el periodo" son los que caen dentro de la
// ventana activa y todavía no están vencidos. "Sin fecha" se muestra
// siempre, en cualquier periodo, porque ninguna fecha los descarta.
export type FollowUpBuckets = {
  vencidos: FollowUpRow[];
  enPeriodo: FollowUpRow[];
  sinFecha: FollowUpRow[];
};

export function computeFollowUpQueue(
  opportunities: FollowUpOpportunity[],
  closerNames: Map<string, string>,
  periodoStartIso: string,
  periodoEndIso: string,
  asOf: Date
): FollowUpBuckets {
  const candidatos = opportunities.filter(
    (o) => o.status === "open" && o.proximoPaso !== null && FOLLOW_UP_REQUIRED_STEPS.has(o.proximoPaso)
  );

  const buckets: FollowUpBuckets = { vencidos: [], enPeriodo: [], sinFecha: [] };
  const nowMs = asOf.getTime();
  const startMs = new Date(periodoStartIso).getTime();
  const endMs = new Date(periodoEndIso).getTime();

  for (const o of candidatos) {
    const row: FollowUpRow = {
      opportunityId: o.opportunityId,
      contactName: o.contactName,
      companyName: o.companyName,
      closerId: o.closerId,
      closerName: o.closerId ? (closerNames.get(o.closerId) ?? "Otros closers") : "Sin asignar",
      proximoPaso: o.proximoPaso,
      dueAt: o.followUpDueAt,
      // La acción concreta es el título de la tarea nativa de GHL (texto
      // libre, escrito desde el panel) — "Próximo paso" es el picklist, no
      // sustituye a esto. Si todavía no hay tarea creada, se muestra el
      // picklist como mejor aproximación disponible.
      accion: o.followUpTitle ?? o.proximoPaso,
      taskId: o.followUpTaskId,
      stageId: o.pipelineStageId,
      stageName: o.stageName,
      status: o.status,
      asistioReunionRaw: o.asistioReunion,
    };
    if (!o.followUpDueAt) {
      buckets.sinFecha.push(row);
      continue;
    }
    const dueMs = new Date(o.followUpDueAt).getTime();
    if (dueMs < nowMs) buckets.vencidos.push(row);
    else if (dueMs >= startMs && dueMs < endMs) buckets.enPeriodo.push(row);
  }

  // ".localeCompare" asumía que dueAt siempre era un string — pero
  // @neondatabase/serverless devuelve las columnas `timestamptz` como
  // objetos Date, no strings (comprobado contra el driver real). Con una
  // sola fila en el cajón el comparador nunca llegaba a invocarse, así que
  // el bug quedó latente hasta tener 2+ follow-ups con fecha a la vez.
  // getTime() funciona igual reciba Date o string.
  const byDueDate = (a: FollowUpRow, b: FollowUpRow) => {
    const at = a.dueAt ? new Date(a.dueAt).getTime() : 0;
    const bt = b.dueAt ? new Date(b.dueAt).getTime() : 0;
    return at - bt;
  };
  buckets.vencidos.sort(byDueDate);
  buckets.enPeriodo.sort(byDueDate);

  return buckets;
}
