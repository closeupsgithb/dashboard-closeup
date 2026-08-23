"use client";

import { useState } from "react";
import { formatEUR, formatRatio } from "@/lib/format";

export type RoasClienteDetalle = {
  cliente: string;
  origenCboLeadsRefor: boolean;
  ingresoAcumulado: number;
  incluidoEnRoas: boolean;
  clienteSheet: string | null;
  periodoEdicion: string | null;
  estadoActual: string | null;
  importeRawActual: string | null;
  origenActual: string;
  motivo: string | null;
};

export type RoasRow = {
  gastoAdsAcumulado: number;
  ingresoAtribuido: number;
  roas: number | null;
  detalle: RoasClienteDetalle[];
  ultimoPeriodo: string | null;
  motivo: string | null;
};

const ESTADO_OPTIONS = ["", "Hecho", "Pendiente", "50%", "STAND BY"];
// "" = automático (el dashboard decide por atribución de GHL). Un valor
// explícito aquí tiene SIEMPRE prioridad sobre ese cálculo automático.
const ORIGEN_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Automático (según GHL)" },
  { value: "CBO_LEADS_REFOR", label: "CBO_LEADS_REFOR" },
  { value: "Organico", label: "Orgánico" },
];

type RowState = {
  editing: boolean;
  confirming: boolean;
  saving: boolean;
  error: string | null;
  draftEstado: string;
  draftImporte: string;
  draftOrigen: string;
};

function initialRowState(d: RoasClienteDetalle): RowState {
  return {
    editing: false,
    confirming: false,
    saving: false,
    error: null,
    draftEstado: d.estadoActual ?? "",
    draftImporte: d.importeRawActual ?? "",
    draftOrigen: d.origenActual,
  };
}

// Edición inline igual que en el resto de tablas (Editar -> Guardar pide
// confirmación -> Sí, escribir hace el POST real) — solo disponible para
// filas que ya tienen una fila real en el Sheet (clienteSheet !== null).
// Solo cinco columnas para que se entienda de un vistazo: cliente, origen,
// estado de pago, importe acumulado y edición — sin ningún detalle técnico
// de cómo se cruzó el nombre.
export function RoasTable({ data, onSaved }: { data: RoasRow; onSaved: () => void }) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  if (data.detalle.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Todavía no hay ningún periodo reportado con el que calcular ROAS.
      </p>
    );
  }

  function stateFor(d: RoasClienteDetalle): RowState {
    return rowStates[d.cliente] ?? initialRowState(d);
  }

  function patch(cliente: string, d: RoasClienteDetalle, p: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [cliente]: { ...(prev[cliente] ?? initialRowState(d)), ...p } }));
  }

  async function confirmSave(d: RoasClienteDetalle) {
    const state = stateFor(d);
    patch(d.cliente, d, { saving: true, error: null });
    try {
      const res = await fetch("/api/sheet-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo: d.periodoEdicion,
          cliente: d.clienteSheet,
          estado: state.draftEstado,
          importe: state.draftImporte,
          origen: state.draftOrigen,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(d.cliente, d, { saving: false, confirming: false, error: json.detail ?? json.error ?? "Error al guardar" });
        return;
      }
      patch(d.cliente, d, { saving: false, confirming: false, editing: false, error: null });
      onSaved();
    } catch {
      patch(d.cliente, d, { saving: false, confirming: false, error: "No se pudo conectar con el servidor" });
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <span className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>
            {formatRatio(data.roas)}
          </span>
          <span className="ml-2 text-sm" style={{ color: "var(--ink-secondary)" }}>
            ROAS CBO_LEADS_REFOR — acumulado{data.ultimoPeriodo ? ` hasta ${data.ultimoPeriodo}` : ""}
          </span>
        </div>
        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
          Ingreso acumulado {formatEUR(data.ingresoAtribuido)} / Gasto acumulado {formatEUR(data.gastoAdsAcumulado)}
        </div>
      </div>

      {data.motivo && (
        <p className="mb-4 text-xs" style={{ color: "var(--ink-muted)" }}>
          {data.motivo}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
            <th className="pb-2 font-normal">Cliente</th>
            <th className="pb-2 font-normal">Origen</th>
            <th className="pb-2 font-normal">Estado</th>
            <th className="pb-2 font-normal text-right">Importe acumulado</th>
            <th className="pb-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {data.detalle.map((d) => {
            const state = stateFor(d);
            return (
              <tr key={d.cliente} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-2">{d.cliente}</td>
                <td className="py-2">
                  {state.editing ? (
                    <select
                      value={state.draftOrigen}
                      onChange={(e) => patch(d.cliente, d, { draftOrigen: e.target.value })}
                      className="rounded border px-1.5 py-0.5"
                      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    >
                      {ORIGEN_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    d.origenCboLeadsRefor ? "CBO_LEADS_REFOR" : "Otro / orgánico"
                  )}
                </td>
                <td className="py-2">
                  {state.editing ? (
                    <select
                      value={state.draftEstado}
                      onChange={(e) => patch(d.cliente, d, { draftEstado: e.target.value })}
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
                    d.estadoActual ?? <span style={{ color: "var(--ink-muted)" }}>Sin confirmar</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {state.editing ? (
                    <input
                      value={state.draftImporte}
                      onChange={(e) => patch(d.cliente, d, { draftImporte: e.target.value })}
                      className="w-24 rounded border px-1.5 py-0.5"
                      style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    />
                  ) : (
                    formatEUR(d.ingresoAcumulado)
                  )}
                </td>
                <td className="py-2">
                  {d.clienteSheet === null ? null : !state.editing && !state.confirming ? (
                    <button
                      onClick={() => patch(d.cliente, d, { editing: true })}
                      className="text-xs underline"
                      style={{ color: "var(--ink-secondary)" }}
                    >
                      Editar
                    </button>
                  ) : state.editing && !state.confirming ? (
                    <div className="flex gap-3">
                      <button
                        onClick={() => patch(d.cliente, d, { confirming: true })}
                        className="text-xs font-medium"
                        style={{ color: "var(--brand)" }}
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => patch(d.cliente, d, initialRowState(d))}
                        className="text-xs"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs" style={{ color: "var(--status-warning)" }}>
                        ¿Escribir en el Sheet ({d.periodoEdicion})?
                      </span>
                      <div className="flex gap-3">
                        <button
                          onClick={() => confirmSave(d)}
                          disabled={state.saving}
                          className="text-xs font-medium"
                          style={{ color: "var(--status-critical)" }}
                        >
                          {state.saving ? "Guardando…" : "Sí, escribir"}
                        </button>
                        <button
                          onClick={() => patch(d.cliente, d, { confirming: false })}
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
    </div>
  );
}
