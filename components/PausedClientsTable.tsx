import { StatusBadge } from "@/components/StatusBadge";

export type PausedRow = { cliente: string; comentario: string };

export function PausedClientsTable({ data }: { data: PausedRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Ningún cliente en pausa.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
          <th className="pb-2 font-normal">Cliente</th>
          <th className="pb-2 font-normal">Estado</th>
          <th className="pb-2 font-normal">Comentario (revisar fecha de retorno)</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.cliente} className="border-t" style={{ borderColor: "var(--gridline)" }}>
            <td className="py-2">{row.cliente}</td>
            <td className="py-2">
              <StatusBadge variant="muted" label="En pausa" />
            </td>
            <td className="py-2" style={{ color: "var(--ink-secondary)" }}>
              {row.comentario || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
