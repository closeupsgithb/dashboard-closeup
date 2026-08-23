"use client";

import { useMemo, useState } from "react";
import { madridDateOnly } from "@/lib/format";

export type ReunionRosterRow = {
  opportunityId: string;
  contactId: string;
  nombreContacto: string;
  empresa: string | null;
  cliente: string;
  closer: string;
  mes: string | null;
  asistio: "Sí" | "No" | "Pendiente";
  fuenteAsistio: "manual" | "pipeline";
  confirmadoPorCalendario: boolean;
  fechaReunion: string | null;
};

type RowState = {
  editing: boolean;
  confirming: boolean;
  saving: boolean;
  error: string | null;
  draft: "Sí" | "No" | "";
  ghlNote: string | null;
};

// Vista por defecto: solo hoy y ayer, en fecha de ESPAÑA (Europe/Madrid) —
// pedido explícito de Daniel: "hoy" no puede depender del huso horario del
// navegador o del servidor donde corra esto. Se compara por fecha-de-Madrid
// (string YYYY-MM-DD vía madridDateOnly), no con aritmética de medianoche en
// hora local ambiente ni con Date.now() (que además violaría las reglas de
// pureza de render de React) — así funciona igual sin importar dónde se abra
// el dashboard. Se actualiza sola día a día porque el corte se calcula contra
// "asOf" (el momento real en que se generaron los datos).
const DIAS_ATRAS_POR_DEFECTO = 1;

export function ReunionManualTable({
  roster,
  asOf,
  onSaved,
}: {
  roster: ReunionRosterRow[];
  asOf: string;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  const sorted = useMemo(
    () =>
      [...roster].sort((a, b) => new Date(b.fechaReunion ?? 0).getTime() - new Date(a.fechaReunion ?? 0).getTime()),
    [roster]
  );

  const filtered = useMemo(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return sorted.filter(
        (r) => r.nombreContacto.toLowerCase().includes(q) || (r.empresa ?? "").toLowerCase().includes(q)
      );
    }
    const hoyMadrid = madridDateOnly(asOf);
    const ayerMadrid = madridDateOnly(new Date(asOf).getTime() - DIAS_ATRAS_POR_DEFECTO * 24 * 60 * 60 * 1000);
    return sorted.filter((r) => r.fechaReunion && [hoyMadrid, ayerMadrid].includes(madridDateOnly(r.fechaReunion)));
  }, [sorted, query, asOf]);

  const EMPTY_STATE: RowState = { editing: false, confirming: false, saving: false, error: null, draft: "", ghlNote: null };

  function stateFor(row: ReunionRosterRow): RowState {
    return rowStates[row.opportunityId] ?? EMPTY_STATE;
  }

  function patch(opportunityId: string, p: Partial<RowState>) {
    setRowStates((prev) => ({
      ...prev,
      [opportunityId]: { ...(prev[opportunityId] ?? EMPTY_STATE), ...p },
    }));
  }

  async function confirmSave(row: ReunionRosterRow) {
    const state = stateFor(row);
    patch(row.opportunityId, { saving: true, error: null, ghlNote: null });
    try {
      const res = await fetch("/api/reunion-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: row.opportunityId, contacto: row.nombreContacto, asistio: state.draft }),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(row.opportunityId, { saving: false, confirming: false, error: json.detail ?? json.error ?? "Error al guardar" });
        return;
      }
      const ghlNote =
        state.draft === "No"
          ? json.ghl?.moved
            ? "Movido a \"No Asiste\" en GHL."
            : `No se movió en GHL: ${json.ghl?.motivo ?? "motivo desconocido"}`
          : null;
      patch(row.opportunityId, { saving: false, confirming: false, editing: false, error: null, ghlNote });
      onSaved();
    } catch {
      patch(row.opportunityId, { saving: false, confirming: false, error: "No se pudo conectar con el servidor" });
    }
  }

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar contacto o empresa…"
        className="mb-3 w-full max-w-xs rounded border px-2 py-1 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
      />
      {!query.trim() && (
        <p className="mb-2 text-xs" style={{ color: "var(--ink-muted)" }}>
          Mostrando hoy y ayer — busca un nombre para encontrar reuniones de otros días.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
            <th className="pb-2 font-normal">Contacto</th>
            <th className="pb-2 font-normal">Empresa</th>
            <th className="pb-2 font-normal">Closer</th>
            <th className="pb-2 font-normal">Fecha reunión</th>
            <th className="pb-2 font-normal">Asistió</th>
            <th className="pb-2 font-normal">Calendario</th>
            <th className="pb-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => {
            const state = stateFor(row);
            return (
              <tr key={row.opportunityId} className="border-t align-top" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-2">{row.nombreContacto}</td>
                <td className="py-2">{row.empresa ?? "—"}</td>
                <td className="py-2">{row.closer}</td>
                <td className="py-2">{row.fechaReunion ? madridDateOnly(row.fechaReunion) : "—"}</td>
                <td className="py-2">
                  {row.asistio}{" "}
                  <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    ({row.fuenteAsistio === "manual" ? "marcado a mano" : "GHL"})
                  </span>
                </td>
                <td className="py-2 text-xs" style={{ color: row.confirmadoPorCalendario ? "var(--status-good)" : "var(--ink-muted)" }}>
                  {row.confirmadoPorCalendario ? "Confirmado" : "Sin confirmar"}
                </td>
                <td className="py-2">
                  {!state.editing && (
                    <button
                      onClick={() => patch(row.opportunityId, { editing: true, draft: "" })}
                      className="text-xs underline"
                      style={{ color: "var(--ink-secondary)" }}
                    >
                      Marcar
                    </button>
                  )}
                  {state.editing && !state.confirming && (
                    <div className="flex items-center gap-2">
                      <select
                        value={state.draft}
                        onChange={(e) => patch(row.opportunityId, { draft: e.target.value as "Sí" | "No" | "" })}
                        className="rounded border px-1.5 py-0.5 text-xs"
                        style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                      >
                        <option value="">(elegir)</option>
                        <option value="Sí">Sí</option>
                        <option value="No">No</option>
                      </select>
                      <button
                        onClick={() => patch(row.opportunityId, { confirming: true })}
                        disabled={!state.draft}
                        className="text-xs font-medium disabled:opacity-40"
                        style={{ color: "var(--brand)" }}
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => patch(row.opportunityId, { editing: false })}
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
                        ¿Marcar como &quot;{state.draft}&quot;? Tendrá prioridad sobre GHL.
                      </span>
                      <div className="flex gap-3">
                        <button
                          onClick={() => confirmSave(row)}
                          disabled={state.saving}
                          className="text-xs font-medium"
                          style={{ color: "var(--status-critical)" }}
                        >
                          {state.saving ? "Guardando…" : "Sí, marcar"}
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
                  {state.ghlNote && (
                    <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                      {state.ghlNote}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-xs" style={{ color: "var(--ink-muted)" }}>
                {query.trim() ? "Sin resultados." : "No hay reuniones hoy ni ayer."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
