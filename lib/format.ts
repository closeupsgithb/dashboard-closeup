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

export function formatSignedPercent(value: number | null): string {
  if (value === null) return "";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 0 }).format(value)}`;
}
