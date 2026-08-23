"use client";

import { useState } from "react";
import { formatHumanDate } from "@/lib/format";

export type FollowUpRow = {
  opportunityId: string;
  contactName: string | null;
  companyName: string | null;
  closerId: string | null;
  closerName: string;
  proximoPaso: string | null;
  dueAt: string | null;
  accion: string | null;
  taskId: string | null;
  stageId: string;
  stageName: string;
  status: string;
  asistioReunionRaw: string | null;
};

export type FollowUpBuckets = {
  vencidos: FollowUpRow[];
  enPeriodo: FollowUpRow[];
  sinFecha: FollowUpRow[];
};

const LOCATION_ID = "gNZGfOheofHgZtuYObm7";

function formatDueLabel(iso: string): string {
  const fecha = formatHumanDate(iso);
  const hora = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return hora === "00:00" ? fecha : `${fecha} · ${hora}`;
}

function BucketTable({
  title,
  vencido,
  rows,
  onEdit,
}: {
  title: string;
  vencido: boolean;
  rows: FollowUpRow[];
  onEdit: (row: FollowUpRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-5">
      <div
        className="mb-2 border-b pb-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: vencido ? "var(--status-critical)" : "var(--ink-secondary)", borderColor: "var(--gridline)" }}
      >
        {title} ({rows.length})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "10rem" }} />
            <col style={{ width: "9rem" }} />
            <col style={{ width: "7rem" }} />
            <col style={{ width: "6rem" }} />
            <col />
            <col style={{ width: "9.5rem" }} />
          </colgroup>
          <thead>
            <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
              <th className="pb-1.5 pr-2 text-xs font-medium">Fecha</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Contacto</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Empresa</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Responsable</th>
              <th className="pb-1.5 pr-2 text-xs font-medium">Acción</th>
              <th className="pb-1.5 text-xs font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.opportunityId} style={{ borderTop: "1px solid var(--gridline)" }}>
                <td className="py-2.5 pr-3 text-xs tabular" style={{ color: vencido ? "var(--status-critical)" : "var(--ink-muted)" }}>
                  {r.dueAt ? formatDueLabel(r.dueAt) : "—"}
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
                <td className="py-2.5 pr-3 text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {r.accion ?? "—"}
                </td>
                <td className="py-2.5 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => onEdit(r)}
                      className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                      style={{ borderColor: "var(--border)", color: "var(--ink)" }}
                    >
                      {vencido ? "Actualizar (vencido)" : "Actualizar"}
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

// "Completado" = ya no aparece en ningún cajón porque su Próximo paso dejó
// de requerir seguimiento (se resuelve desde el panel de revisión, no aquí)
// — por eso no hay un botón de completar en esta tabla: completar ES
// cambiar el próximo paso, y eso ya pasa por Actualizar.
export function GrowthFollowUps({
  buckets,
  periodoLabel,
  onEdit,
}: {
  buckets: FollowUpBuckets;
  periodoLabel: string;
  onEdit: (row: FollowUpRow) => void;
}) {
  const [mostrarSinFecha, setMostrarSinFecha] = useState(true);
  const total = buckets.vencidos.length + buckets.enPeriodo.length + buckets.sinFecha.length;
  if (total === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        No hay follow-ups pendientes.
      </p>
    );
  }
  return (
    <div>
      <BucketTable title="Vencidos" vencido rows={buckets.vencidos} onEdit={onEdit} />
      <BucketTable title={periodoLabel} vencido={false} rows={buckets.enPeriodo} onEdit={onEdit} />
      {buckets.sinFecha.length > 0 && (
        <button onClick={() => setMostrarSinFecha((v) => !v)} className="mb-2 text-xs underline" style={{ color: "var(--ink-secondary)" }}>
          {mostrarSinFecha ? "Ocultar sin fecha" : `Mostrar sin fecha (${buckets.sinFecha.length})`}
        </button>
      )}
      {mostrarSinFecha && <BucketTable title="Sin fecha" vencido={false} rows={buckets.sinFecha} onEdit={onEdit} />}
    </div>
  );
}
