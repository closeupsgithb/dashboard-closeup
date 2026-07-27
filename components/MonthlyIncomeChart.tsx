import { formatEUR, formatMonthLabel } from "@/lib/format";

export type IncomePoint = {
  periodo: string;
  mes: string | null;
  reportado: boolean;
  ingreso: number;
};

const CHART_HEIGHT = 160;
const BAR_MAX_WIDTH = 24;
// Ancho de diseño fijo (no depende del nº de barras) para que el viewBox
// nunca quede mucho más estrecho que el contenedor real — si no, SVG escala
// todo (incluido el texto) al estirar un viewBox diminuto a ancho completo.
const DESIGN_WIDTH = 640;

// Barra única serie en el color de marca, por las mark specs del skill de
// dataviz: grosor tope 24px, extremo superior redondeado 4px, cuadrada en la
// base, valor en el extremo. Los meses todavía sin datos se muestran como
// pista vacía punteada en vez de una barra a cero (que se leería como "cayó a
// cero", cuando en realidad es que el mes no está rellenado todavía).
export function MonthlyIncomeChart({ data }: { data: IncomePoint[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Todavía no hay pestañas de periodo en el Sheet.
      </p>
    );
  }

  const maxValue = Math.max(1, ...data.filter((d) => d.reportado).map((d) => d.ingreso));
  const slotWidth = DESIGN_WIDTH / data.length;
  const barWidth = Math.min(BAR_MAX_WIDTH, slotWidth * 0.5);

  return (
    <svg width="100%" viewBox={`0 0 ${DESIGN_WIDTH} ${CHART_HEIGHT + 36}`} role="img" aria-label="Ingreso mensual confirmado por periodo">
      <line
        x1={0}
        x2={DESIGN_WIDTH}
        y1={CHART_HEIGHT}
        y2={CHART_HEIGHT}
        stroke="var(--baseline)"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const x = i * slotWidth + (slotWidth - barWidth) / 2;
        const label = formatMonthLabel(d.mes, d.periodo);

        if (!d.reportado) {
          return (
            <g key={d.periodo}>
              <rect
                x={x}
                y={CHART_HEIGHT - 28}
                width={barWidth}
                height={28}
                rx={4}
                fill="none"
                stroke="var(--gridline)"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <text x={x + barWidth / 2} y={CHART_HEIGHT - 34} textAnchor="middle" fontSize={9} fill="var(--ink-muted)">
                sin datos
              </text>
              <text x={x + barWidth / 2} y={CHART_HEIGHT + 16} textAnchor="middle" fontSize={11} fill="var(--ink-secondary)">
                {label}
              </text>
            </g>
          );
        }

        const barHeight = Math.max(2, (d.ingreso / maxValue) * (CHART_HEIGHT - 24));
        const y = CHART_HEIGHT - barHeight;

        return (
          <g key={d.periodo}>
            <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
              {formatEUR(d.ingreso)}
            </text>
            <path
              d={`M ${x} ${y + 4}
                  A 4 4 0 0 1 ${x + 4} ${y}
                  L ${x + barWidth - 4} ${y}
                  A 4 4 0 0 1 ${x + barWidth} ${y + 4}
                  L ${x + barWidth} ${CHART_HEIGHT}
                  L ${x} ${CHART_HEIGHT}
                  Z`}
              fill="var(--brand)"
            />
            <text x={x + barWidth / 2} y={CHART_HEIGHT + 16} textAnchor="middle" fontSize={11} fill="var(--ink-secondary)">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
