const MADRID_TZ = "Europe/Madrid";

// Fecha (YYYY-MM-DD) en la España peninsular, sea cual sea el huso horario
// del servidor o del navegador donde se ejecute — usa Intl con timeZone
// explícito en vez de depender del huso horario ambiente (getUTC* o
// setHours() locales dan el día equivocado cerca de medianoche si el
// servidor/navegador no está en Europe/Madrid, o si la fecha de origen viene
// en UTC "Z" en vez de con el offset local ya incluido).
export function madridDateOnly(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatEUR(value: number | null): string {
  if (value === null) return "N/D";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    value
  );
}

export function formatPercent(value: number | null): string {
  if (value === null) return "N/D";
  return new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function formatMonths(value: number | null): string {
  if (value === null) return "N/D";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)} meses`;
}

const MONTH_LABELS: Record<string, string> = {
  "01": "ene", "02": "feb", "03": "mar", "04": "abr", "05": "may", "06": "jun",
  "07": "jul", "08": "ago", "09": "sep", "10": "oct", "11": "nov", "12": "dic",
};

const MONTH_LABELS_FULL: Record<string, string> = {
  "01": "Enero", "02": "Febrero", "03": "Marzo", "04": "Abril", "05": "Mayo", "06": "Junio",
  "07": "Julio", "08": "Agosto", "09": "Septiembre", "10": "Octubre", "11": "Noviembre", "12": "Diciembre",
};

export function formatMonthLabel(mes: string | null, fallback: string): string {
  if (!mes) return fallback;
  const [year, month] = mes.split("-");
  return `${MONTH_LABELS[month] ?? month} ${year.slice(2)}`;
}

export function formatFullMonthLabel(mes: string | null, fallback: string): string {
  if (!mes) return fallback;
  const [year, month] = mes.split("-");
  return `${MONTH_LABELS_FULL[month] ?? month} ${year}`;
}

export function formatRatio(value: number | null): string {
  if (value === null) return "N/D";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)} : 1`;
}

// Duración en milisegundos -> texto legible corto ("18 min", "3,2 h", "2,1
// días") — usado para "tiempo hasta primer contacto" y "esperando contacto
// desde hace...". Elige la unidad más legible en vez de mostrar siempre
// horas o siempre minutos.
export function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(hours)} h`;
  const days = hours / 24;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(days)} días`;
}

// Fecha humana relativa a hoy en Madrid: "Hoy" / "Mañana" / "23 de agosto"
// (sin año si es el año en curso, con año si no) — para follow-ups y
// cualquier fecha que un closer deba leer de un vistazo, sin formato técnico
// ISO (YYYY-MM-DD).
export function formatHumanDate(iso: string, now: Date = new Date()): string {
  const target = madridDateOnly(iso);
  const today = madridDateOnly(now);
  if (target === today) return "Hoy";

  const [ty, tm, td] = target.split("-").map(Number);
  const [ny] = today.split("-").map(Number);
  const tomorrow = madridDateOnly(new Date(Date.UTC(ty, tm - 1, td - 1)));
  // Truco: comparamos "target - 1 día" contra "today" en vez de "today + 1
  // día" contra target, para no reimplementar suma de fechas dos veces.
  if (tomorrow === today) return "Mañana";

  const day = td;
  const month = MONTH_LABELS_FULL[String(tm).padStart(2, "0")]?.toLowerCase() ?? String(tm);
  return ty === ny ? `${day} de ${month}` : `${day} de ${month} de ${ty}`;
}

// Duración en milisegundos -> texto humano SIN decimales para tiempos de
// espera que un closer escanea (p. ej. "Esperando desde"): "18 min", "3 h",
// "7 días" — a diferencia de formatDurationMs (que conserva 1 decimal para
// contextos donde la precisión importa, como el tiempo medio agregado).
export function formatWaitTime(ms: number): string {
  if (ms < 0) ms = 0;
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} h`;
  const days = Math.round(hours / 24);
  return `${days} día${days === 1 ? "" : "s"}`;
}

export function formatSignedPercent(value: number | null): string {
  if (value === null) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 0 }).format(value)}`;
}
