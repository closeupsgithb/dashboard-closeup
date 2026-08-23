import { madridDateOnly } from "@/lib/format";

const MADRID_TZ = "Europe/Madrid";

// Offset real de Madrid (con cambio de hora de verano/invierno incluido)
// para el día dado — necesario para convertir "medianoche en Madrid" a un
// instante UTC exacto sin asumir un offset fijo (+1/+2 cambia en marzo/octubre).
function madridOffsetMinutes(dateStr: string): number {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: MADRID_TZ, timeZoneName: "shortOffset" }).formatToParts(probe);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = match ? parseInt(match[1], 10) : 0;
  const minutes = match?.[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

function startOfMadridDay(dateStr: string): Date {
  const offsetMin = madridOffsetMinutes(dateStr);
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - offsetMin * 60000);
}

export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsToMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Lunes de la semana natural (ISO) a la que pertenece dateStr.
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(dateStr, diff);
}

export type PeriodBounds = { start: Date; end: Date };

export function dayBounds(dateStr: string): PeriodBounds {
  return { start: startOfMadridDay(dateStr), end: startOfMadridDay(addDays(dateStr, 1)) };
}

export function weekBounds(dateStr: string): PeriodBounds {
  const monday = mondayOf(dateStr);
  return { start: startOfMadridDay(monday), end: startOfMadridDay(addDays(monday, 7)) };
}

export function monthBounds(monthStr: string): PeriodBounds {
  const start = `${monthStr}-01`;
  const nextMonth = addMonthsToMonth(monthStr, 1);
  return { start: startOfMadridDay(start), end: startOfMadridDay(`${nextMonth}-01`) };
}

export type PeriodType = "hoy" | "semana" | "mes";

export type PeriodInfo = {
  tipo: PeriodType;
  ref: string; // fecha YYYY-MM-DD (hoy/semana) o mes YYYY-MM (mes) de referencia
  label: string;
  start: string; // ISO
  end: string; // ISO
  prevRef: string;
  nextRef: string;
};

const DAY_LABELS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const MONTH_LABELS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  const monthShort = MONTH_LABELS[m - 1].slice(0, 3);
  return `${d} ${monthShort}`;
}

export function resolvePeriod(tipo: PeriodType, ref: string | null, nowMadrid: string): PeriodInfo {
  if (tipo === "hoy") {
    const dateStr = ref || nowMadrid;
    const { start, end } = dayBounds(dateStr);
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = DAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return {
      tipo,
      ref: dateStr,
      label: `HOY · ${dow} ${shortDate(dateStr)}`,
      start: start.toISOString(),
      end: end.toISOString(),
      prevRef: addDays(dateStr, -1),
      nextRef: addDays(dateStr, 1),
    };
  }
  if (tipo === "semana") {
    const dateStr = ref || nowMadrid;
    const monday = mondayOf(dateStr);
    const sunday = addDays(monday, 6);
    const { start, end } = weekBounds(dateStr);
    return {
      tipo,
      ref: dateStr,
      label: `SEMANA · ${shortDate(monday)}–${shortDate(sunday)}`,
      start: start.toISOString(),
      end: end.toISOString(),
      prevRef: addDays(monday, -7),
      nextRef: addDays(monday, 7),
    };
  }
  const monthStr = ref || nowMadrid.slice(0, 7);
  const { start, end } = monthBounds(monthStr);
  const [y, m] = monthStr.split("-").map(Number);
  return {
    tipo,
    ref: monthStr,
    label: `MES · ${MONTH_LABELS[m - 1]} ${y}`,
    start: start.toISOString(),
    end: end.toISOString(),
    prevRef: addMonthsToMonth(monthStr, -1),
    nextRef: addMonthsToMonth(monthStr, 1),
  };
}

export { madridDateOnly };
