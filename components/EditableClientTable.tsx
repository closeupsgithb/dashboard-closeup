"use client";

import { useState } from "react";

export type RosterRow = { cliente: string; estado: string; importeRaw: string };

const ESTADO_OPTIONS = ["", "Hecho", "Pendiente", "50%", "STAND BY"];

type RowState = {
  editing: boolean;
  confirming: boolean;
  saving: boolean;
  error: string | null;
  draftEstado: string;
  draftImporte: string;
};

function initialRowState(row: RosterRow): RowState {
  return {
    editing: false,
    confirming: false,
    saving: false,
    error: null,
    draftEstado: row.estado,
    draftImporte: row.importeRaw,
  };
}

// Edición con confirmación explícita antes de escribir de verdad en el
// Sheet: Editar -> cambiar valores -> Guardar (pasa a modo confirmación,
// todavía no escribe nada) -> Confirmar escritura (aquí sí llama a la API).
export function EditableClientTable({ periodo, roster, onSaved }: { periodo: string; roster: RosterRow[]; onSaved: () => void }) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(roster.map((r) => [r.cliente, initialRowState(r)]))
  );

  if (roster.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        No hay clientes listados en {periodo} todavía.
      </p>
    );
  }

  function patch(cliente: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [cliente]: { ...prev[cliente], ...patch } }));
  }

  async function confirmSave(row: RosterRow) {
    const state = rowStates[row.cliente];
    patch(row.cliente, { saving: true, error: null });
    try {
      const res = await fetch("/api/sheet-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo, cliente: row.cliente, estado: state.draftEstado, importe: state.draftImporte }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(row.cliente, { saving: false, confirming: false, error: json.detail ?? json.error ?? "Error al guardar" });
        return;
      }
      patch(row.cliente, { saving: false, confirming: false, editing: false, error: null });
      onSaved();
    } catch {
      patch(row.cliente, { saving: false, confirming: false, error: "No se pudo conectar con el servidor" });
    }
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
          <th className="pb-2 font-normal">Cliente</th>
          <th className="pb-2 font-normal">Estado</th>
          <th className="pb-2 font-normal">Importe</th>
          <th className="pb-2 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {roster.map((row) => {
          const state = rowStates[row.cliente];
          if (!state) return null;

          return (
            <tr key={row.cliente} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-2">{row.cliente}</td>
              <td className="py-2">
                {state.editing ? (
                  <select
                    value={state.draftEstado}
                    onChange={(e) => patch(row.cliente, { draftEstado: e.target.value })}
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
                  row.estado || <span style={{ color: "var(--ink-muted)" }}>—</span>
                )}
              </td>
              <td className="py-2">
                {state.editing ? (
                  <input
                    value={state.draftImporte}
                    onChange={(e) => patch(row.cliente, { draftImporte: e.target.value })}
                    className="w-28 rounded border px-1.5 py-0.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  />
                ) : (
                  row.importeRaw || <span style={{ color: "var(--ink-muted)" }}>—</span>
                )}
              </td>
              <td className="py-2">
                {!state.editing && (
                  <button
                    onClick={() => patch(row.cliente, { editing: true })}
                    className="text-xs underline"
                    style={{ color: "var(--ink-secondary)" }}
                  >
                    Editar
                  </button>
                )}
                {state.editing && !state.confirming && (
                  <div className="flex gap-3">
                    <button onClick={() => patch(row.cliente, { confirming: true })} className="text-xs font-medium" style={{ color: "var(--brand)" }}>
                      Guardar
                    </button>
                    <button
                      onClick={() => patch(row.cliente, initialRowState(row))}
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
                      ¿Escribir en el Sheet ({periodo})?
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
                        onClick={() => patch(row.cliente, { confirming: false })}
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
