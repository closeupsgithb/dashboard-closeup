"use client";

import { useState } from "react";

export type RosterRow = { cliente: string; estado: string; importeRaw: string; facturaEmitida: string };
export type PeriodRoster = { periodo: string; roster: RosterRow[] };

const ESTADO_OPTIONS = ["", "Hecho", "Pendiente", "50%", "STAND BY"];

type RowState = {
  editing: boolean;
  confirming: boolean;
  saving: boolean;
  error: string | null;
  draftEstado: string;
  draftImporte: string;
  draftFacturaEmitida: string;
  draftNombre: string;
  movingToPause: boolean;
  pauseComentario: string;
  pauseConfirming: boolean;
  pauseSaving: boolean;
  pauseError: string | null;
  autoPauseNote: string | null;
};

function initialRowState(row: RosterRow): RowState {
  return {
    editing: false,
    confirming: false,
    saving: false,
    error: null,
    draftEstado: row.estado,
    draftImporte: row.importeRaw,
    draftFacturaEmitida: row.facturaEmitida,
    draftNombre: row.cliente,
    movingToPause: false,
    pauseComentario: "",
    pauseConfirming: false,
    pauseSaving: false,
    pauseError: null,
    autoPauseNote: null,
  };
}

// Edición con confirmación explícita antes de escribir de verdad en el
// Sheet: Editar -> cambiar valores -> Guardar (pasa a modo confirmación,
// todavía no escribe nada) -> Confirmar escritura (aquí sí llama a la API).
// Selector de mes: los rosters de TODAS las pestañas de periodo ya vienen
// del servidor de una vez (getAllTabsData los trae todos), así que cambiar
// de mes aquí no hace ninguna petición nueva, solo cambia qué roster se
// muestra.
export function EditableClientTable({
  rostersPorPeriodo,
  defaultPeriodo,
  onSaved,
}: {
  rostersPorPeriodo: PeriodRoster[];
  defaultPeriodo: string | null;
  onSaved: () => void;
}) {
  const [selectedPeriodo, setSelectedPeriodo] = useState(defaultPeriodo ?? rostersPorPeriodo[0]?.periodo ?? "");
  const periodo = rostersPorPeriodo.some((p) => p.periodo === selectedPeriodo) ? selectedPeriodo : rostersPorPeriodo[0]?.periodo ?? "";
  const roster = rostersPorPeriodo.find((p) => p.periodo === periodo)?.roster ?? [];

  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  function stateFor(row: RosterRow): RowState {
    return rowStates[row.cliente] ?? initialRowState(row);
  }

  function patch(cliente: string, row: RosterRow, p: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [cliente]: { ...(prev[cliente] ?? initialRowState(row)), ...p } }));
  }

  async function confirmSave(row: RosterRow) {
    const state = stateFor(row);
    patch(row.cliente, row, { saving: true, error: null, autoPauseNote: null });
    try {
      const res = await fetch("/api/sheet-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo,
          cliente: row.cliente,
          estado: state.draftEstado,
          importe: state.draftImporte,
          facturaEmitida: state.draftFacturaEmitida,
          nombre: state.draftNombre,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(row.cliente, row, { saving: false, confirming: false, error: json.detail ?? json.error ?? "Error al guardar" });
        return;
      }
      patch(row.cliente, row, {
        saving: false,
        confirming: false,
        editing: false,
        error: null,
        autoPauseNote: json.movidoAPausa ? "Movido también a Clientes en pausa." : null,
      });
      onSaved();
    } catch {
      patch(row.cliente, row, { saving: false, confirming: false, error: "No se pudo conectar con el servidor" });
    }
  }

  async function confirmMoveToPause(row: RosterRow) {
    const state = stateFor(row);
    patch(row.cliente, row, { pauseSaving: true, pauseError: null });
    try {
      const res = await fetch("/api/paused-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveToPause", cliente: row.cliente, comentario: state.pauseComentario }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(row.cliente, row, { pauseSaving: false, pauseConfirming: false, pauseError: json.detail ?? json.error ?? "Error al mover" });
        return;
      }
      patch(row.cliente, row, { pauseSaving: false, pauseConfirming: false, movingToPause: false, pauseError: null });
      onSaved();
    } catch {
      patch(row.cliente, row, { pauseSaving: false, pauseConfirming: false, pauseError: "No se pudo conectar con el servidor" });
    }
  }

  if (rostersPorPeriodo.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Todavía no hay ninguna pestaña de periodo en el Sheet.
      </p>
    );
  }

  return (
    <div>
      <select
        value={periodo}
        onChange={(e) => setSelectedPeriodo(e.target.value)}
        className="mb-3 rounded border px-2 py-1 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
      >
        {rostersPorPeriodo.map((p) => (
          <option key={p.periodo} value={p.periodo}>
            {p.periodo}
          </option>
        ))}
      </select>

      {roster.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          No hay clientes listados en {periodo} todavía.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
              <th className="pb-2 font-normal">Cliente</th>
              <th className="pb-2 font-normal">Estado</th>
              <th className="pb-2 font-normal">Importe</th>
              <th className="pb-2 font-normal">Factura emitida</th>
              <th className="pb-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {roster.map((row) => {
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
                      row.estado || <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="py-2">
                    {state.editing ? (
                      <input
                        value={state.draftImporte}
                        onChange={(e) => patch(row.cliente, row, { draftImporte: e.target.value })}
                        className="w-28 rounded border px-1.5 py-0.5"
                        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      />
                    ) : (
                      row.importeRaw || <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="py-2">
                    {state.editing ? (
                      <input
                        type="date"
                        value={state.draftFacturaEmitida}
                        onChange={(e) => patch(row.cliente, row, { draftFacturaEmitida: e.target.value })}
                        className="rounded border px-1.5 py-0.5"
                        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      />
                    ) : (
                      row.facturaEmitida || <span style={{ color: "var(--ink-muted)" }}>Sin emitir</span>
                    )}
                  </td>
                  <td className="py-2">
                    {!state.editing && !state.movingToPause && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => patch(row.cliente, row, { editing: true })}
                          className="text-xs underline"
                          style={{ color: "var(--ink-secondary)" }}
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => patch(row.cliente, row, { movingToPause: true })}
                          className="text-xs underline"
                          style={{ color: "var(--ink-secondary)" }}
                        >
                          Mover a pausa
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
                    {state.autoPauseNote && (
                      <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                        {state.autoPauseNote}
                      </div>
                    )}

                    {state.movingToPause && !state.pauseConfirming && (
                      <div className="flex flex-col gap-1">
                        <input
                          value={state.pauseComentario}
                          onChange={(e) => patch(row.cliente, row, { pauseComentario: e.target.value })}
                          placeholder="Comentario (ej. fecha de retorno)"
                          className="w-48 rounded border px-1.5 py-0.5 text-xs"
                          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                        />
                        <div className="flex gap-3">
                          <button
                            onClick={() => patch(row.cliente, row, { pauseConfirming: true })}
                            className="text-xs font-medium"
                            style={{ color: "var(--brand)" }}
                          >
                            Mover a pausa
                          </button>
                          <button
                            onClick={() => patch(row.cliente, row, { movingToPause: false })}
                            className="text-xs"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                    {state.pauseConfirming && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs" style={{ color: "var(--status-warning)" }}>
                          ¿Mover &quot;{row.cliente}&quot; a clientes en pausa?
                        </span>
                        <div className="flex gap-3">
                          <button
                            onClick={() => confirmMoveToPause(row)}
                            disabled={state.pauseSaving}
                            className="text-xs font-medium"
                            style={{ color: "var(--status-critical)" }}
                          >
                            {state.pauseSaving ? "Moviendo…" : "Sí, mover"}
                          </button>
                          <button
                            onClick={() => patch(row.cliente, row, { pauseConfirming: false })}
                            disabled={state.pauseSaving}
                            className="text-xs"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                    {state.pauseError && (
                      <div className="mt-1 text-xs" style={{ color: "var(--status-critical)" }}>
                        {state.pauseError}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
