import { GROWTH_STAGES, FOLLOW_UP_REQUIRED_STEPS } from "@/lib/growth/ghl";
import { madridDateOnly } from "@/lib/format";

export type Attendance = "asistio" | "no_show" | "pendiente";

export type GrowthOpportunityView = {
  opportunityId: string;
  contactName: string | null;
  companyName: string | null;
  pipelineStageId: string;
  status: string; // open | won | lost | abandoned
  closerId: string | null;
  entryMonth: string;
  entryAt: string; // fecha/hora real de entrada (congelada la primera vez que se ve el lead)
  asistioReunion: string | null; // Sí | No | Pendiente | null — valor crudo de GHL, solo para mostrar/auditar
  proximoPaso: string | null;
  activeAppointmentAt: string | null; // scheduled_at de la cita activa (is_active=true), si existe
  // Resultado de la reunión ACTIVA (growth_appointments.attendance de la fila
  // is_active=true), NUNCA derivado de asistio_reunion/pipeline_stage_id
  // directamente (corregido 2026-08-28, ver docs/MEETING_ARCHITECTURE.md):
  // ese campo es mutable por oportunidad y se sobrescribe con cada reunión
  // nueva (Call 2 pisaba el resultado de Call 1). Cada reunión guarda su
  // propio resultado en su propia fila — esto solo lee el de la ACTIVA, que
  // es lo que importa para "¿qué necesito hacer ahora con este lead?".
  activeAttendance: Attendance;
  hasAnyAppointment: boolean; // alguna vez tuvo al menos una cita (activa o no)
};

const AGENDA_REACHED_STAGES = new Set<string>([
  GROWTH_STAGES.agendadoPendiente,
  GROWTH_STAGES.agendadoConfirmado,
  GROWTH_STAGES.solicitaReagendar,
  GROWTH_STAGES.noShowRecuperacion,
  GROWTH_STAGES.reunionRealizada,
  GROWTH_STAGES.followUpCall2,
  GROWTH_STAGES.pagado,
]);

// Nunca se infiere "No show" solo porque la fecha ya pasó, y nunca se lee de
// un campo de la oportunidad que pueda haber sido pisado por una reunión
// posterior — se lee directamente el resultado ya resuelto de la reunión
// ACTIVA (ver GrowthOpportunityView.activeAttendance).
export function resolveAttendance(o: GrowthOpportunityView): Attendance {
  return o.activeAttendance;
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
  closeRate: number | null;
  leadACliente: number | null;
};

// showRate/noShowRate vivieron aquí hasta la auditoría 2026-09-09: un
// segundo cálculo de "show rate" con denominador "celebrables" (asistidas +
// no-shows + pasadas todavía sin marcar), distinto del showRate real de las
// tarjetas (computeMeetingsPeriodFunnel, solo asistidas+no-shows). Ningún
// componente los leía (confirmado por grep) — quitados para que no queden
// esperando a que alguien los conecte por error y produzca un tercer show
// rate con un número distinto. Al quitarlos, isMeetingCelebrable() (arriba)
// se queda sin ninguna llamada real — isPendingAttention() no la usa, tiene
// su propia lógica inline equivalente. No se ha tocado aquí (fuera del
// alcance pedido): queda para una limpieza aparte si se confirma que
// tampoco hace falta en ningún sitio futuro.
export function computeFunnel(opportunities: GrowthOpportunityView[], asOf: Date): FunnelCounts {
  const leadsCualificados = opportunities.length;
  const reunionesAgendadas = opportunities.filter(
    (o) => o.hasAnyAppointment || AGENDA_REACHED_STAGES.has(o.pipelineStageId)
  ).length;

  const asistieron = opportunities.filter((o) => resolveAttendance(o) === "asistio").length;
  const noShows = opportunities.filter((o) => resolveAttendance(o) === "no_show").length;
  const pagados = opportunities.filter(isVentaConfirmada).length;

  return {
    leadsCualificados,
    reunionesAgendadas,
    asistieron,
    noShows,
    pagados,
    tasaAgenda: leadsCualificados > 0 ? reunionesAgendadas / leadsCualificados : null,
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
  activeAppointmentId: string | null;
};

export type AgendaRow = {
  opportunityId: string;
  appointmentId: string | null;
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
      appointmentId: o.activeAppointmentId,
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
  // Agendadas que todavía no tienen resultado: futuras, o pasadas sin marcar
  // (ver docs/MEETINGS_METRICS_AUDIT.md — auditoría 2026-09-09, hallazgo
  // "el 100% de asistencia no es un bug de fórmula"). No entra en el
  // numerador ni el denominador de showRate, pero se expone aparte para que
  // la tarjeta de Asistencia no oculte cuántas quedan sin resolver.
  pendientes: number;
  ventasPagadas: number;
  showRate: number | null;
  closeRate: number | null;
};

// ---------------------------------------------------------------------------
// KPIs del periodo (Hoy / Semana / Mes): corregido 2026-08-28 para que
// cuenten REUNIONES (una fila = un evento de growth_appointments, con su
// propio resultado ya resuelto), no oportunidades. Antes de esta corrección
// se contaba 1 oportunidad = máximo 1 resultado de asistencia, así que una
// Call 1 asistida se perdía en cuanto se agendaba una Call 2 — la causa raíz
// documentada en docs/MEETING_ARCHITECTURE.md. Con esto: una oportunidad con
// Call 1 asistida en agosto y Call 2 agendada en septiembre aporta al show
// rate de AGOSTO (por la fecha real de Call 1), no al de septiembre.
// ---------------------------------------------------------------------------

export type MeetingRow = {
  opportunityId: string;
  appointmentId: string;
  closerId: string | null;
  scheduledAt: string;
  attendance: Attendance;
  cancelled: boolean;
};

// ghl_status es texto libre de GHL (confirmed/booked/cancelled/...) — solo
// "cancelled" saca una reunión del recuento (Fase "no contar cancelled en
// show rate"); cualquier otro valor (incluido desconocido) sigue contando.
export function meetingRowFromAppointment(a: { attendance: string; ghlStatus: string | null }): { attendance: Attendance; cancelled: boolean } {
  const attendance: Attendance = a.attendance === "si" ? "asistio" : a.attendance === "no" ? "no_show" : "pendiente";
  return { attendance, cancelled: a.ghlStatus === "cancelled" };
}

// ventasPagadas se pasa aparte (no se deriva de las reuniones): una venta es
// un evento de OPORTUNIDAD (fase Pagado, fecha = pagado_confirmado_at), no de
// reunión — closeRate = ventas / reuniones asistidas del mismo periodo
// (regla explícita, Fase 19).
//
// Show rate = ATTENDED / (ATTENDED + NO_SHOW) — definición explícita de
// Daniel (2026-08-28). NO se usa como denominador "reuniones celebrables"
// (asistidas + no-shows + pasadas todavía sin marcar): una reunión pasada sin
// marcar no es ni un show ni un no-show todavía, así que no entra en ninguno
// de los dos lados — sí sigue contando en "Agendadas" y sigue generando la
// alerta de pendiente de actualizar (ver isPendingAttention).
export function computeMeetingsPeriodFunnel(meetings: MeetingRow[], ventasPagadas: number): PeriodFunnel {
  const activas = meetings.filter((m) => !m.cancelled);
  const asistieron = activas.filter((m) => m.attendance === "asistio");
  const noShows = activas.filter((m) => m.attendance === "no_show");
  const resueltas = asistieron.length + noShows.length;
  return {
    reunionesAgendadas: activas.length,
    reunionesRealizadas: asistieron.length,
    noShows: noShows.length,
    pendientes: activas.length - resueltas,
    ventasPagadas,
    showRate: resueltas > 0 ? asistieron.length / resueltas : null,
    closeRate: asistieron.length > 0 ? ventasPagadas / asistieron.length : null,
  };
}

export type PeriodCloserRow = PeriodFunnel & { closerId: string | null; closerName: string };

export function computeMeetingsPeriodFunnelByCloser(
  meetings: MeetingRow[],
  ventasPagadasByCloser: Map<string | null, number>,
  closerNames: Map<string, string>
): PeriodCloserRow[] {
  const byCloser = new Map<string | null, MeetingRow[]>();
  for (const m of meetings) {
    const list = byCloser.get(m.closerId) ?? [];
    list.push(m);
    byCloser.set(m.closerId, list);
  }
  // Un closer con venta(s) pero sin reuniones propias en el periodo (venta
  // cerrada por otro canal, o desfase de fechas) no debe desaparecer de la
  // comparativa por closer.
  for (const closerId of ventasPagadasByCloser.keys()) {
    if (!byCloser.has(closerId)) byCloser.set(closerId, []);
  }
  return [...byCloser.entries()]
    .map(([closerId, list]) => ({
      closerId,
      closerName: closerId ? (closerNames.get(closerId) ?? "Otros closers") : "Sin asignar",
      ...computeMeetingsPeriodFunnel(list, ventasPagadasByCloser.get(closerId) ?? 0),
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
  // Resultado de la reunión ACTIVA de este lead (growth_appointments.attendance,
  // no el campo crudo de GHL de arriba) — ver comentario equivalente en
  // GrowthOpportunityView.activeAttendance. El panel lo usa como punto de
  // partida real de "Resultado de la reunión" en vez de asistioReunionRaw,
  // que puede quedar desactualizado si esa reunión ya no es la activa.
  activeAttendance: Attendance;
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
      activeAttendance: o.activeAttendance,
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

// ---------------------------------------------------------------------------
// Corrección histórica auditada (growth_metric_adjustments) — Fase 21/22 del
// brief de reconciliación de Daniel (2026-08-28): cuando el histórico real
// conocido no se puede reconstruir con identidad exacta desde GHL/Neon, se
// aplica aquí un ajuste explícito y trazable en vez de fabricar reuniones o
// contactos falsos. Solo admin puede crear filas (ver
// app/api/growth/metric-adjustments/route.ts); nunca se aplican en silencio.
// ---------------------------------------------------------------------------

export type MetricAdjustment = { metricType: "attended" | "no_show"; delta: number };

export function applyMetricAdjustments(funnel: PeriodFunnel, adjustments: MetricAdjustment[]): PeriodFunnel {
  if (adjustments.length === 0) return funnel;
  let reunionesRealizadas = funnel.reunionesRealizadas;
  let noShows = funnel.noShows;
  for (const adj of adjustments) {
    if (adj.metricType === "attended") reunionesRealizadas += adj.delta;
    else noShows += adj.delta;
  }
  const resueltas = reunionesRealizadas + noShows;
  return {
    ...funnel,
    reunionesAgendadas: funnel.reunionesAgendadas + adjustments.reduce((s, a) => s + a.delta, 0),
    reunionesRealizadas,
    noShows,
    showRate: resueltas > 0 ? reunionesRealizadas / resueltas : funnel.showRate,
    closeRate: reunionesRealizadas > 0 ? funnel.ventasPagadas / reunionesRealizadas : funnel.closeRate,
  };
}
