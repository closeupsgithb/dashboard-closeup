"use client";

export type InteresadoRow = {
  opportunityId: string;
  contactName: string | null;
  companyName: string | null;
  closerId: string | null;
  closerName: string;
  stageId: string;
  stageName: string;
  tipo: "interesado" | "call2";
  interesadoDesde: string;
  proximoPaso: string | null;
  asistioReunionRaw: string | null;
  activeAttendance: "asistio" | "no_show" | "pendiente";
  followUpDueAt: string | null;
  followUpTitle: string | null;
  followUpTaskId: string | null;
};

export type InteresadoBuckets = {
  estaSemana: InteresadoRow[];
  semanaPasada: InteresadoRow[];
  anteriores: InteresadoRow[];
};

const LOCATION_ID = "gNZGfOheofHgZtuYObm7";

function diasDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));
}

function tipoLabel(tipo: InteresadoRow["tipo"]): string {
  return tipo === "call2" ? "Call 2" : "Interesado";
}

function BucketTable({
  title,
  destacar,
  rows,
  onEdit,
}: {
  title: string;
  destacar: boolean;
  rows: InteresadoRow[];
  onEdit: (row: InteresadoRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-5">
      <div
        className="mb-2 border-b pb-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: destacar ? "var(--status-critical)" : "var(--ink-secondary)", borderColor: "var(--gridline)" }}
      >
        {title} ({rows.length})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "10rem" }} />
            <col style={{ width: "9rem" }} />
            <col style={{ width: "7rem" }} />
            <col style={{ width: "6.5rem" }} />
            <col style={{ width: "6rem" }} />
            <col style={{ width: "9.5rem" }} />
          </colgroup>
          <thead>
            <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
              <th className="pb-1.5 pr-2 text-xs font-medium">Contacto</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Empresa</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Responsable</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Estado</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Desde</th>
              <th className="pb-1.5 text-xs font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dias = diasDesde(r.interesadoDesde);
              return (
                <tr key={r.opportunityId} style={{ borderTop: "1px solid var(--gridline)" }}>
                  <td className="py-2.5 pr-3" style={{ color: "var(--ink)" }}>
                    {r.contactName ?? "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {r.companyName ?? "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-xs" style={{ color: "var(--ink-secondary)" }}>
                    {r.closerName}
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    <span
                      className="rounded px-1.5 py-0.5 font-medium"
                      style={{
                        background: r.tipo === "call2" ? "rgba(11,110,232,0.1)" : "rgba(12,163,12,0.1)",
                        color: r.tipo === "call2" ? "var(--brand)" : "var(--status-good)",
                      }}
                    >
                      {tipoLabel(r.tipo)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs tabular" style={{ color: dias >= 7 ? "var(--status-critical)" : "var(--ink-muted)" }}>
                    {dias === 0 ? "Hoy" : `Hace ${dias}d`}
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => onEdit(r)}
                        className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                        style={{ borderColor: "var(--border)", color: "var(--ink)" }}
                      >
                        Actualizar
                      </button>
                      <a
                        href={`https://app.gohighlevel.com/v2/location/${LOCATION_ID}/opportunities/list`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        GHL
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Auditoría 2026-09-15: vista aditiva pedida por Daniel para no perder de
// vista a quien ya mostró interés (Reunión realizada | Interesado) o tiene
// Call 2 en marcha — antes esto solo se veía disperso entre Agenda (si hay
// cita) y Follow-ups (si el próximo paso lo requiere), sin un sitio único
// ordenado por cuánto lleva cada contacto sin resolver.
export function GrowthInteresados({ buckets, onEdit }: { buckets: InteresadoBuckets; onEdit: (row: InteresadoRow) => void }) {
  const total = buckets.estaSemana.length + buckets.semanaPasada.length + buckets.anteriores.length;
  if (total === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        No hay interesados ni Call 2 en marcha ahora mismo.
      </p>
    );
  }
  return (
    <div>
      <BucketTable title="Esta semana" destacar={false} rows={buckets.estaSemana} onEdit={onEdit} />
      <BucketTable title="Semana pasada" destacar rows={buckets.semanaPasada} onEdit={onEdit} />
      <BucketTable title="Anteriores" destacar rows={buckets.anteriores} onEdit={onEdit} />
    </div>
  );
}
