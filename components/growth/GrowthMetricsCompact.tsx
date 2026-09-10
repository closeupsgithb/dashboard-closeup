import { formatPercent } from "@/lib/format";

export type PeriodFunnel = {
  reunionesAgendadas: number;
  reunionesRealizadas: number;
  noShows: number;
  pendientes: number;
  ventasPagadas: number;
  showRate: number | null;
  closeRate: number | null;
};

// Sin barra de acento lateral: el color vive en el KPI que lo necesita, no
// en la tarjeta entera — una tarjeta coloreada por completo se lee como un
// estado de esa sección, y no es lo que se quiere comunicar aquí.
function Block({ title, columns, children }: { title: string; columns: number; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--card-shadow)" }}
    >
      <div className="mb-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-secondary)" }}>
        {title}
      </div>
      <div className="grid items-end gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {children}
      </div>
    </div>
  );
}

// accentVar solo se pasa en los KPIs pensados para destacar (tasas) —
// los valores absolutos se quedan en tinta neutra a propósito.
function Metric({ value, label, accentVar }: { value: string; label: string; accentVar?: string }) {
  return (
    <div>
      <div className="text-[28px] font-semibold leading-none tabular" style={{ color: accentVar ? `var(${accentVar})` : "var(--ink)" }}>
        {value}
      </div>
      <div className="mt-1.5 text-[13px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
    </div>
  );
}

export function GrowthMetricsCompact({ funnel }: { funnel: PeriodFunnel }) {
  return (
    <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
      <Block title="Reuniones" columns={2}>
        <Metric value={String(funnel.reunionesAgendadas)} label="Agendadas" accentVar="--brand" />
        <Metric value={String(funnel.reunionesRealizadas)} label="Realizadas" />
      </Block>
      <Block title="Asistencia" columns={4}>
        <Metric value={formatPercent(funnel.showRate)} label="Show rate" accentVar="--status-good" />
        <Metric value={String(funnel.reunionesRealizadas)} label="Asistidas" />
        <Metric value={String(funnel.noShows)} label="No shows" />
        <Metric value={String(funnel.pendientes)} label="Pendientes" />
      </Block>
      <Block title="Ventas" columns={2}>
        <Metric value={formatPercent(funnel.closeRate)} label="Close rate" accentVar="--status-good" />
        <Metric value={String(funnel.ventasPagadas)} label="Ventas" />
      </Block>
    </section>
  );
}
