import { formatPercent } from "@/lib/format";

export type PeriodCloserRow = {
  closerId: string | null;
  closerName: string;
  reunionesAgendadas: number;
  reunionesRealizadas: number;
  noShows: number;
  ventasPagadas: number;
  showRate: number | null;
  closeRate: number | null;
};

export function GrowthCloserComparison({ data }: { data: PeriodCloserRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Sin reuniones en este periodo.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: "32rem" }}>
        <thead>
          <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
            <th className="pb-2 font-normal">Closer</th>
            <th className="pb-2 font-normal text-right">Reuniones</th>
            <th className="pb-2 font-normal text-right">Asistencias</th>
            <th className="pb-2 font-normal text-right">Show rate</th>
            <th className="pb-2 font-normal text-right">Ventas</th>
            <th className="pb-2 font-normal text-right">Close rate</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.closerId ?? "sin-asignar"} className="border-t tabular" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-2">{row.closerName}</td>
              <td className="py-2 text-right">{row.reunionesAgendadas}</td>
              <td className="py-2 text-right">{row.reunionesRealizadas}</td>
              <td className="py-2 text-right">{formatPercent(row.showRate)}</td>
              <td className="py-2 text-right">{row.ventasPagadas}</td>
              <td className="py-2 text-right">{formatPercent(row.closeRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
