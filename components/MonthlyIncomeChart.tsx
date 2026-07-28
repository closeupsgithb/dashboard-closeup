import { formatEUR, formatFullMonthLabel, formatSignedPercent } from "@/lib/format";

export type IncomePoint = {
  periodo: string;
  mes: string | null;
  reportado: boolean;
  ingreso: number;
  ingresoPendiente: number;
};

const CHART_HEIGHT = 160;
const BAR_MAX_WIDTH = 28;
const SEGMENT_GAP = 2;
// Hueco reservado por encima de la barra más alta para hasta 3 líneas de
// etiqueta apiladas (confirmado, pendiente, variación %) sin que se corten
// contra el borde superior del viewBox.
const TOP_LABEL_SPACE = 50;
// Ancho de diseño fijo (no depende del nº de barras) para que el viewBox
// nunca quede mucho más estrecho que el contenedor real — si no, SVG escala
// todo (incluido el texto) al estirar un viewBox diminuto a ancho completo.
const DESIGN_WIDTH = 640;

function Legend() {
  return (
    <div className="mb-3 flex items-center gap-4 text-xs" style={{ color: "var(--ink-secondary)" }}>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--brand)" }} />
        Confirmado
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--status-warning)" }} />
        Pendiente
      </span>
    </div>
  );
}

// Barra apilada de dos series (confirmado + pendiente), con la separación de
// 2px entre segmentos que pide el skill de dataviz para que se lean distintos
// sin necesitar un borde. Los meses todavía sin datos se muestran como pista
// vacía punteada en vez de una barra a cero (que se leería como "cayó a
// cero", cuando en realidad es que el mes no está rellenado todavía). La
// variación % solo se muestra cuando hay un periodo reportado anterior con el
// que comparar.
export function MonthlyIncomeChart({ data }: { data: IncomePoint[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Todavía no hay pestañas de periodo en el Sheet.
      </p>
    );
  }

  const maxValue = Math.max(1, ...data.filter((d) => d.reportado).map((d) => d.ingreso + d.ingresoPendiente));
  const slotWidth = DESIGN_WIDTH / data.length;
  const barWidth = Math.min(BAR_MAX_WIDTH, slotWidth * 0.5);

  let lastReported: IncomePoint | null = null;

  return (
    <div>
      <Legend />
      <svg width="100%" viewBox={`0 0 ${DESIGN_WIDTH} ${CHART_HEIGHT + 40}`} role="img" aria-label="Ingreso mensual confirmado y pendiente por periodo">
        <line x1={0} x2={DESIGN_WIDTH} y1={CHART_HEIGHT} y2={CHART_HEIGHT} stroke="var(--baseline)" strokeWidth={1} />
        {data.map((d, i) => {
          const x = i * slotWidth + (slotWidth - barWidth) / 2;
          const label = formatFullMonthLabel(d.mes, d.periodo);

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

          const confirmadoHeight = Math.max(0, (d.ingreso / maxValue) * (CHART_HEIGHT - TOP_LABEL_SPACE));
          const pendienteHeight = Math.max(0, (d.ingresoPendiente / maxValue) * (CHART_HEIGHT - TOP_LABEL_SPACE));
          const hasPendiente = pendienteHeight > 0;

          const confirmadoY = CHART_HEIGHT - confirmadoHeight;
          const pendienteY = confirmadoY - (hasPendiente ? pendienteHeight + SEGMENT_GAP : 0);

          const delta =
            lastReported && lastReported.ingreso > 0 ? (d.ingreso - lastReported.ingreso) / lastReported.ingreso : null;
          lastReported = d;

          // Un segmento interior (confirmado, cuando hay pendiente encima) no
          // tiene extremo libre — por las mark specs, esos no llevan etiqueta
          // propia pegada al segmento. En vez de eso, ambos valores se apilan
          // en el hueco libre por ENCIMA de toda la barra, nunca tocándola.
          const topY = hasPendiente ? pendienteY : confirmadoY;
          const confirmadoLabelY = hasPendiente ? topY - 20 : topY - 6;
          const pendienteLabelY = topY - 6;
          const deltaLabelY = (hasPendiente ? topY - 34 : topY - 20);

          return (
            <g key={d.periodo}>
              <text x={x + barWidth / 2} y={confirmadoLabelY} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
                {formatEUR(d.ingreso)}
              </text>
              {hasPendiente && (
                <text x={x + barWidth / 2} y={pendienteLabelY} textAnchor="middle" fontSize={10} fill="var(--ink-secondary)">
                  +{formatEUR(d.ingresoPendiente)} pendiente
                </text>
              )}
              {delta !== null && (
                <text
                  x={x + barWidth / 2}
                  y={deltaLabelY}
                  textAnchor="middle"
                  fontSize={10}
                  fill={delta >= 0 ? "var(--status-good)" : "var(--status-critical)"}
                >
                  {formatSignedPercent(delta)}
                </text>
              )}

              {/* Segmento confirmado (abajo, color de marca) */}
              <path
                d={`M ${x} ${confirmadoY + (hasPendiente ? 0 : 4)}
                    ${hasPendiente ? `L ${x} ${confirmadoY}` : `A 4 4 0 0 1 ${x + 4} ${confirmadoY}`}
                    L ${x + barWidth - (hasPendiente ? 0 : 4)} ${confirmadoY}
                    ${hasPendiente ? "" : `A 4 4 0 0 1 ${x + barWidth} ${confirmadoY + 4}`}
                    L ${x + barWidth} ${CHART_HEIGHT}
                    L ${x} ${CHART_HEIGHT}
                    Z`}
                fill="var(--brand)"
              />

              {/* Segmento pendiente (arriba, ámbar), separado por 2px */}
              {hasPendiente && (
                <path
                  d={`M ${x} ${pendienteY + 4}
                      A 4 4 0 0 1 ${x + 4} ${pendienteY}
                      L ${x + barWidth - 4} ${pendienteY}
                      A 4 4 0 0 1 ${x + barWidth} ${pendienteY + 4}
                      L ${x + barWidth} ${confirmadoY - SEGMENT_GAP}
                      L ${x} ${confirmadoY - SEGMENT_GAP}
                      Z`}
                  fill="var(--status-warning)"
                />
              )}

              <text x={x + barWidth / 2} y={CHART_HEIGHT + 16} textAnchor="middle" fontSize={11} fill="var(--ink-secondary)">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
