import { formatEUR, formatFullMonthLabel, formatPercent } from "@/lib/format";

export type ReunionStatsRow = {
  mes: string;
  agendadas: number;
  asistidas: number;
  showRate: number | null;
  gastoAds: number | null;
  costePorAgendada: number | null;
  costePorAsistida: number | null;
};

export function ReunionStatsTable({ data }: { data: ReunionStatsRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Todavía no hay ninguna reunión agendada registrada.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
          <th className="pb-2 font-normal">Mes</th>
          <th className="pb-2 font-normal text-right">Agendadas</th>
          <th className="pb-2 font-normal text-right">Asistidas</th>
          <th className="pb-2 font-normal text-right">Show rate</th>
          <th className="pb-2 font-normal text-right">Coste / agendada</th>
          <th className="pb-2 font-normal text-right">Coste / asistida</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.mes} className="border-t tabular" style={{ borderColor: "var(--gridline)" }}>
            <td className="py-2">{formatFullMonthLabel(row.mes, row.mes)}</td>
            <td className="py-2 text-right">{row.agendadas}</td>
            <td className="py-2 text-right">{row.asistidas}</td>
            <td className="py-2 text-right">{formatPercent(row.showRate)}</td>
            <td className="py-2 text-right">{formatEUR(row.costePorAgendada)}</td>
            <td className="py-2 text-right">{formatEUR(row.costePorAsistida)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
