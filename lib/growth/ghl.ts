import { GHL_BASE, LOCATION_ID, authHeaders, MissingCredentialsError } from "@/lib/ghl";

// Todos los IDs de aquí abajo se validaron contra la API real de GHL el
// 2026-08-20 (opportunities/get-pipelines, locations/get-custom-fields) — no
// son nombres visibles adivinados. El pipeline GROWTH se creó el 2026-08-14
// y tenía solo 3 oportunidades en ese momento (2 de ellas contactos de
// prueba E2E marcados "TEST - No usar") — prácticamente sin histórico real
// todavía, lo que reduce el riesgo de migración pero también significa que
// estos mapeos no están validados contra volumen real de producción.
export const GROWTH_PIPELINE_ID = "Zn90LJV3N0dNlByaZ1vo";

export const GROWTH_STAGES = {
  nuevoCualificado: "267658fd-26fb-4976-9cb9-c8308fff8d20", // Nuevo cualificado | Sin agenda
  agendadoPendiente: "ac3355de-a3d1-412a-8db0-75bc2e4276b8", // Agendado | Pendiente confirmación
  agendadoConfirmado: "74566df6-7f7d-4df7-a849-89689626b206", // Agendado | Confirmado
  solicitaReagendar: "072230fe-3185-4871-a785-d47c028985d8", // Solicita Reagendar
  noShowRecuperacion: "a180c129-b51c-4543-b275-de7934342d1f", // No-show | Recuperación
  reunionRealizada: "b5e8900d-65b1-4174-9f10-ce0a68fa896c", // Reunión realizada | Interesado
  followUpCall2: "32634bf6-7aee-44f2-a9e7-196ee9e3f1d2", // Follow-up / Call 2
  pagado: "4082dbca-df89-4ff0-9dd9-52b3986ee360", // Pagado
} as const;

export const GROWTH_STAGE_NAMES: Record<string, string> = {
  [GROWTH_STAGES.nuevoCualificado]: "Nuevo cualificado | Sin agenda",
  [GROWTH_STAGES.agendadoPendiente]: "Agendado | Pendiente confirmación",
  [GROWTH_STAGES.agendadoConfirmado]: "Agendado | Confirmado",
  [GROWTH_STAGES.solicitaReagendar]: "Solicita Reagendar",
  [GROWTH_STAGES.noShowRecuperacion]: "No-show | Recuperación",
  [GROWTH_STAGES.reunionRealizada]: "Reunión realizada | Interesado",
  [GROWTH_STAGES.followUpCall2]: "Follow-up / Call 2",
  [GROWTH_STAGES.pagado]: "Pagado",
};

export const AGENDADO_STAGE_IDS = new Set<string>([GROWTH_STAGES.agendadoPendiente, GROWTH_STAGES.agendadoConfirmado]);

// Confirmado por API real el 2026-08-20 (GET /calendars/, no adivinado):
// cada closer tiene su PROPIO calendario, con él mismo como único
// teamMember — NO comparten uno común. Reproducido el error real de GHL
// ("The user id not part of calendar team") al intentar crear una cita para
// Iván en el calendario de Daniel, lo que confirma esta separación. Cada
// entrada del mapa es el calendario donde ESE closer sí puede recibir citas.
export const CLOSER_CALENDAR_MAP: Record<string, string> = {
  Nalb9lAN8S9Gzr9RLTcI: "xiEtpyAXe41W1O029LSs", // Daniel von Zedlitz -> "Estrategia Digital"
  VU25EtZCt8PuhTZnfA1v: "Gd3eofu6Z1dJwLu6X5Na", // Alejandro -> "Alejandro Setter-Closer"
  "3EESUj1Gk1ikcfHr4Owf": "LbbIFiBhBvgmViph0SCd", // Iván -> "Ivan CloseUp"
};
// Calendario por defecto solo para el barrido de reconciliación cuando un
// closer no está (todavía) en el mapa de arriba — nunca se usa para CREAR
// una cita nueva sin conocer el calendario real del closer asignado.
export const GROWTH_DEFAULT_CALENDAR_ID = CLOSER_CALENDAR_MAP.Nalb9lAN8S9Gzr9RLTcI;

export function calendarIdForCloser(closerId: string | null | undefined): string | null {
  if (!closerId) return null;
  return CLOSER_CALENDAR_MAP[closerId] ?? null;
}

// IDs reales de custom fields (locations/get-custom-fields, model=opportunity).
export const GROWTH_FIELDS = {
  asistioReunion: "J54D8m3778Bu5Vninimm",
  fechaReunionAgendada: "ZYQr2nc7006KhRrJBCzQ",
  proximoPaso: "cI1rLkg3ODDh8kN8Bkzd",
  pdfPrecall: "l68qJ8cHzcCrq5Tysbfd",
  decisionMaker: "ulgo0TCea4ihr3X2bfgq",
  objecionPrincipal: "YCgwl33fj56uASRGyUih",
} as const;

// Valores reales de los picklist de GHL (confirmados por API) — no inventar
// variantes de texto: si no coincide exactamente, GHL rechaza o ignora el valor.
export const ASISTIO_REUNION_VALUES = ["Sí", "No", "Pendiente"] as const;
export const PROXIMO_PASO_VALUES = [
  "Call 2",
  "Hablar con socio / mujer",
  "Follow-up",
  "Enviar propuesta",
  "Firmar contrato",
  "Pago",
  "No definido",
] as const;

// Próximos pasos que implican seguimiento con fecha propia (no una reunión
// — "Call 2" no entra aquí porque genera una cita real en la agenda, no una
// fila de la cola de Follow-ups). Se usa tanto para decidir qué leads
// consultan su tarea de GHL (lib/growth/sync.ts) como para construir la
// cola de Follow-ups (lib/growth/metrics.ts) — una sola fuente de verdad.
export const FOLLOW_UP_REQUIRED_STEPS = new Set<string>([
  "Follow-up",
  "Enviar propuesta",
  "Hablar con socio / mujer",
  "Firmar contrato",
  "Pago",
]);

// La forma real de este objeto CAMBIA según de dónde venga (verificado el
// 2026-08-20 contra la API real con el mismo GHL_PRIVATE_TOKEN de este
// proyecto): embebido en opportunities/search (getCalendarEvents=true, lo
// que usa fetchGrowthOpportunities) solo trae id/contactId/startTime/
// endTime/status/assignedUserId/calendarId/appoinmentStatus (sic, typo real
// de GHL) — NO trae "deleted", "title", "dateAdded" ni "rescheduledAt", que
// sí aparecen en el endpoint independiente /calendars/events. Por eso todos
// los campos "extra" son opcionales aquí: no asumir que existen.
export type GhlCalendarEvent = {
  id: string;
  contactId: string;
  assignedUserId: string | null;
  startTime: string;
  endTime: string;
  status?: string; // "booked" | "cancelled" | ... (visto en la forma embebida)
  appoinmentStatus?: string; // sic — typo real de la API de GHL
  appointmentStatus?: string; // variante bien escrita, vista en /calendars/events
  calendarId: string;
  title?: string;
  deleted?: boolean;
  dateAdded?: string;
  rescheduledAt?: string;
};

export function eventIsCancelled(e: GhlCalendarEvent): boolean {
  if (e.deleted) return true;
  if (e.status === "cancelled") return true;
  const apptStatus = e.appoinmentStatus ?? e.appointmentStatus;
  return apptStatus === "cancelled";
}

export function eventStatusLabel(e: GhlCalendarEvent): string {
  return e.appoinmentStatus ?? e.appointmentStatus ?? e.status ?? "desconocido";
}

export type GhlCustomFieldValue = { id: string; fieldValueString?: string; fieldValue?: unknown };

export type GrowthOpportunity = {
  id: string;
  name: string;
  contactId: string;
  pipelineStageId: string;
  status: string; // open | won | lost | abandoned
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  lastStageChangeAt?: string;
  customFields: GhlCustomFieldValue[] | null; // visto null en real para alguna oportunidad puntual, no solo []
  contact?: { name: string; companyName: string | null; email?: string; phone?: string };
  calenders?: GhlCalendarEvent[];
};

// customFields llega null en la respuesta real de opportunities/search para
// alguna oportunidad puntual (comprobado en real, 2026-08-27: una oportunidad
// nueva de un contacto reciclado lo devolvió así) — no siempre es un array
// vacío. Sin este guard, `.find` sobre null tiraba una excepción que
// reconcileGrowth() capturaba en silencio (errores.push), dejando a esa
// oportunidad completamente fuera de Postgres y del dashboard, aunque
// siguiera abierta y real en GHL.
function customFieldValue(o: GrowthOpportunity, fieldId: string): string | null {
  const f = o.customFields?.find((c) => c.id === fieldId);
  return f?.fieldValueString ?? null;
}

export function opportunityAsistioReunion(o: GrowthOpportunity): string | null {
  return customFieldValue(o, GROWTH_FIELDS.asistioReunion);
}
export function opportunityProximoPaso(o: GrowthOpportunity): string | null {
  return customFieldValue(o, GROWTH_FIELDS.proximoPaso);
}

type SearchResponse = { opportunities?: GrowthOpportunity[]; meta?: { startAfter?: string; startAfterId?: string } };

// getCalendarEvents=true sigue pidiéndose por si acaso, pero el campo
// "calenders" embebido NO se usa como fuente de citas (ver
// fetchGrowthCalendarEvents) — comprobado que no refleja citas creadas por
// API, solo las creadas desde la ficha de la oportunidad en GHL.
export async function fetchGrowthOpportunities(): Promise<GrowthOpportunity[]> {
  const headers = authHeaders();
  const results: GrowthOpportunity[] = [];
  let startAfter: string | undefined;
  let startAfterId: string | undefined;

  for (let page = 0; page < 50; page++) {
    const url = new URL(`${GHL_BASE}/opportunities/search`);
    url.searchParams.set("location_id", LOCATION_ID);
    url.searchParams.set("pipeline_id", GROWTH_PIPELINE_ID);
    url.searchParams.set("limit", "100");
    url.searchParams.set("status", "all");
    url.searchParams.set("getCalendarEvents", "true");
    if (startAfter) url.searchParams.set("startAfter", startAfter);
    if (startAfterId) url.searchParams.set("startAfterId", startAfterId);

    const res = await fetch(url.toString(), { headers, cache: "no-store" });
    const json = (await res.json()) as SearchResponse;
    if (!res.ok) throw new Error(`GHL ${res.status} (growth search): ${JSON.stringify(json)}`);

    const opportunities = json.opportunities ?? [];
    results.push(...opportunities);
    if (opportunities.length < 100) break;
    startAfter = json.meta?.startAfter;
    startAfterId = json.meta?.startAfterId;
    if (!startAfter && !startAfterId) break;
  }
  return results;
}

// Fuente de verdad real para las citas — NO el campo embebido "calenders" de
// opportunities/search. Verificado el 2026-08-20 con una prueba real: una
// cita creada por API con el contactId correcto NO aparece en "calenders"
// embebido (GHL solo la enlaza así cuando la cita se crea desde la propia
// ficha de la oportunidad, "createdBy.source: opportunity_page"), pero SÍ
// aparece siempre en /calendars/events — el mismo endpoint que ya usaba de
// forma fiable el pipeline FB Form Nativo antiguo. Devuelve además una forma
// más rica (deleted/dateAdded/rescheduledAt/title), a diferencia del embebido.
export async function fetchGrowthCalendarEvents(calendarId: string, startTimeMs: number, endTimeMs: number): Promise<GhlCalendarEvent[]> {
  const headers = authHeaders();
  const url = new URL(`${GHL_BASE}/calendars/events`);
  url.searchParams.set("locationId", LOCATION_ID);
  url.searchParams.set("calendarId", calendarId);
  url.searchParams.set("startTime", String(startTimeMs));
  url.searchParams.set("endTime", String(endTimeMs));
  const res = await fetch(url.toString(), { headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(`GHL ${res.status} (growth calendar events ${calendarId}): ${JSON.stringify(json)}`);
  return (json.events ?? []) as GhlCalendarEvent[];
}

// Barre TODOS los calendarios de closers conocidos a la vez — necesario
// porque cada uno tiene el suyo propio (ver CLOSER_CALENDAR_MAP).
export async function fetchAllGrowthCalendarEvents(startTimeMs: number, endTimeMs: number): Promise<GhlCalendarEvent[]> {
  const calendarIds = [...new Set(Object.values(CLOSER_CALENDAR_MAP))];
  const perCalendar = await Promise.all(calendarIds.map((id) => fetchGrowthCalendarEvents(id, startTimeMs, endTimeMs)));
  return perCalendar.flat();
}

export type GhlTask = { id: string; title: string; dueDate: string; completed: boolean; contactId: string };

// No existe un campo custom de "fecha de seguimiento" en GHL (comprobado en
// locations/get-custom-fields) — se reutilizan las Tareas nativas del
// contacto (con due date real) en vez de inventar un campo nuevo.
export async function fetchContactTasks(contactId: string): Promise<GhlTask[]> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tasks`, { headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(`GHL ${res.status} (tasks ${contactId}): ${JSON.stringify(json)}`);
  return (json.tasks ?? []) as GhlTask[];
}

// Crea la tarea nativa de GHL que sirve de fuente de verdad para la fecha y
// la acción concreta de un follow-up (ver comentario de fetchContactTasks —
// no existe campo custom para esto). El título de la tarea ES la "acción
// concreta": se escribe libremente desde el panel de revisión, no hay un
// segundo campo paralelo que pueda desincronizarse. Verificado con una
// prueba real de creación+borrado sobre el contacto de pruebas el
// 2026-08-20 (POST /contacts/{id}/tasks devuelve 201 con {task:{id,...}}).
export async function createContactTask(contactId: string, params: { title: string; dueDate: string }): Promise<{ id: string }> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tasks`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title: params.title, dueDate: params.dueDate, completed: false }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GHL ${res.status} (createContactTask): ${JSON.stringify(json)}`);
  return { id: json.task?.id ?? json.id ?? "" };
}

// Actualiza una tarea existente (fecha y/o completado) en vez de crear una
// nueva — evita el problema documentado en DASHBOARD_CONTEXT.md §7 (varias
// tareas de follow-up acumulándose sin completar la anterior). Solo se envían
// los campos que cambian.
export async function updateContactTask(
  contactId: string,
  taskId: string,
  params: { title?: string; dueDate?: string; completed?: boolean }
): Promise<void> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tasks/${taskId}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`GHL ${res.status} (updateContactTask): ${JSON.stringify(json)}`);
  }
}

// Búsqueda de contactos por nombre/empresa — usada solo para comprobar
// idempotencia antes de crear un contacto de prueba nuevo (evitar duplicarlo
// si ya existe uno con la misma clave de identificación).
export async function searchContacts(query: string): Promise<{ id: string; companyName: string | null; contactName: string | null }[]> {
  const headers = authHeaders();
  const url = new URL(`${GHL_BASE}/contacts/`);
  url.searchParams.set("locationId", LOCATION_ID);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "20");
  const res = await fetch(url.toString(), { headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(`GHL ${res.status} (searchContacts): ${JSON.stringify(json)}`);
  const contacts = (json.contacts ?? []) as { id: string; companyName?: string | null; contactName?: string | null; firstName?: string; lastName?: string }[];
  return contacts.map((c) => ({
    id: c.id,
    companyName: c.companyName ?? null,
    contactName: c.contactName ?? [c.firstName, c.lastName].filter(Boolean).join(" ") ?? null,
  }));
}

// Crea un contacto de prueba SIN teléfono ni correo cuando no hay un
// destinatario interno autorizado — nunca se inventa un canal de contacto
// (regla explícita: ningún workflow de mensajería puede alcanzar un contacto
// sin email/teléfono, así que crearlo así es la opción más segura).
export async function createContact(params: { firstName: string; lastName: string; companyName: string; source?: string }): Promise<{ id: string }> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      locationId: LOCATION_ID,
      firstName: params.firstName,
      lastName: params.lastName,
      companyName: params.companyName,
      source: params.source,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GHL ${res.status} (createContact): ${JSON.stringify(json)}`);
  return { id: json.contact?.id ?? json.id ?? "" };
}

// Crea una oportunidad nueva en un pipeline dado. No se usa en el flujo
// normal del dashboard (los leads reales entran a GHL desde fuera, nunca se
// crean desde aquí) — existe solo para poder montar una oportunidad de
// prueba controlada de extremo a extremo desde localhost.
export async function createOpportunity(params: {
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
  assignedTo?: string | null;
  status?: "open";
}): Promise<{ id: string }> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/opportunities/`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      pipelineId: params.pipelineId,
      locationId: LOCATION_ID,
      name: params.name,
      pipelineStageId: params.pipelineStageId,
      status: params.status ?? "open",
      contactId: params.contactId,
      assignedTo: params.assignedTo ?? undefined,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GHL ${res.status} (createOpportunity): ${JSON.stringify(json)}`);
  return { id: json.opportunity?.id ?? json.id ?? "" };
}

export async function fetchGrowthOpportunity(opportunityId: string): Promise<GrowthOpportunity> {
  const headers = authHeaders();
  const url = new URL(`${GHL_BASE}/opportunities/${opportunityId}`);
  url.searchParams.set("getCalendarEvents", "true");
  const res = await fetch(url.toString(), { headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(`GHL ${res.status} (opportunity ${opportunityId}): ${JSON.stringify(json)}`);
  return (json.opportunity ?? json) as GrowthOpportunity;
}

export async function updateOpportunityStage(opportunityId: string, stageId: string): Promise<void> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ pipelineId: GROWTH_PIPELINE_ID, pipelineStageId: stageId }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`GHL ${res.status}: ${JSON.stringify(json)}`);
  }
}

export async function updateOpportunityStatus(opportunityId: string, status: "won" | "lost" | "abandoned" | "open"): Promise<void> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`GHL ${res.status}: ${JSON.stringify(json)}`);
  }
}

export async function updateOpportunityAssignedTo(opportunityId: string, ghlUserId: string | null): Promise<void> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ assignedTo: ghlUserId }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`GHL ${res.status}: ${JSON.stringify(json)}`);
  }
}

export type CustomFieldUpdate = { fieldId: string; value: string };

export async function updateOpportunityCustomFields(opportunityId: string, updates: CustomFieldUpdate[]): Promise<void> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ customFields: updates.map((u) => ({ id: u.fieldId, field_value: u.value })) }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`GHL ${res.status}: ${JSON.stringify(json)}`);
  }
}

// Crea o reprograma una cita real del calendario de GHL. Si se pasa
// appointmentId, se actualiza esa cita (PUT); si no, se crea una nueva
// (POST) — la que decide cuál de las dos rutas usar es quien llama, según
// si ya existe una cita activa para esta reunión.
export async function upsertAppointment(params: {
  appointmentId?: string;
  contactId: string;
  calendarId: string;
  assignedUserId: string;
  startTime: string; // ISO 8601 con offset
  endTime: string;
  title: string;
}): Promise<{ id: string }> {
  const headers = authHeaders();
  const body = JSON.stringify({
    locationId: LOCATION_ID,
    calendarId: params.calendarId,
    contactId: params.contactId,
    assignedUserId: params.assignedUserId,
    startTime: params.startTime,
    endTime: params.endTime,
    title: params.title,
    appointmentStatus: "confirmed",
    ignoreFreeSlotValidation: true,
  });
  const url = params.appointmentId
    ? `${GHL_BASE}/calendars/events/appointments/${params.appointmentId}`
    : `${GHL_BASE}/calendars/events/appointments`;
  const res = await fetch(url, {
    method: params.appointmentId ? "PUT" : "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GHL ${res.status} (upsertAppointment): ${JSON.stringify(json)}`);
  return { id: json.id ?? params.appointmentId ?? "" };
}

export { MissingCredentialsError };
