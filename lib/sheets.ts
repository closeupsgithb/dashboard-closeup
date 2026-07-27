import { createSign } from "crypto";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// "Pagos clientes" — confirmado por API en la Fase 0 que solo tiene las pestañas
// Hoja 1 (vacía), Hoja 2 y SBY; las pestañas de periodo se irán añadiendo aquí.
const SPREADSHEET_ID = "1txMiE2w49tQND7XyVcS9QjdkbqYdwEnSQefRrj2a1Rg";

class MissingCredentialsError extends Error {
  constructor() {
    super("MISSING_CREDENTIALS");
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function credentials(): { clientEmail: string; privateKey: string } {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new MissingCredentialsError();
  }
  return { clientEmail, privateKey };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

// Cacheado en memoria del proceso: los tokens de Google duran 1h y cada request
// de un dashboard con varias tarjetas puede disparar varias llamadas seguidas.
async function getAccessToken(readOnly: boolean): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  const { clientEmail, privateKey } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const scope = readOnly
    ? "https://www.googleapis.com/auth/spreadsheets.readonly"
    : "https://www.googleapis.com/auth/spreadsheets";
  const claims = { iss: clientEmail, scope, aud: TOKEN_URI, exp: now + 3600, iat: now };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Google OAuth ${res.status}: ${JSON.stringify(json)}`);
  }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

export type SheetTab = { title: string; rowCount: number; columnCount: number };

export async function listTabs(): Promise<SheetTab[]> {
  const token = await getAccessToken(true);
  const res = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
  type RawSheet = { properties: { title: string; gridProperties?: { rowCount?: number; columnCount?: number } } };
  return ((json.sheets ?? []) as RawSheet[]).map((s) => ({
    title: s.properties.title,
    rowCount: s.properties.gridProperties?.rowCount ?? 0,
    columnCount: s.properties.gridProperties?.columnCount ?? 0,
  }));
}

export async function getTabValues(tabName: string): Promise<string[][]> {
  const token = await getAccessToken(true);
  const range = encodeURIComponent(`'${tabName}'!A1:Z1000`);
  const res = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.values ?? [];
}

export async function getAllTabsData(): Promise<Record<string, string[][]>> {
  const tabs = await listTabs();
  const entries = await Promise.all(tabs.map(async (t) => [t.title, await getTabValues(t.title)] as const));
  return Object.fromEntries(entries);
}

export { MissingCredentialsError, SPREADSHEET_ID };
