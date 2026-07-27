const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export const AD_ACCOUNT_ID = "791873196987057";

// Campaña propia de Closeup para captar sus propios clientes (confirmada en
// memoria del proyecto) — el CAC de la agencia se calcula solo sobre este gasto,
// nunca sobre el gasto de las campañas CBO_ de clientes finales, que es dinero
// de cliente, no coste de adquisición de Closeup.
export const OWN_ACQUISITION_CAMPAIGN_ID = "120238880240590187";

class MissingCredentialsError extends Error {
  constructor() {
    super("MISSING_CREDENTIALS");
  }
}

function accessToken(): string {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MissingCredentialsError();
  }
  return token;
}

export type MonthlySpend = { month: string; spend: number };

export async function fetchOwnCampaignSpendByMonth(since: string, until: string): Promise<MonthlySpend[]> {
  const token = accessToken();
  const url = new URL(`${GRAPH_BASE}/${OWN_ACQUISITION_CAMPAIGN_ID}/insights`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "spend");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("time_increment", "monthly");

  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Meta ${res.status}: ${JSON.stringify(json)}`);
  }

  type RawPoint = { date_start: string; spend: string };
  return ((json.data ?? []) as RawPoint[]).map((d) => ({
    month: d.date_start.slice(0, 7),
    spend: Number(d.spend),
  }));
}

export { MissingCredentialsError };
