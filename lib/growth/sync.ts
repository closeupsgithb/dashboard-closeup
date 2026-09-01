import { query } from "@/lib/growth/db";
import { madridDateOnly } from "@/lib/format";
import {
  fetchGrowthOpportunities,
  fetchAllGrowthCalendarEvents,
  fetchContactTasks,
  opportunityAsistioReunion,
  opportunityProximoPaso,
  eventIsCancelled,
  eventStatusLabel,
  FOLLOW_UP_REQUIRED_STEPS,
  GROWTH_STAGES,
  type GrowthOpportunity,
  type GhlCalendarEvent,
} from "@/lib/growth/ghl";
import { listClosers, upsertCloser } from "@/lib/growth/closers";

type FollowUpTaskInfo = { dueAt: string | null; title: string; taskId: string };

function isValidIso(value: string | null | undefined): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

// Devuelve la tarea PENDIENTE más próxima del contacto (fecha + título +
// id) — el id es lo que permite luego EDITAR esa misma tarea (PUT) en vez de
// crear una nueva cada vez que se revisa el follow-up desde el panel.
async function resolveFollowUpTask(contactId: string, proximoPaso: string | null): Promise<FollowUpTaskInfo | null> {
  if (!proximoPaso || !FOLLOW_UP_REQUIRED_STEPS.has(proximoPaso)) return null;
  try {
    const tasks = await fetchContactTasks(contactId);
    // dueDate llega tal cual de GHL, sin garantía de formato (a diferencia
    // de una columna timestamptz, que Postgres ya habría rechazado si
    // viniera mal). Las tareas con fecha ilegible se tratan como "sin
    // fecha" en vez de dejar pasar un valor que reviente el formateo más
    // adelante (caso real, Daniel, 2026-09-01) — no se descartan del todo:
    // siguen siendo la tarea pendiente más próxima si son la única.
    const pendientes = tasks
      .filter((t) => !t.completed)
      .sort((a, b) => {
        const at = isValidIso(a.dueDate) ? new Date(a.dueDate).getTime() : Infinity;
        const bt = isValidIso(b.dueDate) ? new Date(b.dueDate).getTime() : Infinity;
        return at - bt;
      });
    const next = pendientes[0];
    if (!next) return null;
    return { dueAt: isValidIso(next.dueDate) ? next.dueDate : null, title: next.title, taskId: next.id };
  } catch {
    // Una tarea que no se puede leer no debe romper la sincronización
    // entera — el lead simplemente cae en el cajón "Sin fecha".
    return null;
  }
}

// Ventana de barrido del calendario: desde que existe el pipeline GROWTH
// (2026-08-14, con margen) hasta 6 meses vista — cubre citas pasadas (para
// no-show/asistencia) y futuras (próximas reuniones, reunión 2).
const CALENDAR_LOOKBACK_START = new Date("2026-08-01T00:00:00Z").getTime();
const CALENDAR_LOOKAHEAD_END = Date.now() + 1000 * 60 * 60 * 24 * 180;

async function fetchEventsByContact(): Promise<Map<string, GhlCalendarEvent[]>> {
  const events = await fetchAllGrowthCalendarEvents(CALENDAR_LOOKBACK_START, CALENDAR_LOOKAHEAD_END);
  const byContact = new Map<string, GhlCalendarEvent[]>();
  for (const e of events) {
    const list = byContact.get(e.contactId) ?? [];
    list.push(e);
    byContact.set(e.contactId, list);
  }
  return byContact;
}

type ExistingOpportunityRow = {
  opportunity_id: string;
  entry_month: string;
  closer_id: string | null;
  pipeline_stage_id: string;
  status: string;
  asistio_reunion: string | null;
  proximo_paso: string | null;
};

async function logAudit(
  opportunityId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  actor: string
): Promise<void> {
  if (oldValue === newValue) return;
  await query`
    insert into growth_audit_log (opportunity_id, actor, field, old_value, new_value, sync_status)
    values (${opportunityId}, ${actor}, ${field}, ${oldValue}, ${newValue}, 'ok')
  `;
}

// Cualquier assignedUserId visto en GHL (opportunidad o cita) que no esté
// todavía en la tabla de closers se da de alta automáticamente en vez de
// perderse en un cajón "otros" — así nunca desaparece una asignación real, y
// Daniel solo tiene que ponerle nombre desde la gestión de closers, no
// crearlo desde cero.
async function ensureCloserExists(ghlUserId: string, knownIds: Set<string>): Promise<void> {
  if (knownIds.has(ghlUserId)) return;
  await upsertCloser({
    id: ghlUserId,
    displayName: `Closer sin nombre (${ghlUserId.slice(0, 6)})`,
    active: true,
    color: null,
    sortOrder: 999,
  });
  knownIds.add(ghlUserId);
}

function resolveClosingCloserId(o: GrowthOpportunity, activeEvent: GhlCalendarEvent | undefined): string | null {
  return activeEvent?.assignedUserId ?? o.assignedTo ?? null;
}

export type SyncResult = { procesadas: number; cambiosDetectados: number; errores: string[] };

// Un único punto que aplica el estado real de una oportunidad de GHL (+ sus
// citas) sobre la base local. Se usa tanto desde la reconciliación completa
// como desde una escritura puntual del dashboard (para reflejar de
// inmediato lo que GHL acaba de confirmar) — así no hay dos lógicas de
// upsert que puedan divergir.
async function syncOpportunityRecord(
  o: GrowthOpportunity,
  existingById: Map<string, ExistingOpportunityRow>,
  knownCloserIds: Set<string>,
  eventsByContact: Map<string, GhlCalendarEvent[]>
): Promise<boolean> {
  const existing = existingById.get(o.id);
  const entryMonth = existing?.entry_month ?? madridDateOnly(o.createdAt).slice(0, 7);
  // Se pasa siempre el valor vivo de GHL — es el COALESCE en el UPDATE de
  // abajo el que decide si se conserva el ya guardado o se acepta este
  // (nunca lo pisa una vez fijado). Evita depender de que existingById haya
  // cargado esta columna, que falló en la práctica al añadirla después de
  // que ya hubiera filas creadas: se quedaban en NULL para siempre porque
  // el UPSERT no las tocaba y "existing" nunca traía el campo.
  const entryAt = o.createdAt;

  const events = eventsByContact.get(o.contactId) ?? [];
  const activeEvents = events
    .filter((e) => !eventIsCancelled(e))
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const latestEvent = activeEvents[0];

  const closerId = resolveClosingCloserId(o, latestEvent);
  if (closerId) await ensureCloserExists(closerId, knownCloserIds);

  const asistioReunion = opportunityAsistioReunion(o);
  const proximoPaso = opportunityProximoPaso(o);
  const fechaReunionAgendada = latestEvent?.startTime ?? null;
  const followUpTask = await resolveFollowUpTask(o.contactId, proximoPaso);
  const followUpDueAt = followUpTask?.dueAt ?? null;
  const followUpTitle = followUpTask?.title ?? null;
  const followUpTaskId = followUpTask?.taskId ?? null;

  // Venta = entrada CONFIRMADA en la fase "Pagado", nunca el estado "Ganado"
  // por sí solo (regla explícita de Daniel, 2026-08-21). La fecha de cierre
  // es la PRIMERA vez que se ve en esa fase — el COALESCE en el UPDATE de
  // abajo es lo que garantiza que nunca se reescribe, aunque la oportunidad
  // salga y vuelva a entrar en Pagado, aunque lleguen webhooks duplicados, o
  // aunque se sincronice primero desde el dashboard y luego desde GHL.
  const pagadoCandidateAt = o.pipelineStageId === GROWTH_STAGES.pagado ? (o.lastStageChangeAt ?? new Date().toISOString()) : null;

  // Primer contacto = primera vez que se observa "Próximo paso" con un valor
  // real (no "No definido") — GHL no expone la fecha de cambio de un custom
  // field concreto, solo lastStageChangeAt (de FASE, no de campo), así que se
  // usa como mejor aproximación disponible, con la hora del sync como
  // respaldo — mismo patrón ya aceptado para pagado_confirmado_at. Congelado
  // (COALESCE) la primera vez: mide velocidad real de primer contacto del
  // setter, no se mueve si el próximo paso cambia después.
  const huboContacto = proximoPaso !== null && proximoPaso !== "No definido";
  const firstContactCandidateAt = huboContacto ? (o.lastStageChangeAt ?? new Date().toISOString()) : null;

  await query`
    insert into growth_opportunities (
      opportunity_id, contact_id, contact_name, company_name, phone, email,
      pipeline_stage_id, status, closer_id, entry_month, entry_at,
      asistio_reunion, proximo_paso, fecha_reunion_agendada, follow_up_due_at,
      follow_up_title, follow_up_task_id, pagado_confirmado_at, first_contact_at, last_synced_at
    ) values (
      ${o.id}, ${o.contactId}, ${o.contact?.name ?? null}, ${o.contact?.companyName ?? null},
      ${o.contact?.phone ?? null}, ${o.contact?.email ?? null},
      ${o.pipelineStageId}, ${o.status}, ${closerId}, ${entryMonth}, ${entryAt},
      ${asistioReunion}, ${proximoPaso}, ${fechaReunionAgendada}, ${followUpDueAt},
      ${followUpTitle}, ${followUpTaskId}, ${pagadoCandidateAt}, ${firstContactCandidateAt}, now()
    )
    on conflict (opportunity_id) do update set
      contact_name = excluded.contact_name,
      company_name = excluded.company_name,
      phone = excluded.phone,
      email = excluded.email,
      pipeline_stage_id = excluded.pipeline_stage_id,
      status = excluded.status,
      closer_id = excluded.closer_id,
      asistio_reunion = excluded.asistio_reunion,
      proximo_paso = excluded.proximo_paso,
      fecha_reunion_agendada = excluded.fecha_reunion_agendada,
      follow_up_due_at = excluded.follow_up_due_at,
      follow_up_title = excluded.follow_up_title,
      follow_up_task_id = excluded.follow_up_task_id,
      pagado_confirmado_at = coalesce(growth_opportunities.pagado_confirmado_at, excluded.pagado_confirmado_at),
      entry_at = coalesce(growth_opportunities.entry_at, excluded.entry_at),
      first_contact_at = coalesce(growth_opportunities.first_contact_at, excluded.first_contact_at),
      last_synced_at = now(),
      updated_at = now()
  `;

  let changed = false;
  if (existing) {
    const changes = [
      ["pipeline_stage_id", existing.pipeline_stage_id, o.pipelineStageId],
      ["status", existing.status, o.status],
      ["closer_id", existing.closer_id, closerId],
      ["asistio_reunion", existing.asistio_reunion, asistioReunion],
      ["proximo_paso", existing.proximo_paso, proximoPaso],
    ] as const;
    for (const [field, oldV, newV] of changes) {
      if (oldV !== newV) {
        changed = true;
        await logAudit(o.id, field, oldV, newV, "ghl_reconciliation");
      }
    }
  }

  // Citas: se procesan TODAS las vistas (incluidas canceladas/borradas) para
  // que la auditoría vea la transición, pero solo se calcula
  // meeting_number/is_active sobre las que siguen siendo una cita real.
  for (const e of events) {
    if (e.assignedUserId) await ensureCloserExists(e.assignedUserId, knownCloserIds);

    const existingAppt = await query<{ meeting_number: number; scheduled_at: string }>`
      select meeting_number, scheduled_at from growth_appointments where appointment_id = ${e.id}
    `;

    let meetingNumber: number;
    if (existingAppt.length > 0) {
      meetingNumber = existingAppt[0].meeting_number;
    } else {
      const maxRow = await query<{ max: number | null }>`
        select max(meeting_number) as max from growth_appointments where opportunity_id = ${o.id}
      `;
      meetingNumber = (maxRow[0]?.max ?? 0) + 1;
    }

    await query`
      insert into growth_appointments (
        opportunity_id, appointment_id, meeting_number, scheduled_at, original_scheduled_at,
        ghl_status, closer_id, source, updated_at
      ) values (
        ${o.id}, ${e.id}, ${meetingNumber}, ${e.startTime}, ${e.startTime},
        ${eventIsCancelled(e) ? "cancelled" : eventStatusLabel(e)}, ${e.assignedUserId}, 'ghl', now()
      )
      on conflict (appointment_id) do update set
        scheduled_at = excluded.scheduled_at,
        ghl_status = excluded.ghl_status,
        closer_id = excluded.closer_id,
        updated_at = now()
    `;
  }

  if (events.length > 0) {
    await query`update growth_appointments set is_active = false where opportunity_id = ${o.id}`;
    await query`
      update growth_appointments set is_active = true where id = (
        select id from growth_appointments
        where opportunity_id = ${o.id} and coalesce(ghl_status, '') <> 'cancelled'
        order by scheduled_at desc
        limit 1
      )
    `;
  }

  return changed;
}

// Idempotente: se puede llamar tantas veces como se quiera (carga de
// página, botón "Actualizar", futuro webhook) sin duplicar oportunidades ni
// citas — todo se identifica por opportunity_id/appointment_id reales de
// GHL, nunca por nombre/email/teléfono.
export async function reconcileGrowth(): Promise<SyncResult> {
  const closers = await listClosers();
  const knownCloserIds = new Set(closers.map((c) => c.id));

  const opportunities = await fetchGrowthOpportunities();
  const eventsByContact = await fetchEventsByContact();
  const existingRows = await query<ExistingOpportunityRow>`
    select opportunity_id, entry_month, closer_id, pipeline_stage_id, status, asistio_reunion, proximo_paso
    from growth_opportunities
  `;
  const existingById = new Map(existingRows.map((r) => [r.opportunity_id, r]));

  let cambiosDetectados = 0;
  const errores: string[] = [];

  for (const o of opportunities) {
    try {
      const changed = await syncOpportunityRecord(o, existingById, knownCloserIds, eventsByContact);
      if (changed) cambiosDetectados += 1;
    } catch (err) {
      errores.push(`${o.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Oportunidades que existían en Postgres (abiertas) pero ya NO aparecen en
  // la búsqueda de GHL — el contacto o la oportunidad se borró directamente
  // en GHL, sin pasar por Perdido/Abandonado. Sin esto se quedaban "vivas"
  // para siempre con su último estado conocido (bug real reportado por
  // Daniel: un contacto borrado del pipeline seguía en Follow-ups/Leads sin
  // reunión). Se marcan con un status LOCAL que GHL nunca escribe
  // (`eliminado_en_ghl`, distinto de lost/abandoned, que sí son decisiones
  // de negocio reales) para no confundir el motivo en la auditoría — nunca
  // se borra la fila ni su historial de citas/asistencia, solo deja de
  // contar como abierta (mismo criterio que ya aplican Perdido/Abandonado).
  // Solo se tocan las que seguían "open": una ya archivada (won/lost/
  // abandoned) que desaparezca de GHL no necesita reclasificarse.
  const fetchedIds = new Set(opportunities.map((o) => o.id));
  const desaparecidas = existingRows.filter((r) => r.status === "open" && !fetchedIds.has(r.opportunity_id));
  for (const r of desaparecidas) {
    await query`update growth_opportunities set status = 'eliminado_en_ghl', updated_at = now() where opportunity_id = ${r.opportunity_id}`;
    await logAudit(r.opportunity_id, "status", r.status, "eliminado_en_ghl", "ghl_reconciliation");
    cambiosDetectados += 1;
  }

  await query`
    insert into growth_sync_state (key, value, updated_at) values ('last_reconciliation', now()::text, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;

  return { procesadas: opportunities.length, cambiosDetectados, errores };
}

// Re-sincroniza una única oportunidad justo después de escribir en GHL
// desde el dashboard — para que la respuesta al usuario ya refleje lo que
// GHL confirmó de verdad, sin esperar al siguiente ciclo de reconciliación
// completa. Se apoya en el mismo endpoint de búsqueda que la reconciliación
// completa (filtrando por id) en vez del GET de una sola oportunidad, cuya
// forma de respuesta para "calenders" no está verificada — más peticiones,
// pero sin asumir un contrato de API no comprobado.
export async function syncSingleOpportunity(opportunityId: string): Promise<void> {
  const closers = await listClosers();
  const knownCloserIds = new Set(closers.map((c) => c.id));
  const existingRows = await query<ExistingOpportunityRow>`
    select opportunity_id, entry_month, closer_id, pipeline_stage_id, status, asistio_reunion, proximo_paso
    from growth_opportunities where opportunity_id = ${opportunityId}
  `;
  const existingById = new Map(existingRows.map((r) => [r.opportunity_id, r]));
  const all = await fetchGrowthOpportunities();
  const o = all.find((x) => x.id === opportunityId);
  if (!o) throw new Error(`Oportunidad ${opportunityId} no encontrada en el pipeline GROWTH`);
  const eventsByContact = await fetchEventsByContact();
  await syncOpportunityRecord(o, existingById, knownCloserIds, eventsByContact);
}

export async function getLastReconciliation(): Promise<string | null> {
  const rows = await query<{ value: string }>`select value from growth_sync_state where key = 'last_reconciliation'`;
  return rows[0]?.value ?? null;
}
