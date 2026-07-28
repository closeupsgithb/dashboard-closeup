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

// Cacheado por scope (nunca compartido entre lectura y escritura — un token
// de solo lectura cacheado se reutilizaría para escrituras y Google lo
// rechazaría con 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT, como pasó en pruebas).
const cachedTokens: Record<"readOnly" | "readWrite", { value: string; expiresAt: number } | null> = {
  readOnly: null,
  readWrite: null,
};

async function getAccessToken(readOnly: boolean): Promise<string> {
  const key = readOnly ? "readOnly" : "readWrite";
  const cached = cachedTokens[key];
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.value;
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
  cachedTokens[key] = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedTokens[key]!.value;
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

function columnLetter(zeroBasedIndex: number): string {
  return String.fromCharCode(65 + zeroBasedIndex);
}

export class ClientRowNotFoundError extends Error {
  constructor(cliente: string, tabName: string) {
    super(`No se encontró "${cliente}" en la pestaña "${tabName}".`);
  }
}

// Escribe Estado y/o Importe para un cliente ya existente en una pestaña de
// periodo. Nunca crea filas nuevas — si el nombre no coincide exactamente con
// una fila existente, falla en vez de adivinar dónde escribir.
export async function updateClientFields(
  tabName: string,
  cliente: string,
  updates: { estado?: string; importe?: string }
): Promise<void> {
  const rows = await getTabValues(tabName);
  const [header, ...body] = rows;
  if (!header) throw new ClientRowNotFoundError(cliente, tabName);

  const idx = { nombre: header.indexOf("Nombre"), importe: header.indexOf("Importe"), estado: header.indexOf("Estado") };
  const rowIndex = body.findIndex((row) => row[idx.nombre] === cliente);
  if (rowIndex === -1) throw new ClientRowNotFoundError(cliente, tabName);

  const sheetRow = rowIndex + 2; // +1 por la cabecera, +1 porque Sheets es 1-indexado
  const data: { range: string; values: string[][] }[] = [];
  if (updates.estado !== undefined) {
    data.push({ range: `'${tabName}'!${columnLetter(idx.estado)}${sheetRow}`, values: [[updates.estado]] });
  }
  if (updates.importe !== undefined) {
    data.push({ range: `'${tabName}'!${columnLetter(idx.importe)}${sheetRow}`, values: [[updates.importe]] });
  }
  if (data.length === 0) return;

  const token = await getAccessToken(false);
  const res = await fetch(`${SHEETS_BASE}/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
}

export { MissingCredentialsError, SPREADSHEET_ID };
