const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export const LOCATION_ID = "gNZGfOheofHgZtuYObm7";

// IDs confirmados en la Fase 0 directamente contra la API — no coincidían con la
// spec inicial (ver memoria del proyecto): "FB Form Nativo" es el funnel de
// leads/venta, el pago real ocurre al entrar en Onboarding > "3.-(Si pago)".
export const PIPELINES = {
  fbFormNativo: {
    id: "BF2Ap1zJkPjLJ2gtqEf5",
    stages: {
      nuevoLeadMeta: "f79d1c8e-cd35-4824-b64d-6795b9329d45",
      clienteCerrado: "905fc52d-94d3-4c4b-8690-69f93ceec203",
    },
  },
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

export type GhlOpportunity = {
  id: string;
  name: string;
  contactId: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue: number;
  dateAdded: string;
  updatedAt: string;
};

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

export async function fetchFunnelOpportunities(): Promise<GhlOpportunity[]> {
  return searchOpportunities(PIPELINES.fbFormNativo.id);
}

export async function fetchOnboardingOpportunities(): Promise<GhlOpportunity[]> {
  return searchOpportunities(PIPELINES.onboarding.id);
}

export { MissingCredentialsError };
