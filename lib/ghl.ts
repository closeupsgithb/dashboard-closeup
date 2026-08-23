export const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export const LOCATION_ID = "gNZGfOheofHgZtuYObm7";

// CORREGIDO 2026-07-28: la Fase 2 concluyó que "FB Form Nativo || Pipeline"
// eran leads de particulares — conclusión errónea, basada en una muestra
// insuficiente. Evidencia real que la desmiente: el contenido del anuncio que
// origina estas oportunidades es "3-5 Reformas" (consigue 3-5 reformas al
// mes — un value prop para un negocio, no un particular), varias tienen razón
// social real (Grupomayna7 S.L, Cbc inter, FlatPass...), y las fases del
// pipeline (Reunión → No Asiste → 25%/50%/75% → Contrato enviado → Cliente
// cerrado) son un ciclo de venta B2B, no un embudo de particulares pidiendo
// presupuesto. Confirmado además con un caso real: Juan Pons / Urban
// solutions group tiene una oportunidad en este pipeline (llegó a "Cliente
// cerrado") y OTRA en Onboarding con el mismo contactId — son la misma
// persona pasando de prospecto a cliente. "Onboarding" son los clientes ya
// cerrados — el pago ocurre al entrar en la fase "3.-(Si pago) Agendar
// reunión". "FB Form Nativo" son los prospectos de ese mismo embudo que
// todavía no han cerrado.
export const PIPELINES = {
  onboarding: {
    id: "24qvnC75Mxwh1ZnRKApe",
    stages: {
      pagoAgendarReunion: "11153e22-f2a2-4bd9-8ab6-6f8c960dff4e",
      campanaLanzada: "2f842576-cba2-4442-b714-460ac31ece12",
    },
  },
  fbFormNativo: {
    id: "BF2Ap1zJkPjLJ2gtqEf5",
    stages: {
      reunion: "0d7b68c5-5d88-4024-8945-d28bf8db88b5",
      noAsiste: "38754295-8685-4f84-88ee-cdfaaceb076a",
      veinticincoPorciento: "3f479ffd-ee28-40f1-9e08-3f85df10749c",
      cincuentaPorciento: "a4fa9b6e-4b2b-4211-a7eb-197cda156a2e",
      setentaycincoPorciento: "f5508e94-8bc1-40cf-afb5-0cfd0a7630ed",
      contratoEnviado: "ec974fc7-0d76-47be-b503-ece3cf2150e7",
      clienteCerrado: "905fc52d-94d3-4c4b-8690-69f93ceec203",
    },
  },
  // "Agosto II FB Form Nativo || Pipeline" — creado por Daniel el 2026-07-30
  // como continuación de "FB Form Nativo" a partir de agosto. Confirmado con
  // la API real: es un clon estructural exacto (mismos 13 nombres de fase,
  // mismo orden, mismas probabilidades) — solo cambian los ids de pipeline y
  // de fase, por eso no hay ninguna ambigüedad de mapeo que preguntar.
  fbFormNativoAgosto: {
    id: "yBbQHzclrO3XVP6FVwnB",
    stages: {
      reunion: "7b8fcd95-bfed-4dcd-8724-dc503417c5e7",
      noAsiste: "169ddb94-fdd7-478b-b59d-3556e5b0ac1e",
      veinticincoPorciento: "a27a6182-330a-45bb-8067-9027b1cdd1e0",
      cincuentaPorciento: "50bcff5e-0978-4196-b3e0-e04b7d798b22",
      setentaycincoPorciento: "78fe0ce0-74bd-479b-9ffb-d081e08438ed",
      contratoEnviado: "dda75e83-a783-4ace-9ff1-4c9cf3e64c37",
      clienteCerrado: "0110ea90-1c6a-4960-9b58-6a6f9c45244b",
    },
  },
} as const;

// Todos los pipelines de prospección "FB Form Nativo" que existen a la vez
// (el histórico de antes de agosto y su continuación) — todo lo que depende
// de este embudo (reuniones agendadas/asistidas, show rate, coste por
// reunión, el desglose por closer) recorre esta lista entera, nunca un solo
// pipeline hardcodeado, para que una secuencia nueva del mismo tipo se sume
// sin perder ni duplicar el histórico de la anterior.
const FB_FORM_NATIVO_PIPELINES = [PIPELINES.fbFormNativo, PIPELINES.fbFormNativoAgosto] as const;

// Fases posteriores a la primera toma de contacto (excluye Nuevo Lead META /
// Día 1-3 / Re-contactar / No contesta, que son nutrición previa a que
// exista una reunión) — es sobre estas sobre las que se calculan reuniones
// agendadas/asistidas, en CUALQUIERA de los pipelines de la lista de arriba.
const FB_FORM_NATIVO_POST_MEETING_TARGETS: { pipelineId: string; stageId: string }[] = FB_FORM_NATIVO_PIPELINES.flatMap(
  (p) => Object.values(p.stages).map((stageId) => ({ pipelineId: p.id, stageId }))
);

export const REUNION_STAGE_IDS = new Set<string>(FB_FORM_NATIVO_PIPELINES.map((p) => p.stages.reunion));
export const NO_ASISTE_STAGE_IDS = new Set<string>(FB_FORM_NATIVO_PIPELINES.map((p) => p.stages.noAsiste));
export const ADVANCED_STAGE_IDS = new Set<string>(
  FB_FORM_NATIVO_PIPELINES.flatMap((p) => [
    p.stages.veinticincoPorciento,
    p.stages.cincuentaPorciento,
    p.stages.setentaycincoPorciento,
    p.stages.contratoEnviado,
    p.stages.clienteCerrado,
  ])
);

class MissingCredentialsError extends Error {
  constructor() {
    super("MISSING_CREDENTIALS");
  }
}

export function authHeaders(): Record<string, string> {
  const token = process.env.GHL_PRIVATE_TOKEN;
  if (!token) {
    throw new MissingCredentialsError();
  }
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_API_VERSION,
  };
}

export type GhlAttribution = {
  isFirst?: boolean;
  isLast?: boolean;
  utmCampaign?: string;
  utmCampaignId?: string;
  medium?: string;
  referrer?: string;
};

export type GhlOpportunity = {
  id: string;
  name: string;
  contactId: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue: number;
  createdAt: string;
  updatedAt: string;
  lastStageChangeAt?: string;
  contact?: { name: string; companyName: string | null };
  attributions?: GhlAttribution[];
};

// La atribución de primer toque (isFirst) identifica de qué campaña vino
// realmente el contacto — necesario para CAC/ROAS, que solo deben contar el
// gasto/ingreso de la campaña propia de captación (ver OWN_ACQUISITION_CAMPAIGN_ID
// en lib/metaAds.ts), no del total de la cuenta.
export function getFirstTouchCampaignId(opportunity: GhlOpportunity): string | null {
  const first = opportunity.attributions?.find((a) => a.isFirst);
  return first?.utmCampaignId ?? null;
}

type SearchResponse = {
  opportunities?: GhlOpportunity[];
  meta?: { startAfter?: string; startAfterId?: string };
};

async function searchOpportunities(pipelineId: string, stageId?: string): Promise<GhlOpportunity[]> {
  const headers = authHeaders();
  const results: GhlOpportunity[] = [];
  let startAfter: string | undefined;
  let startAfterId: string | undefined;

  // Tope defensivo de 50 páginas (5000 oportunidades) — muy por encima del
  // volumen real de la cuenta, solo para no encadenar peticiones sin fin si la
  // paginación de la API no termina de cortar nunca.
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${GHL_BASE}/opportunities/search`);
    url.searchParams.set("location_id", LOCATION_ID);
    url.searchParams.set("pipeline_id", pipelineId);
    url.searchParams.set("limit", "100");
    url.searchParams.set("status", "all");
    if (stageId) url.searchParams.set("pipeline_stage_id", stageId);
    if (startAfter) url.searchParams.set("startAfter", startAfter);
    if (startAfterId) url.searchParams.set("startAfterId", startAfterId);

    const res = await fetch(url.toString(), { headers, cache: "no-store" });
    const json = (await res.json()) as SearchResponse;
    if (!res.ok) {
      throw new Error(`GHL ${res.status} (${pipelineId}): ${JSON.stringify(json)}`);
    }

    const opportunities = json.opportunities ?? [];
    results.push(...opportunities);

    if (opportunities.length < 100) break;
    startAfter = json.meta?.startAfter;
    startAfterId = json.meta?.startAfterId;
    if (!startAfter && !startAfterId) break;
  }

  return results;
}

export async function fetchOnboardingOpportunities(): Promise<GhlOpportunity[]> {
  return searchOpportunities(PIPELINES.onboarding.id);
}

// Se consulta fase por fase (en vez de traer las ~991 del pipeline entero)
// para no arrastrar las fases de nutrición temprana (Nuevo Lead META, Día
// 1-3, Re-contactar, No contesta), que no aportan nada a reuniones
// agendadas/asistidas y multiplicarían por 4 el volumen a paginar. Recorre
// TODOS los pipelines "FB Form Nativo" a la vez (el histórico + su
// continuación) — un mismo contacto no puede duplicarse entre ellos porque
// cada oportunidad es un registro propio con su propio pipelineId; si un
// contacto se movió de uno a otro, su oportunidad antigua se queda donde
// estaba (histórico) y la nueva se cuenta en el pipeline nuevo, sin solape.
export async function fetchFbFormNativoPostMeetingOpportunities(): Promise<GhlOpportunity[]> {
  const results = await Promise.all(
    FB_FORM_NATIVO_POST_MEETING_TARGETS.map(({ pipelineId, stageId }) => searchOpportunities(pipelineId, stageId))
  );
  return results.flat();
}

// Calendarios reales de reserva de esta location con eventos de la campaña
// CBO_LEADS_REFOR (confirmado consultando /calendars/events uno por uno el
// 2026-07-29). "Estrategia Digital - Meta" y el id de "ONBOARDING" leído del
// panel de GHL no tienen eventos / no existen para esta cuenta — no se
// consultan. El "assignedUserId" de la OPORTUNIDAD no sirve para identificar
// al closer (no coincide con quién dio la reunión); el que sí sirve es el
// "assignedUserId" del EVENTO de calendario — confirmado: cada uno de estos
// calendarios tiene un único assignedUserId consistente en todos sus eventos.
const CLOSER_CALENDAR_IDS = [
  "WycyPdupSZSVg7yZx1a1", // Daniel Von Zedlitz's Personal Calendar
  "xiEtpyAXe41W1O029LSs", // Estrategia Digital
  "Gd3eofu6Z1dJwLu6X5Na", // Alejandro Setter - Closer
  "LbbIFiBhBvgmViph0SCd", // Ivan CloseUp
  "pq0tQYhinGV1OE3PvEb9", // CLOSEUP REUNIONES
] as const;

// assignedUserId del EVENTO de calendario -> nombre del closer. Confirmado
// con Daniel el 2026-07-29 cruzando cada calendario nombrado con su
// assignedUserId real. El resto de ids que aparecen (en otros contextos,
// como el assignedUserId de la propia oportunidad) se agrupan como "Otros
// closers" — Daniel confirmó que no hace falta desglosarlos uno a uno.
const CLOSER_NAMES: Record<string, string> = {
  Nalb9lAN8S9Gzr9RLTcI: "Daniel von Zedlitz",
  VU25EtZCt8PuhTZnfA1v: "Alejandro",
  "3EESUj1Gk1ikcfHr4Owf": "Iván",
};
export const OTHER_CLOSERS_LABEL = "Otros closers";

export function resolveCloserName(assignedUserId: string | null | undefined): string {
  if (!assignedUserId) return "Sin asignar";
  return CLOSER_NAMES[assignedUserId] ?? OTHER_CLOSERS_LABEL;
}

export type CalendarMeeting = {
  contactId: string;
  closer: string;
  startTime: string;
  appointmentStatus: string;
  calendarId: string;
};

type CalendarEventsResponse = { events?: RawCalendarEvent[] };
type RawCalendarEvent = {
  contactId: string;
  assignedUserId?: string;
  startTime: string;
  appointmentStatus: string;
  calendarId: string;
};

async function fetchCalendarEvents(calendarId: string, startTimeMs: number, endTimeMs: number): Promise<RawCalendarEvent[]> {
  const headers = authHeaders();
  const url = new URL(`${GHL_BASE}/calendars/events`);
  url.searchParams.set("locationId", LOCATION_ID);
  url.searchParams.set("calendarId", calendarId);
  url.searchParams.set("startTime", String(startTimeMs));
  url.searchParams.set("endTime", String(endTimeMs));

  const res = await fetch(url.toString(), { headers, cache: "no-store" });
  const json = (await res.json()) as CalendarEventsResponse;
  if (!res.ok) {
    throw new Error(`GHL ${res.status} (calendar ${calendarId}): ${JSON.stringify(json)}`);
  }
  return json.events ?? [];
}

// Un contacto puede tener varias citas (reprogramaciones) — se toma la más
// reciente por startTime como la reunión real de referencia.
export async function fetchLatestMeetingByContact(
  startTimeMs: number,
  endTimeMs: number
): Promise<Map<string, CalendarMeeting>> {
  const perCalendar = await Promise.all(
    CLOSER_CALENDAR_IDS.map((calendarId) => fetchCalendarEvents(calendarId, startTimeMs, endTimeMs))
  );

  const byContact = new Map<string, CalendarMeeting>();
  for (const events of perCalendar) {
    for (const e of events) {
      const meeting: CalendarMeeting = {
        contactId: e.contactId,
        closer: resolveCloserName(e.assignedUserId),
        startTime: e.startTime,
        appointmentStatus: e.appointmentStatus,
        calendarId: e.calendarId,
      };
      const existing = byContact.get(e.contactId);
      if (!existing || new Date(meeting.startTime).getTime() > new Date(existing.startTime).getTime()) {
        byContact.set(e.contactId, meeting);
      }
    }
  }
  return byContact;
}

export async function fetchOpportunity(opportunityId: string): Promise<GhlOpportunity> {
  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, { headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GHL ${res.status} (opportunity ${opportunityId}): ${JSON.stringify(json)}`);
  }
  return (json.opportunity ?? json) as GhlOpportunity;
}

export type MoveToNoAsisteResult = { moved: boolean; motivo?: string };

// Al marcar "No" manualmente en el dashboard, se refleja en GHL moviendo la
// oportunidad a la fase "No Asiste" — pedido explícito de Daniel para no
// tener que ir a moverla a mano. Se lee la fase Y el pipeline ACTUALES de la
// oportunidad desde GHL justo antes de escribir (no se confía en lo que
// mande el navegador), y se usa el "No Asiste" del MISMO pipeline en el que
// ya está (histórico o su continuación) — nunca se cambia de pipeline al
// escribir. No se retrocede una oportunidad que ya avanzó a una fase
// comercial (25%/50%/75%/Contrato/Cliente cerrado) — eso borraría progreso
// comercial real, y Daniel solo describió el caso "Reunión -> No Asiste".
export async function moveOpportunityToNoAsiste(opportunityId: string): Promise<MoveToNoAsisteResult> {
  const opportunity = await fetchOpportunity(opportunityId);

  const pipeline = FB_FORM_NATIVO_PIPELINES.find((p) => p.id === opportunity.pipelineId);
  if (!pipeline) {
    return { moved: false, motivo: `La oportunidad no está en un pipeline "FB Form Nativo" conocido (pipelineId ${opportunity.pipelineId}).` };
  }

  if (opportunity.pipelineStageId === pipeline.stages.noAsiste) {
    return { moved: false, motivo: "Ya estaba en fase No Asiste." };
  }
  if (ADVANCED_STAGE_IDS.has(opportunity.pipelineStageId)) {
    return {
      moved: false,
      motivo: "La oportunidad ya avanzó a una fase comercial posterior (25%/50%/75%/Contrato/Cliente cerrado) — no se retrocede automáticamente.",
    };
  }

  const headers = authHeaders();
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      pipelineId: pipeline.id,
      pipelineStageId: pipeline.stages.noAsiste,
    }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`GHL ${res.status}: ${JSON.stringify(json)}`);
  }
  return { moved: true };
}

export { MissingCredentialsError };
