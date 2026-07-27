import { StatusBadge } from "@/components/StatusBadge";

export type PendingRow = { cliente: string; mesesConsecutivosPendiente: number };

export function PendingFollowUpTable({ data }: { data: PendingRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Ningún cliente pendiente de cobro este periodo.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
          <th className="pb-2 font-normal">Cliente</th>
          <th className="pb-2 font-normal">Estado</th>
          <th className="pb-2 font-normal text-right">Meses seguidos pendiente</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.cliente} className="border-t" style={{ borderColor: "var(--gridline)" }}>
            <td className="py-2 capitalize">{row.cliente}</td>
            <td className="py-2">
              <StatusBadge variant="warning" label="Pendiente" />
            </td>
            <td className="py-2 text-right tabular">
              {row.mesesConsecutivosPendiente}
              {row.mesesConsecutivosPendiente >= 2 ? " — revisar" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
