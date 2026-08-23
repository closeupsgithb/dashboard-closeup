import { formatPercent } from "@/lib/format";

export type CloserBreakdownRow = {
  closer: string;
  agendadas: number;
  noAsistieron: number;
  asistidas: number;
  showRate: number | null;
};

export function CloserBreakdownTable({ data }: { data: CloserBreakdownRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Todavía no hay reuniones registradas.
      </p>
    );
  }

  const total = data.reduce(
    (acc, r) => ({
      agendadas: acc.agendadas + r.agendadas,
      noAsistieron: acc.noAsistieron + r.noAsistieron,
      asistidas: acc.asistidas + r.asistidas,
    }),
    { agendadas: 0, noAsistieron: 0, asistidas: 0 }
  );
  const resueltas = total.noAsistieron + total.asistidas;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
          <th className="pb-2 font-normal">Closer</th>
          <th className="pb-2 font-normal text-right">Agendadas</th>
          <th className="pb-2 font-normal text-right">No asistieron</th>
          <th className="pb-2 font-normal text-right">Asistidas</th>
          <th className="pb-2 font-normal text-right">Show rate</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.closer} className="border-t tabular" style={{ borderColor: "var(--gridline)" }}>
            <td className="py-2">{row.closer}</td>
            <td className="py-2 text-right">{row.agendadas}</td>
            <td className="py-2 text-right">{row.noAsistieron}</td>
            <td className="py-2 text-right">{row.asistidas}</td>
            <td className="py-2 text-right">{formatPercent(row.showRate)}</td>
          </tr>
        ))}
        <tr className="border-t tabular font-medium" style={{ borderColor: "var(--gridline)" }}>
          <td className="py-2">Total agencia</td>
          <td className="py-2 text-right">{total.agendadas}</td>
          <td className="py-2 text-right">{total.noAsistieron}</td>
          <td className="py-2 text-right">{total.asistidas}</td>
          <td className="py-2 text-right">{formatPercent(resueltas > 0 ? total.asistidas / resueltas : null)}</td>
        </tr>
      </tbody>
    </table>
  );
}
