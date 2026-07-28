"use client";

import { useState } from "react";

export type ReunionRow = {
  opportunityId: string;
  cliente: string;
  fechaReunionAgendada: string;
  asistioReunion: string;
};

const ASISTIO_OPTIONS = ["", "Sí", "No", "Pendiente"];

type RowState = {
  editing: boolean;
  confirming: boolean;
  saving: boolean;
  error: string | null;
  draftFecha: string;
  draftAsistio: string;
};

function toDateInputValue(raw: string): string {
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function initialRowState(row: ReunionRow): RowState {
  return {
    editing: false,
    confirming: false,
    saving: false,
    error: null,
    draftFecha: toDateInputValue(row.fechaReunionAgendada),
    draftAsistio: row.asistioReunion,
  };
}

// Daniel marca a mano, desde aquí, cuándo se agendó la reunión y si asistió —
// no hay workflow automático en GHL para esto (decisión explícita, ver
// memoria del proyecto). Mismo flujo de confirmación en dos pasos que
// EditableClientTable: Editar -> Guardar (confirma) -> Confirmar escritura.
export function ReunionesTable({ roster, onSaved }: { roster: ReunionRow[]; onSaved: () => void }) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(roster.map((r) => [r.opportunityId, initialRowState(r)]))
  );

  if (roster.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        No hay clientes en Onboarding todavía.
      </p>
    );
  }

  function patch(id: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function confirmSave(row: ReunionRow) {
    const state = rowStates[row.opportunityId];
    patch(row.opportunityId, { saving: true, error: null });
    try {
      const res = await fetch("/api/ghl-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: row.opportunityId,
          fechaReunionAgendada: state.draftFecha,
          asistioReunion: state.draftAsistio,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(row.opportunityId, { saving: false, confirming: false, error: json.detail ?? json.error ?? "Error al guardar" });
        return;
      }
      patch(row.opportunityId, { saving: false, confirming: false, editing: false, error: null });
      onSaved();
    } catch {
      patch(row.opportunityId, { saving: false, confirming: false, error: "No se pudo conectar con el servidor" });
    }
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
          <th className="pb-2 font-normal">Cliente</th>
          <th className="pb-2 font-normal">Reunión agendada</th>
          <th className="pb-2 font-normal">Asistió</th>
          <th className="pb-2 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {roster.map((row) => {
          const state = rowStates[row.opportunityId];
          if (!state) return null;

          return (
            <tr key={row.opportunityId} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-2">{row.cliente}</td>
              <td className="py-2">
                {state.editing ? (
                  <input
                    type="date"
                    value={state.draftFecha}
                    onChange={(e) => patch(row.opportunityId, { draftFecha: e.target.value })}
                    className="rounded border px-1.5 py-0.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  />
                ) : (
                  toDateInputValue(row.fechaReunionAgendada) || <span style={{ color: "var(--ink-muted)" }}>—</span>
                )}
              </td>
              <td className="py-2">
                {state.editing ? (
                  <select
                    value={state.draftAsistio}
                    onChange={(e) => patch(row.opportunityId, { draftAsistio: e.target.value })}
                    className="rounded border px-1.5 py-0.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  >
                    {ASISTIO_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt || "(vacío)"}
                      </option>
                    ))}
                  </select>
                ) : (
                  row.asistioReunion || <span style={{ color: "var(--ink-muted)" }}>—</span>
                )}
              </td>
              <td className="py-2">
                {!state.editing && (
                  <button
                    onClick={() => patch(row.opportunityId, { editing: true })}
                    className="text-xs underline"
                    style={{ color: "var(--ink-secondary)" }}
                  >
                    Editar
                  </button>
                )}
                {state.editing && !state.confirming && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => patch(row.opportunityId, { confirming: true })}
                      className="text-xs font-medium"
                      style={{ color: "var(--brand)" }}
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => patch(row.opportunityId, initialRowState(row))}
                      className="text-xs"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
                {state.confirming && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs" style={{ color: "var(--status-warning)" }}>
                      ¿Escribir en GHL?
                    </span>
                    <div className="flex gap-3">
                      <button
                        onClick={() => confirmSave(row)}
                        disabled={state.saving}
                        className="text-xs font-medium"
                        style={{ color: "var(--status-critical)" }}
                      >
                        {state.saving ? "Guardando…" : "Sí, escribir"}
                      </button>
                      <button
                        onClick={() => patch(row.opportunityId, { confirming: false })}
                        disabled={state.saving}
                        className="text-xs"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {state.error && (
                  <div className="mt-1 text-xs" style={{ color: "var(--status-critical)" }}>
                    {state.error}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
