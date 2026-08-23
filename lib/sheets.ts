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

// Google devuelve 429 "RATE_LIMIT_EXCEEDED" en la cuota "lecturas por minuto
// por usuario" cuando se encadenan varias acciones seguidas (cada guardado
// del dashboard recarga /api/metrics entero) — confirmado con un caso real
// de Daniel el 2026-07-31 marcando varios contactos seguidos. Reintenta con
// backoff antes de rendirse, en vez de dejar que un pico pasajero rompa la
// petición del usuario.
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, init);
    if (res.status !== 429 || attempt >= maxRetries) return res;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

export type SheetTab = { title: string; sheetId: number; rowCount: number; columnCount: number };

export async function listTabs(): Promise<SheetTab[]> {
  const token = await getAccessToken(true);
  const res = await fetchWithRetry(`${SHEETS_BASE}/${SPREADSHEET_ID}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
  type RawSheet = {
    properties: { title: string; sheetId: number; gridProperties?: { rowCount?: number; columnCount?: number } };
  };
  return ((json.sheets ?? []) as RawSheet[]).map((s) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
    rowCount: s.properties.gridProperties?.rowCount ?? 0,
    columnCount: s.properties.gridProperties?.columnCount ?? 0,
  }));
}

export async function getTabValues(tabName: string): Promise<string[][]> {
  const token = await getAccessToken(true);
  const range = encodeURIComponent(`'${tabName}'!A1:Z1000`);
  const res = await fetchWithRetry(`${SHEETS_BASE}/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.values ?? [];
}

// Lee VARIAS pestañas en una sola llamada HTTP (values:batchGet) en vez de
// una llamada por pestaña — la causa real del 429: con ~10 pestañas, cada
// recarga del dashboard hacía ~10 lecturas separadas, y unas pocas acciones
// seguidas superaban las 60 lecturas/min/usuario que permite Google.
async function getTabsValuesBatch(tabNames: string[]): Promise<Record<string, string[][]>> {
  if (tabNames.length === 0) return {};
  const token = await getAccessToken(true);
  const ranges = tabNames.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:Z1000`)}`).join("&");
  const res = await fetchWithRetry(`${SHEETS_BASE}/${SPREADSHEET_ID}/values:batchGet?${ranges}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
  const valueRanges = (json.valueRanges ?? []) as { values?: string[][] }[];
  return Object.fromEntries(tabNames.map((t, i) => [t, valueRanges[i]?.values ?? []] as const));
}

export async function getAllTabsData(): Promise<Record<string, string[][]>> {
  const tabs = await listTabs();
  return getTabsValuesBatch(tabs.map((t) => t.title));
}

function columnLetter(zeroBasedIndex: number): string {
  return String.fromCharCode(65 + zeroBasedIndex);
}

export class ClientRowNotFoundError extends Error {
  constructor(cliente: string, tabName: string) {
    super(`No se encontró "${cliente}" en la pestaña "${tabName}".`);
  }
}

// Pestañas que NO son de clientes (ni de periodo ni SBY) y se excluyen al
// recorrer todo el Sheet para renombrar. SBY SÍ se incluye a propósito: si un
// cliente en pausa se renombra en una pestaña de periodo pero no en SBY,
// computeChurn (lib/metrics.ts) dejaría de reconocerlo como "en pausa" y lo
// contaría como baja real. Nombre literal en vez de la constante
// MANUAL_ATTENDANCE_TAB (definida más abajo) para no depender del orden de
// declaración.
const NON_CLIENT_TABS = new Set(["Hoja 1", "Asistencia Manual"]);

// Escribe Estado, Importe, Factura Emitida y/o Comentario para un cliente ya
// existente en una pestaña de periodo (o SBY, misma estructura de columnas).
// Nunca crea filas nuevas — si el nombre no coincide exactamente con una fila
// existente, falla en vez de adivinar dónde escribir. El Nombre en sí NO se
// edita aquí (ver renameClientEverywhere) — cambiarlo a la vez que se usa
// para localizar la fila sería confuso y, además, un nombre solo puede
// renombrarse de forma coherente en todas las pestañas a la vez.
export async function updateClientFields(
  tabName: string,
  cliente: string,
  updates: { estado?: string; importe?: string; facturaEmitida?: string; comentario?: string; origen?: string }
): Promise<void> {
  const rows = await getTabValues(tabName);
  const [header, ...body] = rows;
  if (!header) throw new ClientRowNotFoundError(cliente, tabName);

  const idx = {
    nombre: header.indexOf("Nombre"),
    importe: header.indexOf("Importe"),
    estado: header.indexOf("Estado"),
    comentario: header.indexOf("Comentario"),
    facturaEmitida: header.indexOf("Factura Emitida"),
    origen: header.indexOf("Origen"),
  };
  // Comparación con trim(): parseTabRows (lib/metrics.ts) ya recorta el
  // nombre al construir nombreOriginalPorCliente/clienteSheet, así que un
  // espacio sobrante en la celda del Sheet no debe impedir el cruce aquí.
  const rowIndex = body.findIndex((row) => row[idx.nombre]?.trim() === cliente.trim());
  if (rowIndex === -1) throw new ClientRowNotFoundError(cliente, tabName);

  const sheetRow = rowIndex + 2; // +1 por la cabecera, +1 porque Sheets es 1-indexado
  const data: { range: string; values: string[][] }[] = [];
  if (updates.estado !== undefined) {
    data.push({ range: `'${tabName}'!${columnLetter(idx.estado)}${sheetRow}`, values: [[updates.estado]] });
  }
  if (updates.importe !== undefined) {
    data.push({ range: `'${tabName}'!${columnLetter(idx.importe)}${sheetRow}`, values: [[updates.importe]] });
  }
  if (updates.comentario !== undefined && idx.comentario !== -1) {
    data.push({ range: `'${tabName}'!${columnLetter(idx.comentario)}${sheetRow}`, values: [[updates.comentario]] });
  }
  if (updates.facturaEmitida !== undefined && idx.facturaEmitida !== -1) {
    data.push({ range: `'${tabName}'!${columnLetter(idx.facturaEmitida)}${sheetRow}`, values: [[updates.facturaEmitida]] });
  }
  if (updates.origen !== undefined && idx.origen !== -1) {
    data.push({ range: `'${tabName}'!${columnLetter(idx.origen)}${sheetRow}`, values: [[updates.origen]] });
  }
  if (data.length === 0) return;

  const token = await getAccessToken(false);
  const res = await fetchWithRetry(`${SHEETS_BASE}/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
}

// Renombra un cliente en TODAS las pestañas de periodo + SBY donde aparezca
// con el nombre exacto anterior. Necesario hacerlo así (no solo en la
// pestaña que se está editando): CAC/churn/LTV comparan clientes por nombre
// normalizado ENTRE periodos — si el nombre cambiara solo en un mes, ese
// cliente se leería como "nuevo" ese mes y como "baja" en los demás,
// corrompiendo esas métricas. Silencioso en las pestañas donde no aparece
// (no todos los clientes están en todos los meses).
export async function renameClientEverywhere(oldName: string, newName: string): Promise<{ tabsUpdated: string[] }> {
  const tabs = await listTabs();
  const candidateTabs = tabs.filter((t) => !NON_CLIENT_TABS.has(t.title));

  // Una sola llamada para leer TODAS las pestañas candidatas (antes: una
  // lectura por pestaña, en serie) — mismo motivo que getAllTabsData.
  const valuesByTab = await getTabsValuesBatch(candidateTabs.map((t) => t.title));

  const token = await getAccessToken(false);
  const data: { range: string; values: string[][] }[] = [];
  const tabsUpdated: string[] = [];

  for (const tab of candidateTabs) {
    const rows = valuesByTab[tab.title] ?? [];
    const [header, ...body] = rows;
    if (!header) continue;
    const nombreIdx = header.indexOf("Nombre");
    if (nombreIdx === -1) continue;
    const rowIndex = body.findIndex((row) => row[nombreIdx]?.trim() === oldName.trim());
    if (rowIndex === -1) continue;
    const sheetRow = rowIndex + 2;
    data.push({ range: `'${tab.title}'!${columnLetter(nombreIdx)}${sheetRow}`, values: [[newName]] });
    tabsUpdated.push(tab.title);
  }

  if (data.length === 0) {
    throw new ClientRowNotFoundError(oldName, "ninguna pestaña");
  }

  const res = await fetchWithRetry(`${SHEETS_BASE}/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
  return { tabsUpdated };
}

const SBY_TAB = "SBY";

// Añade un cliente a la pestaña SBY (clientes en pausa) — no crea duplicados
// si ya está. No toca su Estado en las pestañas de periodo (son señales
// independientes, ver lib/metrics.ts). Escribe en la fila exacta siguiente a
// la última con datos (values.update con rango explícito), no con el
// endpoint genérico ":append" — confirmado con una prueba real que, si el
// rango tiene filas en blanco intermedias ya "tocadas" alguna vez por Sheets,
// ":append" puede aterrizar muchas filas más abajo de lo esperado.
export async function addClientToSby(cliente: string, comentario: string): Promise<void> {
  const rows = await getTabValues(SBY_TAB);
  const [header, ...body] = rows;
  const columns = header ?? ["Nombre", "Importe", "Estado", "Comentario", "MES 2"];
  const nombreIdx = columns.indexOf("Nombre");
  const comentarioIdx = columns.indexOf("Comentario");

  if (nombreIdx !== -1 && body.some((row) => row[nombreIdx]?.trim() === cliente.trim())) {
    return; // ya está en pausa, no duplicar
  }

  const newRow: string[] = [];
  newRow[nombreIdx === -1 ? 0 : nombreIdx] = cliente;
  if (comentarioIdx !== -1) newRow[comentarioIdx] = comentario;

  const nextSheetRow = body.length + 2; // +1 cabecera, +1 porque Sheets es 1-indexado
  const token = await getAccessToken(false);
  const res = await fetchWithRetry(
    `${SHEETS_BASE}/${SPREADSHEET_ID}/values/'${SBY_TAB}'!A${nextSheetRow}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [newRow] }),
    }
  );
  if (!res.ok) {
    const json = await res.json();
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
}

// Quita un cliente de la pestaña SBY (vuelve a activos) — borra la fila de
// verdad (deleteDimension), no la deja en blanco, para que SBY no acumule
// huecos con el tiempo.
export async function removeClientFromSby(cliente: string): Promise<void> {
  const tabs = await listTabs();
  const sbyTab = tabs.find((t) => t.title === SBY_TAB);
  if (!sbyTab) throw new Error(`No se encontró la pestaña "${SBY_TAB}".`);

  const rows = await getTabValues(SBY_TAB);
  const [header, ...body] = rows;
  if (!header) throw new ClientRowNotFoundError(cliente, SBY_TAB);
  const nombreIdx = header.indexOf("Nombre");
  const rowIndex = body.findIndex((row) => row[nombreIdx]?.trim() === cliente.trim());
  if (rowIndex === -1) throw new ClientRowNotFoundError(cliente, SBY_TAB);

  const sheetRowZeroIndexed = rowIndex + 1; // +1 por la cabecera (0-indexado para la API de rangos)
  const token = await getAccessToken(false);
  const res = await fetchWithRetry(`${SHEETS_BASE}/${SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sbyTab.sheetId,
              dimension: "ROWS",
              startIndex: sheetRowZeroIndexed,
              endIndex: sheetRowZeroIndexed + 1,
            },
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
}

// Pestaña donde Daniel marca asistencia manual a reuniones (prioridad sobre
// la fase del pipeline de GHL para ese contacto/reunión — ver
// computeReunionStats en lib/metrics.ts). Vive en el mismo Sheet que el resto
// de datos editables para no crear una fuente de verdad separada.
export const MANUAL_ATTENDANCE_TAB = "Asistencia Manual";

export type ManualAttendanceEntry = {
  opportunityId: string;
  contacto: string;
  asistio: string;
  fecha: string;
  actualizadoEn: string;
  comentario: string;
};

export async function getManualAttendanceOverrides(): Promise<ManualAttendanceEntry[]> {
  const rows = await getTabValues(MANUAL_ATTENDANCE_TAB);
  const [header, ...body] = rows;
  if (!header) return [];
  const idx = {
    opportunityId: header.indexOf("OpportunityId"),
    contacto: header.indexOf("Contacto"),
    asistio: header.indexOf("Asistio"),
    fecha: header.indexOf("Fecha"),
    actualizadoEn: header.indexOf("ActualizadoEn"),
    comentario: header.indexOf("Comentario"),
  };
  if (idx.opportunityId === -1) return [];
  return body
    .filter((row) => row[idx.opportunityId]?.trim())
    .map((row) => ({
      opportunityId: row[idx.opportunityId].trim(),
      contacto: row[idx.contacto] ?? "",
      asistio: row[idx.asistio] ?? "",
      fecha: row[idx.fecha] ?? "",
      actualizadoEn: row[idx.actualizadoEn] ?? "",
      comentario: row[idx.comentario] ?? "",
    }));
}

// Busca fila existente por OpportunityId y la actualiza; si no existe, añade
// una fila nueva al final — a diferencia de updateClientFields (que nunca
// crea filas porque el roster de clientes es fijo), aquí SÍ hace falta poder
// crear filas nuevas porque es un registro abierto de correcciones puntuales.
export async function upsertManualAttendance(
  opportunityId: string,
  fields: { contacto: string; asistio: string; fecha: string; comentario: string }
): Promise<void> {
  const rows = await getTabValues(MANUAL_ATTENDANCE_TAB);
  const [header, ...body] = rows;
  const columns = header ?? ["OpportunityId", "Contacto", "Asistio", "Fecha", "ActualizadoEn", "Comentario"];
  const idx = {
    opportunityId: columns.indexOf("OpportunityId"),
    contacto: columns.indexOf("Contacto"),
    asistio: columns.indexOf("Asistio"),
    fecha: columns.indexOf("Fecha"),
    actualizadoEn: columns.indexOf("ActualizadoEn"),
    comentario: columns.indexOf("Comentario"),
  };

  const actualizadoEn = new Date().toISOString();
  const rowIndex = body.findIndex((row) => row[idx.opportunityId] === opportunityId);
  const token = await getAccessToken(false);

  if (rowIndex !== -1) {
    const sheetRow = rowIndex + 2;
    const data = [
      { range: `'${MANUAL_ATTENDANCE_TAB}'!${columnLetter(idx.contacto)}${sheetRow}`, values: [[fields.contacto]] },
      { range: `'${MANUAL_ATTENDANCE_TAB}'!${columnLetter(idx.asistio)}${sheetRow}`, values: [[fields.asistio]] },
      { range: `'${MANUAL_ATTENDANCE_TAB}'!${columnLetter(idx.fecha)}${sheetRow}`, values: [[fields.fecha]] },
      { range: `'${MANUAL_ATTENDANCE_TAB}'!${columnLetter(idx.actualizadoEn)}${sheetRow}`, values: [[actualizadoEn]] },
      { range: `'${MANUAL_ATTENDANCE_TAB}'!${columnLetter(idx.comentario)}${sheetRow}`, values: [[fields.comentario]] },
    ];
    const res = await fetchWithRetry(`${SHEETS_BASE}/${SPREADSHEET_ID}/values:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
    }
    return;
  }

  const newRow = [opportunityId, fields.contacto, fields.asistio, fields.fecha, actualizadoEn, fields.comentario];
  const res = await fetchWithRetry(
    `${SHEETS_BASE}/${SPREADSHEET_ID}/values/'${MANUAL_ATTENDANCE_TAB}'!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [newRow] }),
    }
  );
  if (!res.ok) {
    const json = await res.json();
    throw new Error(`Sheets ${res.status}: ${JSON.stringify(json)}`);
  }
}

export { MissingCredentialsError, SPREADSHEET_ID };
