"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";

export type PendingRow = {
  cliente: string;
  mesesConsecutivosPendiente: number;
  periodo: string;
  clienteSheet: string;
  importeRaw: string;
};

const ESTADO_OPTIONS = ["", "Hecho", "Pendiente", "50%", "STAND BY"];

type RowState = {
  editing: boolean;
  confirming: boolean;
  saving: boolean;
  error: string | null;
  draftEstado: string;
  draftImporte: string;
};

function initialRowState(row: PendingRow): RowState {
  return {
    editing: false,
    confirming: false,
    saving: false,
    error: null,
    draftEstado: "Hecho",
    draftImporte: row.importeRaw,
  };
}

// Mismo patrón de edición en dos pasos que el resto de tablas del dashboard
// (Editar -> Guardar pide confirmación -> Sí, escribir hace el POST real).
// Escribe en la misma pestaña/fila que ya es la fuente única de ese cliente
// (/api/sheet-update), así que en cuanto se marca "Hecho" aquí, el ingreso
// confirmado, el ROAS y cualquier otra sección que dependa de ese estado se
// actualizan solos al recargar — no hay una copia aparte que mantener.
export function PendingFollowUpTable({ data, onSaved }: { data: PendingRow[]; onSaved: () => void }) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  function stateFor(row: PendingRow): RowState {
    return rowStates[row.cliente] ?? initialRowState(row);
  }

  function patch(cliente: string, row: PendingRow, p: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [cliente]: { ...(prev[cliente] ?? initialRowState(row)), ...p } }));
  }

  async function confirmSave(row: PendingRow) {
    const state = stateFor(row);
    patch(row.cliente, row, { saving: true, error: null });
    try {
      const res = await fetch("/api/sheet-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo: row.periodo,
          cliente: row.clienteSheet,
          estado: state.draftEstado,
          importe: state.draftImporte,
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
          <th className="pb-2 font-normal text-right">Importe</th>
          <th className="pb-2 font-normal text-right">Meses seguidos pendiente</th>
          <th className="pb-2 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const state = stateFor(row);
          return (
            <tr key={row.cliente} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
              <td className="py-2 capitalize">{row.cliente}</td>
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
                  <StatusBadge variant="warning" label="Pendiente" />
                )}
              </td>
              <td className="py-2 text-right">
                {state.editing ? (
                  <input
                    value={state.draftImporte}
                    onChange={(e) => patch(row.cliente, row, { draftImporte: e.target.value })}
                    className="w-24 rounded border px-1.5 py-0.5"
                    style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                  />
                ) : (
                  row.importeRaw || "—"
                )}
              </td>
              <td className="py-2 text-right tabular">
                {row.mesesConsecutivosPendiente}
                {row.mesesConsecutivosPendiente >= 2 ? " — revisar" : ""}
              </td>
              <td className="py-2">
                {!state.editing && !state.confirming ? (
                  <button
                    onClick={() => patch(row.cliente, row, { editing: true })}
                    className="text-xs underline"
                    style={{ color: "var(--ink-secondary)" }}
                  >
                    Marcar pagado / editar
                  </button>
                ) : state.editing && !state.confirming ? (
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
                ) : (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs" style={{ color: "var(--status-warning)" }}>
                      ¿Escribir en el Sheet ({row.periodo})?
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
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
