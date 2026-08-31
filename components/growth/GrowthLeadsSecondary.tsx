"use client";

import { useState } from "react";
import { formatPercent, formatWaitTime, formatDurationMs, formatHumanDate } from "@/lib/format";

export type LeadsFunnel = {
  leadsCualificados: number;
  reunionesAgendadas: number;
  tasaAgenda: number | null;
  leadACliente: number | null;
};

export type LeadRow = {
  opportunityId: string;
  contacto: string | null;
  empresa: string | null;
  responsableId: string | null;
  responsable: string;
  estado: string;
  proximoPasoRaw: string | null;
  contactado: boolean;
  tiempoEsperaMs: number | null;
  entryAt: string;
  stageId: string;
  stageName: string;
  status: string;
  asistioReunionRaw: string | null;
  activeAttendance: "asistio" | "no_show" | "pendiente";
  followUpDueAt: string | null;
  followUpTitle: string | null;
  followUpTaskId: string | null;
};

const PAGE_SIZE = 25;

function Stat({ label, value, critical }: { label: string; value: string; critical?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-sm font-semibold tabular" style={{ color: critical ? "var(--status-critical)" : "var(--ink)" }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
        {label}
      </span>
    </div>
  );
}

export function GrowthLeadsSecondary({
  funnel,
  rows,
  leadsSinContactar,
  tiempoMedioPrimerContactoMs,
  onEdit,
}: {
  funnel: LeadsFunnel;
  rows: LeadRow[];
  leadsSinContactar: number;
  tiempoMedioPrimerContactoMs: number | null;
  onEdit: (row: LeadRow) => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const mostrados = rows.slice(0, visible);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Stat label="Leads cualificados" value={String(funnel.leadsCualificados)} />
        <Stat label="Con reunión" value={String(funnel.reunionesAgendadas)} />
        <Stat label="Sin contactar" value={String(leadsSinContactar)} critical={leadsSinContactar > 0} />
        <Stat label="Lead → agenda" value={formatPercent(funnel.tasaAgenda)} />
        <Stat label="Lead → cliente" value={formatPercent(funnel.leadACliente)} />
        <Stat label="Tiempo medio 1er contacto" value={tiempoMedioPrimerContactoMs !== null ? formatDurationMs(tiempoMedioPrimerContactoMs) : "N/D"} />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          Sin leads sin reunión en este periodo — todos los leads cualificados ya tienen cita o están cerrados.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "10rem" }} />
              <col style={{ width: "9rem" }} />
              <col style={{ width: "9rem" }} />
              <col style={{ width: "8rem" }} />
              <col style={{ width: "9rem" }} />
              <col />
            </colgroup>
            <thead>
              <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
                <th className="pb-2 pr-2 text-xs font-medium">Contacto</th>
                <th className="pb-2 pr-2 text-xs font-medium">Empresa</th>
                <th className="pb-2 pr-2 text-xs font-medium">Responsable</th>
                <th className="pb-2 pr-2 text-xs font-medium">Estado</th>
                <th className="pb-2 pr-2 text-xs font-medium">Esperando desde</th>
                <th className="pb-2 text-xs font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {mostrados.map((r) => (
                <tr
                  key={r.opportunityId}
                  className="align-top"
                  style={{
                    borderTop: "1px solid var(--gridline)",
                    boxShadow: !r.contactado ? "inset 3px 0 0 var(--status-critical)" : undefined,
                  }}
                >
                  <td className="py-2.5 pr-2">{r.contacto ?? "—"}</td>
                  <td className="py-2.5 pr-2 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {r.empresa ?? "—"}
                  </td>
                  <td className="py-2.5 pr-2 text-xs" style={{ color: r.responsableId ? "var(--ink-secondary)" : "var(--status-critical)" }}>
                    {r.responsable}
                  </td>
                  <td className="py-2.5 pr-2 text-xs font-medium" style={{ color: r.contactado ? "var(--ink-secondary)" : "var(--status-critical)" }}>
                    {r.contactado ? r.estado : "Sin contactar"}
                  </td>
                  <td className="py-2.5 pr-2 text-xs tabular" style={{ color: !r.contactado ? "var(--status-critical)" : "var(--ink-muted)" }}>
                    {r.tiempoEsperaMs !== null ? formatWaitTime(r.tiempoEsperaMs) : "—"}
                    {!r.contactado && <span style={{ color: "var(--ink-muted)" }}> (desde {formatHumanDate(r.entryAt)})</span>}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => onEdit(r)}
                      className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                      style={{ borderColor: "var(--border)", color: "var(--ink)" }}
                    >
                      {r.contactado ? "Actualizar" : "Contactar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {rows.length > visible && (
            <button onClick={() => setVisible((v) => v + PAGE_SIZE)} className="mt-2 text-xs underline" style={{ color: "var(--ink-secondary)" }}>
              Mostrar más ({rows.length - visible} restantes)
            </button>
          )}
        </>
      )}
    </div>
  );
}
