export type StageCount = { stage: string; count: number };

const BAR_HEIGHT = 20;
const ROW_GAP = 12;
const TOP_PADDING = 14;
// Mismo ancho de diseño que MonthlyIncomeChart — un viewBox mucho más
// estrecho que el contenedor real hace que SVG escale de más el texto.
const DESIGN_WIDTH = 640;
const BAR_MAX_LENGTH = 460;

// Barra horizontal de una sola serie (naranja de marca): el orden de las
// fases ya lo transmite la posición (de arriba abajo, en el orden real del
// pipeline), así que no hace falta además codificar el orden con un degradado
// de luminosidad — sería redundante para solo dos fases.
export function OnboardingStageBar({ data }: { data: StageCount[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        No hay clientes en Onboarding todavía.
      </p>
    );
  }

  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const height = data.length * (BAR_HEIGHT + ROW_GAP) + TOP_PADDING;

  return (
    <svg width="100%" viewBox={`0 0 ${DESIGN_WIDTH} ${height}`} role="img" aria-label="Clientes por fase de Onboarding">
      {data.map((d, i) => {
        const y = TOP_PADDING + i * (BAR_HEIGHT + ROW_GAP);
        const barWidth = Math.max(4, (d.count / maxCount) * BAR_MAX_LENGTH);
        return (
          <g key={d.stage}>
            <text x={0} y={y - 3} fontSize={11} fill="var(--ink-secondary)">
              {d.stage}
            </text>
            <rect x={0} y={y} width={barWidth} height={BAR_HEIGHT} rx={4} fill="var(--brand)" />
            <text x={barWidth + 8} y={y + BAR_HEIGHT / 2 + 4} fontSize={12} fontWeight={600} fill="var(--ink)">
              {d.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
