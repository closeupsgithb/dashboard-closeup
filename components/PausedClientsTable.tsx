"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";

export type PausedRow = { cliente: string; comentario: string; estado: string; importeRaw: string; facturaEmitida: string };

const ESTADO_OPTIONS = ["", "Hecho", "Pendiente", "50%", "STAND BY"];

type RowState = {
  editing: boolean;
  confirming: boolean;
  saving: boolean;
  error: string | null;
  draftNombre: string;
  draftComentario: string;
  draftEstado: string;
  draftImporte: string;
  draftFacturaEmitida: string;
  reactivating: boolean;
  reactivateSaving: boolean;
  reactivateError: string | null;
};

function initialRowState(row: PausedRow): RowState {
  return {
    editing: false,
    confirming: false,
    saving: false,
    error: null,
    draftNombre: row.cliente,
    draftComentario: row.comentario,
    draftEstado: row.estado,
    draftImporte: row.importeRaw,
    draftFacturaEmitida: row.facturaEmitida,
    reactivating: false,
    reactivateSaving: false,
    reactivateError: null,
  };
}

export function PausedClientsTable({ data, onSaved }: { data: PausedRow[]; onSaved: () => void }) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  function stateFor(row: PausedRow): RowState {
    return rowStates[row.cliente] ?? initialRowState(row);
  }

  function patch(cliente: string, row: PausedRow, p: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [cliente]: { ...(prev[cliente] ?? initialRowState(row)), ...p } }));
  }

  async function confirmSave(row: PausedRow) {
    const state = stateFor(row);
    patch(row.cliente, row, { saving: true, error: null });
    try {
      const res = await fetch("/api/paused-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          cliente: row.cliente,
          nombre: state.draftNombre,
          comentario: state.draftComentario,
          estado: state.draftEstado,
          importe: state.draftImporte,
          facturaEmitida: state.draftFacturaEmitida,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(row.cliente, row, { saving: false, confirming: false, error: json.detail ?? json.error ?? "Error al guardar" });
        return;
      }
      patch(row.cliente, row, { saving: false, confirming: false, editing: false, error: null });
      onSaved();
    } catch {
      patch(row.cliente, row, { saving: false, confirming: false, error: "No se pudo conectar con el servidor" });
    }
  }

  async function confirmReactivate(row: PausedRow) {
    patch(row.cliente, row, { reactivateSaving: true, reactivateError: null });
    try {
      const res = await fetch("/api/paused-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveToActive", cliente: row.cliente }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(row.cliente, row, { reactivateSaving: false, reactivating: false, reactivateError: json.detail ?? json.error ?? "Error al reactivar" });
        return;
      }
      patch(row.cliente, row, { reactivateSaving: false, reactivating: false, reactivateError: null });
      onSaved();
    } catch {
      patch(row.cliente, row, { reactivateSaving: false, reactivating: false, reactivateError: "No se pudo conectar con el servidor" });
    }
  }

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
          <th className="pb-2 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const state = stateFor(row);
          return (
            <tr key={row.cliente} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-2">
                {state.editing ? (
                  <input
                    value={state.draftNombre}
                    onChange={(e) => patch(row.cliente, row, { draftNombre: e.target.value })}
                    className="w-36 rounded border px-1.5 py-0.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  />
                ) : (
                  row.cliente
                )}
              </td>
              <td className="py-2">
                {state.editing ? (
                  <select
                    value={state.draftEstado}
                    onChange={(e) => patch(row.cliente, row, { draftEstado: e.target.value })}
                    className="rounded border px-1.5 py-0.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  >
                    {ESTADO_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt || "(vacío)"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <StatusBadge variant="muted" label="En pausa" />
                )}
              </td>
              <td className="py-2" style={{ color: "var(--ink-secondary)" }}>
                {state.editing ? (
                  <input
                    value={state.draftComentario}
                    onChange={(e) => patch(row.cliente, row, { draftComentario: e.target.value })}
                    className="w-56 rounded border px-1.5 py-0.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  />
                ) : (
                  row.comentario || "—"
                )}
              </td>
              <td className="py-2">
                {!state.editing && !state.reactivating && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => patch(row.cliente, row, { editing: true })}
                      className="text-xs underline"
                      style={{ color: "var(--ink-secondary)" }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => patch(row.cliente, row, { reactivating: true })}
                      className="text-xs underline"
                      style={{ color: "var(--ink-secondary)" }}
                    >
                      Reactivar
                    </button>
                  </div>
                )}
                {state.editing && !state.confirming && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => patch(row.cliente, row, { confirming: true })}
                      className="text-xs font-medium"
                      style={{ color: "var(--brand)" }}
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => patch(row.cliente, row, initialRowState(row))}
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
                      ¿Escribir en el Sheet (SBY)?
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
                        onClick={() => patch(row.cliente, row, { confirming: false })}
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

                {state.reactivating && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs" style={{ color: "var(--status-warning)" }}>
                      ¿Reactivar &quot;{row.cliente}&quot; (volver a activos)?
                    </span>
                    <div className="flex gap-3">
                      <button
                        onClick={() => confirmReactivate(row)}
                        disabled={state.reactivateSaving}
                        className="text-xs font-medium"
                        style={{ color: "var(--status-critical)" }}
                      >
                        {state.reactivateSaving ? "Reactivando…" : "Sí, reactivar"}
                      </button>
                      <button
                        onClick={() => patch(row.cliente, row, { reactivating: false })}
                        disabled={state.reactivateSaving}
                        className="text-xs"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {state.reactivateError && (
                  <div className="mt-1 text-xs" style={{ color: "var(--status-critical)" }}>
                    {state.reactivateError}
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
