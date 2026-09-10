"use client";

import { formatHumanDate } from "@/lib/format";

export type OrphanedMeetingRow = {
  opportunityId: string;
  appointmentId: string;
  meetingNumber: number;
  scheduledAt: string;
  contactName: string | null;
  companyName: string | null;
  closerId: string | null;
  closerName: string;
  stageId: string;
  stageName: string;
  status: string;
};

const LOCATION_ID = "gNZGfOheofHgZtuYObm7";

function formatWhenLabel(iso: string): string {
  const fecha = formatHumanDate(iso);
  const hora = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return `${fecha} · ${hora}`;
}

// Auditoría 2026-09-09, Paso 2: estas citas nunca aparecen en la Agenda
// (solo muestra la cita ACTIVA de cada oportunidad) — esta es la única
// superficie del dashboard desde la que un closer puede llegar a marcarlas.
// "Actualizar" abre el mismo panel que usa la Agenda, con el appointmentId
// exacto de esta reunión concreta (no la activa de la oportunidad).
export function GrowthOrphanedMeetings({
  rows,
  onEdit,
}: {
  rows: OrphanedMeetingRow[];
  onEdit: (row: OrphanedMeetingRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        No hay reuniones sin resolver — todas las citas sustituidas por una reunión posterior ya tienen su resultado marcado.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-3 text-xs" style={{ color: "var(--ink-muted)" }}>
        Citas ya sustituidas por una reunión posterior de la misma oportunidad, pasadas, y todavía sin marcar. No
        aparecen en la Agenda ni cuentan en el show rate — están aquí solo para que puedas resolverlas.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "10rem" }} />
            <col style={{ width: "4rem" }} />
            <col style={{ width: "9rem" }} />
            <col style={{ width: "7rem" }} />
            <col style={{ width: "7rem" }} />
            <col />
            <col style={{ width: "9.5rem" }} />
          </colgroup>
          <thead>
            <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
              <th className="pb-1.5 pr-2 text-xs font-medium">Fecha de la cita</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Reunión</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Contacto</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Empresa</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Closer</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Etapa actual</th>
              <th className="pb-1.5 text-xs font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.appointmentId} style={{ borderTop: "1px solid var(--gridline)" }}>
                <td className="py-2.5 pr-3 text-xs tabular" style={{ color: "var(--status-critical)" }}>
                  {formatWhenLabel(r.scheduledAt)}
                </td>
                <td className="py-2.5 pr-3 text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {r.meetingNumber === 1 ? "Reunión 1" : `Reunión ${r.meetingNumber}`}
                </td>
                <td className="py-2.5 pr-3" style={{ color: "var(--ink)" }}>
                  {r.contactName ?? "—"}
                </td>
                <td className="py-2.5 pr-3 text-xs" style={{ color: "var(--ink-muted)" }}>
                  {r.companyName ?? "—"}
                </td>
                <td className="py-2.5 pr-3 text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {r.closerName}
                </td>
                <td className="py-2.5 pr-3 text-xs" style={{ color: "var(--ink-muted)" }}>
                  {r.stageName}
                  {r.status !== "open" && (
                    <span className="ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(208,59,59,0.1)", color: "var(--status-critical)" }}>
                      {r.status}
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => onEdit(r)}
                      className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                      style={{ borderColor: "var(--border)", color: "var(--ink)" }}
                    >
                      Marcar resultado
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
