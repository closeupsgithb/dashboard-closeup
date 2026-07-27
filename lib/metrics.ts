import type { MonthlySpend } from "@/lib/metaAds";
import type { GhlOpportunity } from "@/lib/ghl";
import { PIPELINES } from "@/lib/ghl";

// "SBY" es un estado de cliente (pausado / no renovó / vuelve en fecha conocida),
// no una pestaña de facturación — se excluye de la lista de periodos de pago.
const NON_PERIOD_TABS = new Set(["SBY"]);

// Las pestañas de periodo actuales no siempre llevan nombre de mes ("Hoja 2" es
// julio 2026 por los comentarios de fecha) — mapeo manual de respaldo mientras
// no se rebauticen las pestañas con el nombre del mes real.
const MANUAL_TAB_TO_MONTH: Record<string, string> = {
  "Hoja 2": "2026-07",
};

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
};

function parseTabRows(rows: string[][]): PeriodEntry[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const idx = {
    nombre: header.indexOf("Nombre"),
    importe: header.indexOf("Importe"),
    estado: header.indexOf("Estado"),
    comentario: header.indexOf("Comentario"),
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
      };
    });
}

const CONFIRMED_STATES = new Set(["Hecho", "50%"]);

export type MonthSnapshot = {
  periodo: string;
  mes: string | null;
  ingresoConfirmado: number;
  clientesConfirmados: string[];
  clientesPendientes: string[];
  clientesEnPausa: string[];
  importePorCliente: Record<string, number>;
  entradasNoInterpretables: { cliente: string; raw: string }[];
};

export function buildMonthSnapshots(
  tabsData: Record<string, string[][]>,
  periodTabOrder: string[]
): MonthSnapshot[] {
  return periodTabOrder
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

      return {
        periodo: tabName,
        mes: inferMonthFromTabName(tabName),
        ingresoConfirmado: confirmadas.reduce((sum, e) => sum + (e.importe.value ?? 0), 0),
        clientesConfirmados: confirmadas.map((e) => e.clienteNormalizado),
        clientesPendientes: pendientes.map((e) => e.clienteNormalizado),
        clientesEnPausa: enPausa.map((e) => e.clienteNormalizado),
        importePorCliente,
        entradasNoInterpretables: entries
          .filter((e) => e.importe.needsReview)
          .map((e) => ({ cliente: e.cliente, raw: e.importe.raw })),
      };
    });
}

export type SbySnapshot = { cliente: string; clienteNormalizado: string; comentario: string };

export function parseSbyTab(rows: string[][]): SbySnapshot[] {
  return parseTabRows(rows).map((e) => ({
    cliente: e.cliente,
    clienteNormalizado: e.clienteNormalizado,
    comentario: e.comentario,
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

// CAC = gasto de la campaña propia de captación (CBO_LEADS_REFOR) del mes ÷
// nº de clientes cuyo PRIMER registro confirmado (Hecho/50%) aparece ese mes.
// El primer periodo de la serie nunca tiene CAC: no hay un "antes" con el que
// comparar quién es realmente nuevo.
export function computeCac(snapshots: MonthSnapshot[], spendByMonth: MonthlySpend[]): CacResult[] {
  const seenBefore = new Set<string>();

  return snapshots.map((snap, i) => {
    const clientesNuevos =
      i === 0 ? null : snap.clientesConfirmados.filter((c) => !seenBefore.has(c)).length;
    snap.clientesConfirmados.forEach((c) => seenBefore.add(c));

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
  });
}

export type ChurnResult = {
  periodo: string;
  clientesMesAnterior: number;
  clientesBaja: string[];
  churnRate: number | null;
  motivo: string | null;
};

// Baja = facturado (Hecho/50%) el periodo anterior, y este periodo ni factura
// ni aparece en SBY (si está en SBY se trata como "en pausa", no como baja).
export function computeChurn(snapshots: MonthSnapshot[], sbyByPeriod: SbySnapshot[][]): ChurnResult[] {
  return snapshots.map((snap, i) => {
    if (i === 0) {
      return {
        periodo: snap.periodo,
        clientesMesAnterior: 0,
        clientesBaja: [],
        churnRate: null,
        motivo: "Primer periodo con datos: no hay mes anterior con el que comparar.",
      };
    }

    const anterior = snapshots[i - 1];
    const enPausaActual = new Set([
      ...(sbyByPeriod[i] ?? []).map((s) => s.clienteNormalizado),
      ...snap.clientesEnPausa,
    ]);
    const confirmadosActual = new Set(snap.clientesConfirmados);

    const bajas = anterior.clientesConfirmados.filter(
      (c) => !confirmadosActual.has(c) && !enPausaActual.has(c)
    );

    return {
      periodo: snap.periodo,
      clientesMesAnterior: anterior.clientesConfirmados.length,
      clientesBaja: bajas,
      churnRate: anterior.clientesConfirmados.length > 0 ? bajas.length / anterior.clientesConfirmados.length : null,
      motivo: null,
    };
  });
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

export type PendienteSeguimiento = { cliente: string; mesesConsecutivosPendiente: number };

export function computePendingFollowUp(snapshots: MonthSnapshot[]): PendienteSeguimiento[] {
  if (snapshots.length === 0) return [];
  const ultimo = snapshots[snapshots.length - 1];

  return ultimo.clientesPendientes.map((cliente) => {
    let meses = 0;
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].clientesPendientes.includes(cliente)) {
        meses += 1;
      } else {
        break;
      }
    }
    return { cliente, mesesConsecutivosPendiente: meses };
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
