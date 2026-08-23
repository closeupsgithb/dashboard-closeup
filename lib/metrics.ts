import { OWN_ACQUISITION_CAMPAIGN_ID, type MonthlySpend } from "@/lib/metaAds";
import type { GhlOpportunity, CalendarMeeting } from "@/lib/ghl";
import { PIPELINES, getFirstTouchCampaignId, OTHER_CLOSERS_LABEL, NO_ASISTE_STAGE_IDS, ADVANCED_STAGE_IDS } from "@/lib/ghl";
import type { ManualAttendanceEntry } from "@/lib/sheets";
import { madridDateOnly } from "@/lib/format";

// "SBY" es un estado de cliente (pausado / no renovó / vuelve en fecha conocida),
// no una pestaña de facturación — se excluye de la lista de periodos de pago.
const NON_PERIOD_TABS = new Set(["SBY"]);

// Respaldo manual por si alguna pestaña de periodo no lleva nombre de mes
// reconocible (la convención acordada es ENERO..DICIEMBRE en mayúsculas, que
// ya se detecta solo — ver inferMonthFromTabName).
const MANUAL_TAB_TO_MONTH: Record<string, string> = {};

const SPANISH_MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

// Rango Unicode de marcas diacríticas combinantes (0x0300–0x036F), construido a
// partir de sus code points para evitar depender de caracteres literales.
const COMBINING_DIACRITICS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  "g"
);

export function normalizeClientName(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseSpanishNumber(s: string): number | null {
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export type ParsedImporte = { value: number | null; raw: string; needsReview: boolean };

// Maneja los tres patrones reales vistos en la hoja: número limpio ("1100"),
// fórmula escrita a mano ("1.000 € ÷ 1,21 = 826,45 €") y número seguido de una
// fecha suelta en la misma celda ("550 15 junio", primer plazo de un 50%).
// Cualquier otro formato se marca needsReview en vez de adivinar (ej. "videos").
export function parseImporte(raw: string): ParsedImporte {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, raw, needsReview: false };

  const cleanMatch = trimmed.match(/^([\d.,]+)\s*€?$/);
  if (cleanMatch) {
    const value = parseSpanishNumber(cleanMatch[1]);
    return { value, raw, needsReview: value === null };
  }

  const formulaMatch = trimmed.match(/=\s*([\d.,]+)\s*€/);
  if (formulaMatch) {
    const value = parseSpanishNumber(formulaMatch[1]);
    return { value, raw, needsReview: value === null };
  }

  const dateTailMatch = trimmed.match(/^([\d.,]+)\s+\d{1,2}\s+[a-záéíóúñ]+$/i);
  if (dateTailMatch) {
    const value = parseSpanishNumber(dateTailMatch[1]);
    return { value, raw, needsReview: value === null };
  }

  return { value: null, raw, needsReview: true };
}

export function inferMonthFromTabName(title: string): string | null {
  if (MANUAL_TAB_TO_MONTH[title]) return MANUAL_TAB_TO_MONTH[title];
  const lower = title.toLowerCase();
  const monthEntry = Object.entries(SPANISH_MONTHS).find(([name]) => lower.includes(name));
  if (!monthEntry) return null;
  const yearMatch = title.match(/20\d{2}/);
  const year = yearMatch ? yearMatch[0] : String(new Date().getFullYear());
  return `${year}-${monthEntry[1]}`;
}

export type PeriodEntry = {
  cliente: string;
  clienteNormalizado: string;
  importe: ParsedImporte;
  estado: string;
  comentario: string;
  facturaEmitida: string;
  // "CBO_LEADS_REFOR" / "Organico" / "" (vacío = automático, ver computeRoas).
  // Marcado a mano por Daniel, tiene SIEMPRE prioridad sobre la atribución de
  // GHL cuando no está vacío.
  origen: string;
};

export function parseTabRows(rows: string[][]): PeriodEntry[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const idx = {
    nombre: header.indexOf("Nombre"),
    importe: header.indexOf("Importe"),
    estado: header.indexOf("Estado"),
    comentario: header.indexOf("Comentario"),
    facturaEmitida: header.indexOf("Factura Emitida"),
    origen: header.indexOf("Origen"),
  };
  if (idx.nombre === -1) return [];

  return body
    .filter((row) => row[idx.nombre]?.trim())
    .map((row) => {
      const cliente = row[idx.nombre].trim();
      return {
        cliente,
        clienteNormalizado: normalizeClientName(cliente),
        importe: parseImporte(row[idx.importe] ?? ""),
        estado: (row[idx.estado] ?? "").trim(),
        comentario: (row[idx.comentario] ?? "").trim(),
        facturaEmitida: idx.facturaEmitida !== -1 ? (row[idx.facturaEmitida] ?? "").trim() : "",
        origen: idx.origen !== -1 ? (row[idx.origen] ?? "").trim() : "",
      };
    });
}

const CONFIRMED_STATES = new Set(["Hecho", "50%"]);

export type MonthSnapshot = {
  periodo: string;
  mes: string | null;
  ingresoConfirmado: number;
  ingresoPendiente: number;
  clientesConfirmados: string[];
  clientesPendientes: string[];
  clientesEnPausa: string[];
  importePorCliente: Record<string, number>;
  // Estado (raw) de CUALQUIER cliente listado en la pestaña, confirmado o no
  // — permite explicar con precisión por qué un cliente no cuenta en ROAS
  // ("está Pendiente" vs "no tiene fila" son cosas distintas).
  estadoPorCliente: Record<string, string>;
  // Importe tal cual está escrito en el Sheet (sin parsear) para CUALQUIER
  // cliente listado — necesario para poder editar desde fuera de la tabla de
  // ingresos (ej. desde ROAS) sin perder fórmulas escritas a mano.
  importeRawPorCliente: Record<string, string>;
  // Nombre EXACTO tal cual aparece en el Sheet, indexado por su versión
  // normalizada — hace falta para poder escribir de vuelta (updateClientFields
  // localiza la fila por el nombre exacto, no por el normalizado).
  nombreOriginalPorCliente: Record<string, string>;
  // Origen marcado a mano por Daniel ("CBO_LEADS_REFOR"/"Organico"/"" =
  // automático) para CUALQUIER cliente listado — ver computeRoas.
  origenPorCliente: Record<string, string>;
  entradasNoInterpretables: { cliente: string; raw: string }[];
  // Falso mientras la pestaña tenga clientes listados pero ningún Estado
  // rellenado todavía (ej. un mes recién creado a partir de la plantilla del
  // mes anterior) — evita que se lea como "todos han causado baja".
  reportado: boolean;
};

// inferMonthFromTabName no lleva contexto de las pestañas anteriores: si el
// nombre no trae año explícito (la convención acordada es solo "ENERO",
// "FEBRERO"...), siempre usa el año actual. Eso rompe en cuanto la secuencia
// de pestañas cruza un fin de año — "ENERO" justo después de "DICIEMBRE" se
// leería como enero de ESTE año (anterior a julio), no del año siguiente.
// Se corrige aquí, en orden, subiendo el año cada vez que un mes no avanza
// respecto al anterior.
function corrigeAñoPorSecuencia(snapshots: { mes: string | null }[]): void {
  let ultimoMes: string | null = null;
  let desfaseAño = 0;
  for (const snap of snapshots) {
    if (snap.mes === null) continue;
    const [añoStr, mesStr] = snap.mes.split("-");
    let candidato = `${Number(añoStr) + desfaseAño}-${mesStr}`;
    if (ultimoMes !== null && candidato <= ultimoMes) {
      desfaseAño += 1;
      candidato = `${Number(añoStr) + desfaseAño}-${mesStr}`;
    }
    snap.mes = candidato;
    ultimoMes = candidato;
  }
}

export function buildMonthSnapshots(
  tabsData: Record<string, string[][]>,
  periodTabOrder: string[]
): MonthSnapshot[] {
  const snapshots = periodTabOrder
    .filter((tabName) => !NON_PERIOD_TABS.has(tabName))
    .map((tabName) => {
      const entries = parseTabRows(tabsData[tabName] ?? []);
      const confirmadas = entries.filter((e) => CONFIRMED_STATES.has(e.estado));
      const pendientes = entries.filter((e) => e.estado === "Pendiente");
      // Un cliente puede quedar en STAND BY directamente dentro de una pestaña
      // de periodo (ej. Impernova en "Hoja 2"), no solo en la pestaña SBY
      // dedicada — ambos casos cuentan igual como "en pausa", no como baja.
      const enPausa = entries.filter((e) => e.estado === "STAND BY");

      const importePorCliente: Record<string, number> = {};
      confirmadas.forEach((e) => {
        if (e.importe.value !== null) importePorCliente[e.clienteNormalizado] = e.importe.value;
      });

      const estadoPorCliente: Record<string, string> = {};
      const importeRawPorCliente: Record<string, string> = {};
      const nombreOriginalPorCliente: Record<string, string> = {};
      const origenPorCliente: Record<string, string> = {};
      entries.forEach((e) => {
        estadoPorCliente[e.clienteNormalizado] = e.estado;
        importeRawPorCliente[e.clienteNormalizado] = e.importe.raw;
        nombreOriginalPorCliente[e.clienteNormalizado] = e.cliente;
        origenPorCliente[e.clienteNormalizado] = e.origen;
      });

      return {
        periodo: tabName,
        mes: inferMonthFromTabName(tabName),
        ingresoConfirmado: confirmadas.reduce((sum, e) => sum + (e.importe.value ?? 0), 0),
        ingresoPendiente: pendientes.reduce((sum, e) => sum + (e.importe.value ?? 0), 0),
        clientesConfirmados: confirmadas.map((e) => e.clienteNormalizado),
        clientesPendientes: pendientes.map((e) => e.clienteNormalizado),
        clientesEnPausa: enPausa.map((e) => e.clienteNormalizado),
        importePorCliente,
        estadoPorCliente,
        importeRawPorCliente,
        nombreOriginalPorCliente,
        origenPorCliente,
        entradasNoInterpretables: entries
          .filter((e) => e.importe.needsReview)
          .map((e) => ({ cliente: e.cliente, raw: e.importe.raw })),
        reportado: entries.some((e) => e.estado !== ""),
      };
    });

  corrigeAñoPorSecuencia(snapshots);
  return snapshots;
}

export type SbySnapshot = {
  cliente: string;
  clienteNormalizado: string;
  comentario: string;
  estado: string;
  importeRaw: string;
  facturaEmitida: string;
};

export function parseSbyTab(rows: string[][]): SbySnapshot[] {
  return parseTabRows(rows).map((e) => ({
    cliente: e.cliente,
    clienteNormalizado: e.clienteNormalizado,
    comentario: e.comentario,
    estado: e.estado,
    importeRaw: e.importe.raw,
    facturaEmitida: e.facturaEmitida,
  }));
}

export type CacResult = {
  periodo: string;
  mes: string | null;
  gastoAds: number | null;
  clientesNuevos: number | null;
  cac: number | null;
  motivo: string | null;
};

function noReportadoResultCac(snap: MonthSnapshot): CacResult {
  return {
    periodo: snap.periodo,
    mes: snap.mes,
    gastoAds: null,
    clientesNuevos: null,
    cac: null,
    motivo: `La pestaña "${snap.periodo}" todavía no tiene ningún Estado registrado — se ignora hasta que se rellene.`,
  };
}

// CAC = gasto de la campaña propia de captación (CBO_LEADS_REFOR) del mes ÷
// nº de clientes cuyo PRIMER registro confirmado (Hecho/50%) aparece ese mes.
// El primer periodo REPORTADO de la serie nunca tiene CAC: no hay un "antes"
// con el que comparar quién es realmente nuevo. Los periodos todavía sin
// rellenar (ej. un mes recién creado a partir de la plantilla anterior) se
// excluyen de la comparación — no cuentan como "cero clientes nuevos".
export function computeCac(snapshots: MonthSnapshot[], spendByMonth: MonthlySpend[]): CacResult[] {
  const reportados = snapshots.filter((s) => s.reportado);
  const resultsByPeriodo = new Map<string, CacResult>();
  const seenBefore = new Set<string>();

  reportados.forEach((snap, i) => {
    const clientesNuevos =
      i === 0 ? null : snap.clientesConfirmados.filter((c) => !seenBefore.has(c)).length;
    snap.clientesConfirmados.forEach((c) => seenBefore.add(c));

    resultsByPeriodo.set(snap.periodo, computeCacForPeriod(snap, i, clientesNuevos, spendByMonth));
  });

  return snapshots.map((snap) => (snap.reportado ? resultsByPeriodo.get(snap.periodo)! : noReportadoResultCac(snap)));
}

function computeCacForPeriod(
  snap: MonthSnapshot,
  i: number,
  clientesNuevos: number | null,
  spendByMonth: MonthlySpend[]
): CacResult {
  if (i === 0) {
    return {
      periodo: snap.periodo,
      mes: snap.mes,
      gastoAds: null,
      clientesNuevos: null,
      cac: null,
      motivo: "Primer periodo con datos: no hay mes anterior para saber quién es cliente nuevo.",
    };
  }

  if (!snap.mes) {
    return {
      periodo: snap.periodo,
      mes: null,
      gastoAds: null,
      clientesNuevos,
      cac: null,
      motivo: `La pestaña "${snap.periodo}" no tiene un mes identificable — no se puede cruzar con el gasto de Meta Ads.`,
    };
  }

  const gasto = spendByMonth.find((s) => s.month === snap.mes)?.spend ?? null;
  if (gasto === null) {
    return {
      periodo: snap.periodo,
      mes: snap.mes,
      gastoAds: null,
      clientesNuevos,
      cac: null,
      motivo: `Sin dato de gasto de Meta Ads para ${snap.mes}.`,
    };
  }

  if (!clientesNuevos) {
    return {
      periodo: snap.periodo,
      mes: snap.mes,
      gastoAds: gasto,
      clientesNuevos: 0,
      cac: null,
      motivo: "No hubo clientes nuevos confirmados este periodo.",
    };
  }

  return {
    periodo: snap.periodo,
    mes: snap.mes,
    gastoAds: gasto,
    clientesNuevos,
    cac: gasto / clientesNuevos,
    motivo: null,
  };
}

export type ChurnResult = {
  periodo: string;
  clientesMesAnterior: number;
  clientesBaja: string[];
  churnRate: number | null;
  motivo: string | null;
};

// Baja = facturado (Hecho/50%) el periodo anterior, y este periodo ni factura
// ni está en pausa (SBY, tabla global de clientes pausados, o STAND BY dentro
// de la propia pestaña). Los periodos sin ningún Estado registrado todavía se
// excluyen de la comparación — no cuentan como "todos han causado baja".
export function computeChurn(snapshots: MonthSnapshot[], sbyEntries: SbySnapshot[]): ChurnResult[] {
  const reportados = snapshots.filter((s) => s.reportado);
  const sbyNormalizados = new Set(sbyEntries.map((s) => s.clienteNormalizado));
  const resultsByPeriodo = new Map<string, ChurnResult>();

  reportados.forEach((snap, i) => {
    if (i === 0) {
      resultsByPeriodo.set(snap.periodo, {
        periodo: snap.periodo,
        clientesMesAnterior: 0,
        clientesBaja: [],
        churnRate: null,
        motivo: "Primer periodo con datos: no hay mes anterior con el que comparar.",
      });
      return;
    }

    const anterior = reportados[i - 1];
    const enPausaActual = new Set([...sbyNormalizados, ...snap.clientesEnPausa]);
    const confirmadosActual = new Set(snap.clientesConfirmados);

    const bajas = anterior.clientesConfirmados.filter(
      (c) => !confirmadosActual.has(c) && !enPausaActual.has(c)
    );

    resultsByPeriodo.set(snap.periodo, {
      periodo: snap.periodo,
      clientesMesAnterior: anterior.clientesConfirmados.length,
      clientesBaja: bajas,
      churnRate: anterior.clientesConfirmados.length > 0 ? bajas.length / anterior.clientesConfirmados.length : null,
      motivo: null,
    });
  });

  return snapshots.map((snap) =>
    snap.reportado
      ? resultsByPeriodo.get(snap.periodo)!
      : {
          periodo: snap.periodo,
          clientesMesAnterior: 0,
          clientesBaja: [],
          churnRate: null,
          motivo: `La pestaña "${snap.periodo}" todavía no tiene ningún Estado registrado — se ignora hasta que se rellene.`,
        }
  );
}

export type LtvResult = {
  arpuMedio: number | null;
  vidaMediaMeses: number | null;
  ltv: number | null;
  muestraClientesFinalizados: number;
  motivo: string | null;
};

// Solo se calcula sobre clientes cuya relación ya terminó (detectados por el
// mismo criterio de "baja" que el churn), para no subestimar por censura de
// clientes que siguen activos. Con poco histórico, la muestra será pequeña.
export function computeLtv(snapshots: MonthSnapshot[], churnResults: ChurnResult[]): LtvResult {
  type ClienteHistorial = { primerPeriodo: number; ultimoPeriodo: number };
  const historial = new Map<string, ClienteHistorial>();

  snapshots.forEach((snap, i) => {
    snap.clientesConfirmados.forEach((cliente) => {
      const h = historial.get(cliente) ?? { primerPeriodo: i, ultimoPeriodo: i };
      h.ultimoPeriodo = i;
      historial.set(cliente, h);
    });
  });

  const bajaPorCliente = new Map<string, number>();
  churnResults.forEach((r, i) => {
    r.clientesBaja.forEach((cliente) => {
      if (!bajaPorCliente.has(cliente)) bajaPorCliente.set(cliente, i);
    });
  });

  const finalizados = [...historial.entries()].filter(([cliente]) => bajaPorCliente.has(cliente));

  if (finalizados.length === 0) {
    return {
      arpuMedio: null,
      vidaMediaMeses: null,
      ltv: null,
      muestraClientesFinalizados: 0,
      motivo:
        "Todavía no hay clientes con relación finalizada identificados (hace falta más histórico de periodos para detectar bajas reales).",
    };
  }

  const vidas = finalizados.map(([, h]) => h.ultimoPeriodo - h.primerPeriodo + 1);
  const vidaMediaMeses = vidas.reduce((a, b) => a + b, 0) / vidas.length;

  const arpus = finalizados.map(([cliente, h]) => {
    let total = 0;
    let meses = 0;
    for (let i = h.primerPeriodo; i <= h.ultimoPeriodo; i++) {
      const importe = snapshots[i].importePorCliente[cliente];
      if (importe !== undefined) {
        total += importe;
        meses += 1;
      }
    }
    return meses > 0 ? total / meses : 0;
  });

  const arpuMedio = arpus.length > 0 ? arpus.reduce((a, b) => a + b, 0) / arpus.length : null;

  return {
    arpuMedio,
    vidaMediaMeses,
    ltv: arpuMedio !== null ? arpuMedio * vidaMediaMeses : null,
    muestraClientesFinalizados: finalizados.length,
    motivo:
      finalizados.length < 3
        ? "Muestra muy pequeña (menos de 3 clientes con relación finalizada) — tratar como estimación provisional."
        : null,
  };
}

export type PendienteSeguimiento = {
  cliente: string;
  mesesConsecutivosPendiente: number;
  // Datos de la fila real en el Sheet (último periodo reportado) para poder
  // editar directamente desde esta tabla — mismo patrón que EditableClientTable.
  periodo: string;
  clienteSheet: string;
  importeRaw: string;
};

export function computePendingFollowUp(snapshots: MonthSnapshot[]): PendienteSeguimiento[] {
  const reportados = snapshots.filter((s) => s.reportado);
  if (reportados.length === 0) return [];
  const ultimo = reportados[reportados.length - 1];

  return ultimo.clientesPendientes.map((cliente) => {
    let meses = 0;
    for (let i = reportados.length - 1; i >= 0; i--) {
      if (reportados[i].clientesPendientes.includes(cliente)) {
        meses += 1;
      } else {
        break;
      }
    }
    return {
      cliente,
      mesesConsecutivosPendiente: meses,
      periodo: ultimo.periodo,
      clienteSheet: ultimo.nombreOriginalPorCliente[cliente],
      importeRaw: ultimo.importeRawPorCliente[cliente] ?? "",
    };
  });
}

export type OnboardingStageBreakdown = { stage: string; count: number };

// Sustituye al "funnel FB Form Nativo -> Onboarding -> Ganado" original (fuera
// de alcance, ver memoria del proyecto): muestra en qué fase operativa de
// Onboarding está cada cliente ya pagador.
export function computeOnboardingStageBreakdown(opportunities: GhlOpportunity[]): OnboardingStageBreakdown[] {
  const stageNames: Record<string, string> = {
    [PIPELINES.onboarding.stages.pagoAgendarReunion]: "3.- (Si pago) Agendar reunión",
    [PIPELINES.onboarding.stages.campanaLanzada]: "7.- Campaña Lanzada",
  };
  const counts = new Map<string, number>();
  opportunities.forEach((o) => {
    const label = stageNames[o.pipelineStageId] ?? o.pipelineStageId;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()].map(([stage, count]) => ({ stage, count }));
}

// BUG REAL encontrado y corregido 2026-07-30: esta función leía el mes
// directamente del prefijo del string (o con getUTC*), ignorando la zona
// horaria — para una fecha en UTC "Z" (ej. lastStageChangeAt de GHL) cerca
// de medianoche, España (UTC+1/+2) ya puede estar en el día o mes siguiente.
// Se usa madridDateOnly (Intl con timeZone explícito) para que "en qué mes
// cae esta fecha" siempre se calcule en hora de España, no en UTC ni en el
// huso horario ambiente del servidor.
function monthKeyFromDateString(raw: string): string | null {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return madridDateOnly(parsed).slice(0, 7);
}

export type ReunionStats = {
  mes: string;
  agendadas: number;
  noAsistieron: number;
  asistidas: number;
  showRate: number | null;
  gastoAds: number | null;
  costePorAgendada: number | null;
  costePorAsistida: number | null;
};

export type Asistio = "Sí" | "No" | "Pendiente";

export type MeetingResolution = {
  opportunityId: string;
  contactId: string;
  // Nombre de pila del contacto (ej. "Juan Pons") — Daniel lo reconoce mejor
  // que el nombre de empresa a secas, así lo tiene también en su calendario.
  nombreContacto: string;
  empresa: string | null;
  cliente: string;
  closer: string;
  mes: string | null;
  asistio: Asistio;
  fuenteAsistio: "manual" | "pipeline";
  confirmadoPorCalendario: boolean;
  fechaReunion: string | null;
};

// Resuelve, para cada prospecto de FB Form Nativo (ya filtrado a los
// atribuidos a CBO_LEADS_REFOR), un único resultado de reunión combinando
// tres fuentes con esta prioridad:
// 1. Marcado manual de Daniel (pestaña "Asistencia Manual" del Sheet) — tiene
//    prioridad sobre cualquier otra fuente para ese contacto/reunión, tal
//    como pidió explícitamente.
// 2. Fase del pipeline en GHL (automática, la rellenan los closers) —
//    Reunión = pendiente, No Asiste = No, fase avanzada = Sí.
// La fecha de la reunión prioriza, en este orden: fecha del marcado manual >
// fecha real del evento de calendario de GHL > lastStageChangeAt (aproximación,
// GHL no guarda historial completo de cambios de fase). El closer sale del
// evento de calendario (calendars_get-calendar-events, asignado a la persona
// que realmente llevó la llamada) — la oportunidad en sí no sirve para esto,
// confirmado empíricamente: su propio assignedUserId no coincide con quién
// dio la reunión.
export function resolveMeetings(
  fbFormNativoOpportunities: GhlOpportunity[],
  calendarMeetings: Map<string, CalendarMeeting>,
  manualOverrides: ManualAttendanceEntry[]
): MeetingResolution[] {
  const atribuidas = fbFormNativoOpportunities.filter(
    (o) => getFirstTouchCampaignId(o) === OWN_ACQUISITION_CAMPAIGN_ID
  );
  const overridesById = new Map(manualOverrides.map((m) => [m.opportunityId, m]));

  return atribuidas.map((o) => {
    const nombreContacto = o.contact?.name || o.name;
    const empresa = o.contact?.companyName ?? null;
    const cliente = empresa || nombreContacto;
    const calendarMeeting = calendarMeetings.get(o.contactId);
    const override = overridesById.get(o.id);

    let asistio: Asistio;
    let fuenteAsistio: "manual" | "pipeline";
    if (override?.asistio === "Sí" || override?.asistio === "No") {
      asistio = override.asistio;
      fuenteAsistio = "manual";
    } else if (NO_ASISTE_STAGE_IDS.has(o.pipelineStageId)) {
      asistio = "No";
      fuenteAsistio = "pipeline";
    } else if (ADVANCED_STAGE_IDS.has(o.pipelineStageId)) {
      asistio = "Sí";
      fuenteAsistio = "pipeline";
    } else {
      asistio = "Pendiente";
      fuenteAsistio = "pipeline";
    }

    // BUG REAL encontrado y corregido 2026-07-29: un contacto puede tener
    // reservada una reunión de seguimiento en el futuro (o simplemente el
    // closer avanzó la fase antes de que llegara la fecha) mientras su
    // oportunidad YA está en una fase resuelta (No Asiste, o avanzada =
    // asistió). Usar sin más la fecha del calendario habría hecho aparecer
    // "asistió"/"no asistió" en un mes que todavía no ha llegado — no puede
    // haberse resuelto un resultado de algo que no ha ocurrido. Si el
    // resultado viene del pipeline (no manual) Y la fecha del calendario cae
    // en el futuro, se usa en su lugar "lastStageChangeAt" (cuándo se marcó
    // ese resultado de verdad, que por definición ya pasó).
    const calendarEnFuturo = calendarMeeting !== undefined && new Date(calendarMeeting.startTime).getTime() > Date.now();
    const fechaCalendarioUsable = fuenteAsistio === "pipeline" && asistio !== "Pendiente" && calendarEnFuturo
      ? undefined
      : calendarMeeting?.startTime;

    const fechaReunion = (override?.fecha || undefined) ?? fechaCalendarioUsable ?? o.lastStageChangeAt ?? null;
    const mes = fechaReunion ? monthKeyFromDateString(fechaReunion) : null;

    return {
      opportunityId: o.id,
      contactId: o.contactId,
      nombreContacto,
      empresa,
      cliente,
      closer: calendarMeeting?.closer ?? "Sin calendario",
      mes,
      asistio,
      fuenteAsistio,
      confirmadoPorCalendario: calendarMeeting !== undefined && calendarMeeting.appointmentStatus !== "cancelled",
      fechaReunion,
    };
  });
}

// Marzo-junio 2026 no se anotaban bien en el pipeline (confirmado por
// Daniel) y no son datos fiables — se excluyen de las estadísticas
// agregadas (no del roster completo, que sigue sirviendo para buscar/marcar
// un contacto antiguo si hace falta). A partir de aquí, cada mes nuevo
// aparece solo con que exista al menos una reunión con esa fecha real — no
// hace falta ningún paso manual para que se cree la fila.
export const REUNION_STATS_MIN_MES = "2026-07";

export function filterResolutionsFiables(resolutions: MeetingResolution[]): MeetingResolution[] {
  return resolutions.filter((r) => r.mes !== null && r.mes >= REUNION_STATS_MIN_MES);
}

// LIMITACIÓN CONOCIDA: para quien no tiene evento de calendario encontrado (o
// marcado manual), la fecha usada es "lastStageChangeAt" — un proxy, no la
// fecha real de la reunión (GHL no guarda historial completo de cambios de
// fase). Se declara así en vez de presentarlo como precisión que no existe.
export function computeReunionStats(resolutions: MeetingResolution[], spendByMonth: MonthlySpend[]): ReunionStats[] {
  const byMonth = new Map<string, { agendadas: number; noAsistieron: number; asistidas: number }>();

  for (const r of resolutions) {
    if (!r.mes) continue;
    const entry = byMonth.get(r.mes) ?? { agendadas: 0, noAsistieron: 0, asistidas: 0 };
    entry.agendadas += 1;
    if (r.asistio === "No") entry.noAsistieron += 1;
    if (r.asistio === "Sí") entry.asistidas += 1;
    byMonth.set(r.mes, entry);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, { agendadas, noAsistieron, asistidas }]) => {
      const gasto = spendByMonth.find((s) => s.month === mes)?.spend ?? null;
      const resueltas = noAsistieron + asistidas;
      return {
        mes,
        agendadas,
        noAsistieron,
        asistidas,
        showRate: resueltas > 0 ? asistidas / resueltas : null,
        gastoAds: gasto,
        costePorAgendada: gasto !== null && agendadas > 0 ? gasto / agendadas : null,
        costePorAsistida: gasto !== null && asistidas > 0 ? gasto / asistidas : null,
      };
    });
}

export type CloserBreakdownRow = {
  closer: string;
  agendadas: number;
  noAsistieron: number;
  asistidas: number;
  showRate: number | null;
};

// Desglose por closer, calculado sobre EL MISMO array de resolutions que
// computeReunionStats — garantiza que la suma de los closers cuadra siempre
// con el total agregado, porque no son dos cálculos independientes.
export function computeCloserBreakdown(resolutions: MeetingResolution[]): CloserBreakdownRow[] {
  const byCloser = new Map<string, { agendadas: number; noAsistieron: number; asistidas: number }>();

  for (const r of resolutions) {
    const entry = byCloser.get(r.closer) ?? { agendadas: 0, noAsistieron: 0, asistidas: 0 };
    entry.agendadas += 1;
    if (r.asistio === "No") entry.noAsistieron += 1;
    if (r.asistio === "Sí") entry.asistidas += 1;
    byCloser.set(r.closer, entry);
  }

  return [...byCloser.entries()]
    .sort(([a], [b]) => {
      // Los closers identificados primero, "Otros closers"/"Sin calendario" al final.
      const rank = (name: string) => (name === OTHER_CLOSERS_LABEL || name === "Sin calendario" ? 1 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .map(([closer, { agendadas, noAsistieron, asistidas }]) => {
      const resueltas = noAsistieron + asistidas;
      return { closer, agendadas, noAsistieron, asistidas, showRate: resueltas > 0 ? asistidas / resueltas : null };
    });
}

// Alias confirmados entre el nombre usado en el Sheet y el nombre/empresa del
// contacto en GHL, tomados de Gestión Financiera/mapa-clientes.md (fuente de
// verdad) — solo apodos/nombres reales que NO comparten texto y por tanto no
// los puede encontrar namesLikelyMatch() por sí sola.
const CONFIRMED_NICKNAME_ALIASES: Record<string, string> = {
  pladuastur: "pami",
  desi: "dedica temas y gestion de construccion",
  inbilt: "biocons inbilt",
  "ruben cardenas": "ruben cardenas torres",
  cosmic: "ivan pastoriza estevez",
  // Confirmados por Daniel el 2026-08-05, con evidencia real en GHL:
  // "Impernova" → contacto "marc puxi" (CBO_LEADS_REFOR) — coincide con el
  // alias de mapa-clientes.md ("Impernova → Marc").
  impernova: "marc puxi",
  // "Proworks" → contacto "Jose Ramon" (empresa "Particular" en GHL, pero su
  // email real es proworkspn@gmail.com) — CBO_LEADS_REFOR confirmado.
  proworks: "particular",
  // "Inmobiling" → mismo contacto que "BUILT DIFFERENT" (Pedro Martinez
  // Nuñez): Daniel confirmó que es un acuerdo conjunto de sus dos empresas,
  // facturado bajo el nombre "Inmobiling" en el Sheet (2.420 € = 2.000 € +
  // IVA). Se cruza contra la empresa GHL, no se duplica el ingreso.
  inmobiling: "built different",
};

const STOPWORDS = new Set(["sl", "s.l", "sa", "s.a", "srl", "de", "la", "el", "y", "group", "grupo"]);

function significantTokens(normalized: string): string[] {
  return normalized
    .split(/[\s/]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export type NameMatchReason = "exacto" | "alias" | "coincidencia_de_palabras" | null;

// Compara un nombre del Sheet contra los candidatos (nombre de contacto,
// nombre de empresa) de una oportunidad de GHL, ya normalizados. No depende
// solo de una tabla de alias 1:1 mantenida a mano: cubre también contención
// de texto ("masquepintura" dentro de "masquepintura fasan") y solape de
// palabras significativas en cualquier orden ("alberto guillen / ga
// montajes" vs "montajes ga"), para que clientes nuevos crucen solos sin
// tener que añadir un alias cada vez.
export function namesLikelyMatch(clienteNormalizado: string, candidatos: string[]): NameMatchReason {
  if (candidatos.includes(clienteNormalizado)) return "exacto";

  const aliasDestino = CONFIRMED_NICKNAME_ALIASES[clienteNormalizado];
  if (aliasDestino !== undefined && candidatos.includes(aliasDestino)) return "alias";

  const clienteTokens = significantTokens(clienteNormalizado);
  const clienteSquashed = clienteTokens.join("");
  for (const candidato of candidatos) {
    if (clienteNormalizado.length >= 5 && candidato.includes(clienteNormalizado)) return "coincidencia_de_palabras";
    if (candidato.length >= 5 && clienteNormalizado.includes(candidato)) return "coincidencia_de_palabras";

    const candidatoTokens = significantTokens(candidato);
    if (clienteTokens.length === 0 || candidatoTokens.length === 0) continue;

    // Compara también "sin espacios" (tokens significativos concatenados) —
    // cubre variantes de formato como "Urbansolutions" (Sheet, sin espacio)
    // vs "Urban solutions group" (GHL, con espacio y una palabra de relleno
    // de menos): normalizeClientName ya iguala mayúsculas/acentos, esto
    // iguala además la presencia o no de espacios entre palabras.
    if (clienteSquashed.length >= 5 && clienteSquashed === candidatoTokens.join("")) return "coincidencia_de_palabras";

    const interseccion = clienteTokens.filter((t) => candidatoTokens.includes(t));
    const minTokens = Math.min(clienteTokens.length, candidatoTokens.length);
    if (interseccion.length > 0 && interseccion.length / minTokens >= 0.5) return "coincidencia_de_palabras";
  }

  return null;
}

export type RoasClienteDetalle = {
  cliente: string;
  origenCboLeadsRefor: boolean;
  // Suma de los pagos confirmados (Hecho/50%) de este cliente en TODOS los
  // periodos reportados hasta ahora, no solo el mes en curso — el ROAS es
  // acumulado, se actualiza solo en cuanto se confirma un pago nuevo.
  ingresoAcumulado: number;
  incluidoEnRoas: boolean;
  // Nombre EXACTO en el Sheet, y la pestaña/Estado/Importe/Origen crudo de su
  // fila más reciente — null si todavía no hay ninguna fila. Permite editar
  // directamente desde la sección ROAS sin ir a la tabla de ingresos.
  clienteSheet: string | null;
  periodoEdicion: string | null;
  estadoActual: string | null;
  importeRawActual: string | null;
  // "CBO_LEADS_REFOR" / "Organico" / "" (vacío = automático). Es el valor
  // CRUDO de la columna "Origen" del Sheet, para poder editarlo — distinto
  // de `origenCboLeadsRefor` (el resultado ya aplicado, manual o automático).
  origenActual: string;
  // Solo cuando NO cuenta, en una frase simple sin jerga de cruce de
  // nombres — si no se puede confirmar con certeza a qué cliente pertenece
  // un contacto, se marca "Sin confirmar" y se resuelve preguntando a
  // Daniel directamente, nunca mostrando el detalle técnico del cruce.
  motivo: string | null;
};

export type RoasResult = {
  gastoAdsAcumulado: number;
  ingresoAtribuido: number;
  roas: number | null;
  detalle: RoasClienteDetalle[];
  ultimoPeriodo: string | null;
  motivo: string | null;
};

// Origen manual (columna "Origen" del Sheet) sobre origen automático
// (atribución de GHL). Un valor explícito de Daniel gana SIEMPRE — es la
// palabra del dueño del negocio sobre de dónde vino ese cliente, no una
// sugerencia que el cruce de nombres pueda contradecir.
function origenFinal(automatico: boolean, manual: string | undefined): boolean {
  if (manual === "CBO_LEADS_REFOR") return true;
  if (manual === "Organico") return false;
  return automatico;
}

// ROAS = ingreso confirmado ACUMULADO en el Sheet (sumado a lo largo de
// TODOS los periodos ya reportados) de los clientes cuyo origen es
// CBO_LEADS_REFOR ÷ gasto acumulado de esa misma campaña en ese mismo rango
// de meses. No es una foto de un mes concreto: en cuanto se confirma un pago
// nuevo (Hecho o 50%) en cualquier pestaña, el total sube solo, sin revisión
// manual.
//
// El origen de cada cliente se decide así, en orden:
// 1) Columna "Origen" del Sheet, si Daniel la ha rellenado a mano
//    ("CBO_LEADS_REFOR"/"Organico") — tiene prioridad absoluta.
// 2) Si está vacía, atribución de GHL (`getFirstTouchCampaignId`) para los
//    clientes con oportunidad de Onboarding.
// 3) Si tampoco hay oportunidad de Onboarding, orgánico por defecto.
//
// El detalle se construye en DOS pasadas para que quede completo y honesto:
// 1) los contactos de Onboarding en GHL — cubre tanto los atribuidos a
//    CBO_LEADS_REFOR como los orgánicos ya conocidos.
// 2) cualquier cliente del Sheet que NO haya sido reclamado por ningún
//    contacto de GHL en la pasada 1 — se añade como "Otro / orgánico" salvo
//    que Daniel haya marcado su Origen a mano. Esto es lo que hace que
//    clientes sin ningún registro de Onboarding (ej. clientes antiguos
//    captados por otra vía) aparezcan marcados en vez de no aparecer nunca
//    en esta tabla.
export function computeRoas(
  snapshots: MonthSnapshot[],
  onboardingOpportunities: GhlOpportunity[],
  spendByMonth: MonthlySpend[]
): RoasResult {
  const reportados = snapshots.filter((s) => s.reportado);
  if (reportados.length === 0) {
    return {
      gastoAdsAcumulado: 0,
      ingresoAtribuido: 0,
      roas: null,
      detalle: [],
      ultimoPeriodo: null,
      motivo: "Todavía no hay ningún periodo reportado con el que calcular ROAS.",
    };
  }

  // Todos los nombres normalizados que han aparecido alguna vez en CUALQUIER
  // pestaña reportada — no solo la última — para no perder de vista a un
  // cliente que dejó de listarse en meses recientes (ej. pasó a SBY) pero sí
  // tiene pagos confirmados anteriores que deben seguir contando.
  const todosLosNombresDelSheet = new Set<string>();
  reportados.forEach((s) => Object.keys(s.estadoPorCliente).forEach((n) => todosLosNombresDelSheet.add(n)));

  // La fila "actual" de un cliente (para mostrar/editar Estado/Importe/Origen)
  // es la del periodo reportado más reciente en el que todavía tiene fila.
  function filaActual(
    clienteNormalizado: string
  ): { periodo: string; estado: string; importeRaw: string; nombreOriginal: string; origen: string } | null {
    for (let i = reportados.length - 1; i >= 0; i--) {
      const snap = reportados[i];
      if (clienteNormalizado in snap.estadoPorCliente) {
        return {
          periodo: snap.periodo,
          estado: snap.estadoPorCliente[clienteNormalizado],
          importeRaw: snap.importeRawPorCliente[clienteNormalizado],
          nombreOriginal: snap.nombreOriginalPorCliente[clienteNormalizado],
          origen: snap.origenPorCliente[clienteNormalizado] ?? "",
        };
      }
    }
    return null;
  }

  function ingresoAcumuladoDe(clienteNormalizado: string): number {
    return reportados.reduce((sum, s) => sum + (s.importePorCliente[clienteNormalizado] ?? 0), 0);
  }

  const clientesReclamados = new Set<string>();

  const detalleGhl: RoasClienteDetalle[] = onboardingOpportunities.map((o) => {
    const empresa = o.contact?.companyName ?? null;
    const nombreContacto = o.contact?.name ?? o.name;
    const nombreMostrado = empresa ?? nombreContacto;
    const esCboAutomatico = getFirstTouchCampaignId(o) === OWN_ACQUISITION_CAMPAIGN_ID;
    const candidatos = [nombreContacto, empresa].filter((v): v is string => !!v).map(normalizeClientName);

    let matchNormalizado: string | undefined;
    for (const clienteNormalizado of todosLosNombresDelSheet) {
      if (namesLikelyMatch(clienteNormalizado, candidatos)) {
        matchNormalizado = clienteNormalizado;
        break;
      }
    }
    if (matchNormalizado) clientesReclamados.add(matchNormalizado);

    const fila = matchNormalizado ? filaActual(matchNormalizado) : null;
    const ingresoAcumulado = matchNormalizado ? ingresoAcumuladoDe(matchNormalizado) : 0;
    const esCbo = origenFinal(esCboAutomatico, fila?.origen);

    if (!fila) {
      return {
        cliente: nombreMostrado,
        origenCboLeadsRefor: esCbo,
        ingresoAcumulado: 0,
        incluidoEnRoas: false,
        clienteSheet: null,
        periodoEdicion: null,
        estadoActual: null,
        importeRawActual: null,
        origenActual: "",
        motivo: esCbo ? "Sin confirmar." : "Origen orgánico, no CBO_LEADS_REFOR.",
      };
    }

    const incluido = esCbo && ingresoAcumulado > 0;
    return {
      cliente: nombreMostrado,
      origenCboLeadsRefor: esCbo,
      ingresoAcumulado,
      incluidoEnRoas: incluido,
      clienteSheet: fila.nombreOriginal,
      periodoEdicion: fila.periodo,
      estadoActual: fila.estado,
      importeRawActual: fila.importeRaw,
      origenActual: fila.origen,
      motivo: incluido ? null : esCbo ? "Todavía sin ningún pago confirmado." : "Origen orgánico, no CBO_LEADS_REFOR.",
    };
  });

  // Segunda pasada: clientes del Sheet no reclamados por ningún contacto de
  // GHL — orgánicos por defecto salvo que Daniel haya marcado su Origen a
  // mano, con su fila real ya lista para editar.
  const detalleSoloSheet: RoasClienteDetalle[] = [...todosLosNombresDelSheet]
    .filter((clienteNormalizado) => !clientesReclamados.has(clienteNormalizado))
    .map((clienteNormalizado) => {
      const fila = filaActual(clienteNormalizado)!;
      const esCbo = origenFinal(false, fila.origen);
      const ingresoAcumulado = ingresoAcumuladoDe(clienteNormalizado);
      const incluido = esCbo && ingresoAcumulado > 0;
      return {
        cliente: fila.nombreOriginal,
        origenCboLeadsRefor: esCbo,
        ingresoAcumulado,
        incluidoEnRoas: incluido,
        clienteSheet: fila.nombreOriginal,
        periodoEdicion: fila.periodo,
        estadoActual: fila.estado,
        importeRawActual: fila.importeRaw,
        origenActual: fila.origen,
        motivo: incluido ? null : esCbo ? "Todavía sin ningún pago confirmado." : "Origen orgánico, no CBO_LEADS_REFOR.",
      };
    });

  const detalle = [...detalleGhl, ...detalleSoloSheet];
  const ingresoAtribuido = detalle.filter((d) => d.incluidoEnRoas).reduce((sum, d) => sum + d.ingresoAcumulado, 0);
  const ultimoPeriodo = reportados[reportados.length - 1].periodo;

  const mesesReportados = new Set(reportados.map((s) => s.mes).filter((m): m is string => m !== null));
  if (mesesReportados.size === 0) {
    return {
      gastoAdsAcumulado: 0,
      ingresoAtribuido,
      roas: null,
      detalle,
      ultimoPeriodo,
      motivo: "Ninguna pestaña reportada tiene un mes identificable — no se puede cruzar con el gasto de Meta Ads.",
    };
  }

  const gastoAdsAcumulado = spendByMonth
    .filter((s) => mesesReportados.has(s.month))
    .reduce((sum, s) => sum + s.spend, 0);

  return {
    gastoAdsAcumulado,
    ingresoAtribuido,
    roas: gastoAdsAcumulado > 0 ? ingresoAtribuido / gastoAdsAcumulado : null,
    detalle,
    ultimoPeriodo,
    motivo:
      ingresoAtribuido === 0
        ? "Ningún cliente de CBO_LEADS_REFOR tiene ingreso confirmado todavía — ver detalle por cliente."
        : null,
  };
}

export type LtvCacResult = { ratio: number | null; motivo: string | null };

export function computeLtvCacRatio(ltv: LtvResult, cacUltimoPeriodo: CacResult | undefined): LtvCacResult {
  if (ltv.ltv === null) {
    return { ratio: null, motivo: `LTV no disponible: ${ltv.motivo ?? "sin datos suficientes."}` };
  }
  if (!cacUltimoPeriodo || cacUltimoPeriodo.cac === null) {
    return {
      ratio: null,
      motivo: `CAC no disponible: ${cacUltimoPeriodo?.motivo ?? "sin periodo con CAC calculado todavía."}`,
    };
  }
  return { ratio: ltv.ltv / cacUltimoPeriodo.cac, motivo: null };
}
