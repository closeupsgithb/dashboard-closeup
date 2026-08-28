"use client";

import { useState } from "react";
import { madridDateOnly } from "@/lib/format";

export type RowStatus = "pendiente_vencido" | "pendiente_paso" | "trabajada" | "futura";

export type AgendaRow = {
  opportunityId: string;
  appointmentId: string | null;
  contactName: string | null;
  companyName: string | null;
  closerId: string | null;
  closerName: string;
  meetingNumber: number | null;
  scheduledAt: string;
  stageId: string;
  stageName: string;
  status: string;
  attendance: "asistio" | "no_show" | "pendiente";
  asistioReunionRaw: string | null;
  proximoPaso: string | null;
  pendienteAtencion: boolean;
  rowStatus: RowStatus;
};

function formatHour(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = DAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${d} ${MONTH_LABELS[m - 1]}`;
}

// Estado humano de la reunión — nunca el nombre técnico de la fase del
// pipeline (p. ej. "Reunión realizada | Interesado"), que es vocabulario
// interno de GHL y no lo que un closer necesita leer de un vistazo.
function estadoLabel(attendance: AgendaRow["attendance"]): string {
  if (attendance === "asistio") return "Reunión realizada";
  if (attendance === "no_show") return "No show";
  return "Agendada";
}

// El botón dice qué hace falta en vez de un genérico "Revisar / actualizar"
// siempre igual (punto 7 del brief de rediseño).
function botonLabel(rowStatus: RowStatus): string {
  if (rowStatus === "pendiente_vencido") return "Actualizar reunión";
  if (rowStatus === "pendiente_paso") return "Añadir próximo paso";
  if (rowStatus === "trabajada") return "Editar";
  return "Actualizar";
}

export function GrowthAgendaTable({
  rows,
  mostrarProcesadas,
  onEdit,
}: {
  rows: AgendaRow[];
  mostrarProcesadas: boolean;
  onEdit: (row: AgendaRow) => void;
}) {
  const visibleRows = mostrarProcesadas ? rows : rows.filter((r) => r.rowStatus !== "trabajada");

  if (visibleRows.length === 0) {
    return (
      <p className="py-2 text-sm" style={{ color: "var(--ink-muted)" }}>
        {rows.length === 0 ? "No hay reuniones para este periodo." : "Todo procesado en este periodo."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "4.5rem" }} />
          <col style={{ width: "13rem" }} />
          <col style={{ width: "8rem" }} />
          <col style={{ width: "8.5rem" }} />
          <col />
          <col style={{ width: "9.5rem" }} />
        </colgroup>
        <thead>
          <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
            <th className="pb-2 pr-3 text-xs font-medium">Hora</th>
            <th className="pb-2 pr-3 text-xs font-medium">Contacto</th>
            <th className="pb-2 pr-3 text-xs font-medium">Closer</th>
            <th className="pb-2 pr-3 text-xs font-medium">Estado</th>
            <th className="pb-2 pr-3 text-xs font-medium">Próximo paso</th>
            <th className="pb-2 text-xs font-medium text-right">Acción</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const needsAction = row.rowStatus === "pendiente_vencido" || row.rowStatus === "pendiente_paso";
            const isDone = row.rowStatus === "trabajada";
            return (
              <tr
                key={row.opportunityId}
                className="align-top"
                style={{
                  borderTop: "1px solid var(--gridline)",
                  boxShadow: needsAction ? "inset 3px 0 0 var(--status-critical)" : undefined,
                }}
              >
                <td className="py-3.5 pr-3 font-medium tabular" style={{ color: "var(--ink)" }}>
                  {formatHour(row.scheduledAt)}
                </td>

                <td className="py-3.5 pr-3">
                  <div style={{ color: "var(--ink)" }}>
                    {row.contactName ?? "—"}
                    {row.meetingNumber && row.meetingNumber > 1 && (
                      <span
                        className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--brand)", color: "white" }}
                      >
                        {row.meetingNumber === 2 ? "CALL 2" : `REUNIÓN ${row.meetingNumber}`}
                      </span>
                    )}
                  </div>
                  <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {row.companyName ?? "—"}
                  </div>
                </td>

                <td className="py-3.5 pr-3 text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {row.closerName}
                </td>

                <td className="py-3.5 pr-3 text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {estadoLabel(row.attendance)}
                </td>

                <td className="py-3.5 pr-3 text-xs">
                  {row.rowStatus === "pendiente_paso" ? (
                    <span className="font-medium" style={{ color: "var(--status-critical)" }}>
                      Falta próximo paso
                    </span>
                  ) : row.rowStatus === "pendiente_vencido" ? (
                    <span className="font-medium" style={{ color: "var(--status-critical)" }}>
                      Falta registrar asistencia
                    </span>
                  ) : isDone ? (
                    <span style={{ color: "var(--status-good)" }}>{row.proximoPaso ?? "Actualizado"} ✓</span>
                  ) : (
                    <span style={{ color: "var(--ink-muted)" }}>{row.proximoPaso ?? "—"}</span>
                  )}
                </td>

                <td className="py-3.5 text-right">
                  <button
                    onClick={() => onEdit(row)}
                    className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--ink)" }}
                  >
                    {botonLabel(row.rowStatus)}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GrowthAgenda({
  rows,
  groupedByDay,
  onEdit,
}: {
  rows: AgendaRow[];
  groupedByDay: { date: string; rows: AgendaRow[] }[] | null;
  onEdit: (row: AgendaRow) => void;
}) {
  const [mostrarProcesadas, setMostrarProcesadas] = useState(false);
  const totalProcesadas = rows.filter((r) => r.rowStatus === "trabajada").length;

  const toggle = totalProcesadas > 0 && (
    <button onClick={() => setMostrarProcesadas((v) => !v)} className="mb-3 text-xs underline" style={{ color: "var(--ink-secondary)" }}>
      {mostrarProcesadas ? "Ocultar actualizadas" : `Mostrar actualizadas (${totalProcesadas})`}
    </button>
  );

  if (!groupedByDay) {
    return (
      <div>
        {toggle}
        <GrowthAgendaTable rows={rows} mostrarProcesadas={mostrarProcesadas} onEdit={onEdit} />
      </div>
    );
  }
  if (groupedByDay.length === 0) {
    return (
      <p className="py-2 text-sm" style={{ color: "var(--ink-muted)" }}>
        No hay reuniones para este periodo.
      </p>
    );
  }
  return (
    <div>
      {toggle}
      <div className="flex flex-col gap-6">
        {groupedByDay.map((g) => (
          <div key={g.date}>
            <div
              className="mb-2 border-b pb-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--ink-secondary)", borderColor: "var(--gridline)" }}
            >
              {dayLabel(g.date)} · {g.rows.length} reunión{g.rows.length === 1 ? "" : "es"}
            </div>
            <GrowthAgendaTable rows={g.rows} mostrarProcesadas={mostrarProcesadas} onEdit={onEdit} />
          </div>
        ))}
      </div>
    </div>
  );
}

export { madridDateOnly };
