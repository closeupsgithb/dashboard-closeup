const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export const LOCATION_ID = "gNZGfOheofHgZtuYObm7";

// Confirmado en la Fase 2 contra la API real: "FB Form Nativo || Pipeline" son
// leads de particulares para el Servicio de Leads (no clientes de agencia) y
// queda fuera de este dashboard. "Onboarding" sí son los clientes reales de
// Closeup — el pago ocurre al entrar en la fase "3.-(Si pago) Agendar reunión".
export const PIPELINES = {
  onboarding: {
    id: "24qvnC75Mxwh1ZnRKApe",
    stages: {
      pagoAgendarReunion: "11153e22-f2a2-4bd9-8ab6-6f8c960dff4e",
      campanaLanzada: "2f842576-cba2-4442-b714-460ac31ece12",
    },
  },
} as const;

class MissingCredentialsError extends Error {
  constructor() {
    super("MISSING_CREDENTIALS");
  }
}

function authHeaders(): Record<string, string> {
  const token = process.env.GHL_PRIVATE_TOKEN;
  if (!token) {
    throw new MissingCredentialsError();
  }
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_API_VERSION,
  };
}

// IDs de los campos personalizados creados el 2026-07-28 (Configuración >
// Campos personalizados > Oportunidad > carpeta "Opportunity Details").
// Daniel los rellena a mano desde el dashboard — no hay workflow automático.
export const CUSTOM_FIELDS = {
  fechaReunionAgendada: "ZYQr2nc7006KhRrJBCzQ",
  asistioReunion: "J54D8m3778Bu5Vninimm",
} as const;

export const ASISTIO_OPTIONS = ["Sí", "No", "Pendiente"] as const;

type GhlCustomField = {
  id: string;
  fieldValue?: string;
  fieldValueString?: string;
  fieldValueDate?: number;
  value?: string;
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
  contact?: { name: string; companyName: string | null };
  customFields?: GhlCustomField[];
};

// La API de GHL no es consistente: los campos de texto/lista usan
// "fieldValueString" en /opportunities/search o "fieldValue" en
// /opportunities/{id}; los campos de tipo Fecha usan "fieldValueDate" (un
// timestamp en milisegundos) en vez de una de esas dos — confirmado con una
// llamada real, no está documentado de forma clara. Se comprueban las tres.
export function getCustomFieldValue(opportunity: GhlOpportunity, fieldId: string): string {
  const field = opportunity.customFields?.find((f) => f.id === fieldId);
  if (!field) return "";
  if (field.fieldValueDate !== undefined) {
    return new Date(field.fieldValueDate).toISOString().slice(0, 10);
  }
  return field.fieldValueString ?? field.fieldValue ?? field.value ?? "";
}

type SearchResponse = {
  opportunities?: GhlOpportunity[];
  meta?: { startAfter?: string; startAfterId?: string };
};

async function searchOpportunities(pipelineId: string): Promise<GhlOpportunity[]> {
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

// Escribe fecha_reunion_agendada y/o asistio_reunion sobre una oportunidad ya
// existente. Nunca crea oportunidades — si el ID no existe, GHL devuelve error
// y no se escribe nada.
export async function updateOpportunityCustomFields(
  opportunityId: string,
  updates: { fechaReunionAgendada?: string; asistioReunion?: string }
): Promise<void> {
  const headers = authHeaders();
  const customFields: { id: string; fieldValue: string }[] = [];
  if (updates.fechaReunionAgendada !== undefined) {
    customFields.push({ id: CUSTOM_FIELDS.fechaReunionAgendada, fieldValue: updates.fechaReunionAgendada });
  }
  if (updates.asistioReunion !== undefined) {
    customFields.push({ id: CUSTOM_FIELDS.asistioReunion, fieldValue: updates.asistioReunion });
  }
  if (customFields.length === 0) return;

  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ customFields }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`GHL ${res.status}: ${JSON.stringify(json)}`);
  }
}

export { MissingCredentialsError };
