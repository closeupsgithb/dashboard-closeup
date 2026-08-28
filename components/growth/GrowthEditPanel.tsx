"use client";

import { useState } from "react";
import { madridDateOnly } from "@/lib/format";

export type CloserOption = { id: string; displayName: string; active: boolean };

export type PanelOpportunity = {
  opportunityId: string;
  // Cita concreta a la que se le asigna el resultado de "Asistió/No show"
  // (growth_appointments.attendance) — sin esto, el panel no sabría a QUÉ
  // reunión pertenece un "Sí"/"No" si la oportunidad ya tuviera más de una
  // cita (Call 1 + Call 2). Null cuando el panel se abre desde Follow-ups o
  // Leads (sin una cita concreta a la vista): el servidor usa entonces la
  // cita activa de la oportunidad como respaldo.
  appointmentId?: string | null;
  contactName: string | null;
  companyName: string | null;
  closerId: string | null;
  proximoPaso: string | null;
  stageId: string;
  stageName: string;
  status: string;
  asistioReunionRaw: string | null;
  scheduledAt?: string | null;
  followUpDueAt?: string | null;
  followUpTitle?: string | null;
  followUpTaskId?: string | null;
};

// "2026-08-23T08:00:00.000Z" (UTC) -> "2026-08-23T10:00" (hora local Madrid,
// formato que espera <input type="datetime-local">). Sin librería de fechas:
// se leen las partes ya convertidas a Europe/Madrid con Intl.
function isoToMadridLocalInput(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Mismos valores reales que lib/growth/ghl.ts (PROXIMO_PASO_VALUES,
// FOLLOW_UP_REQUIRED_STEPS, GROWTH_STAGES) — duplicados aquí a propósito
// porque ese archivo usa credenciales de servidor y no debe importarse en un
// componente cliente. Si cambian allí, deben cambiar aquí igual.
const PROXIMO_PASO_OPTIONS = [
  "No definido",
  "Call 2",
  "Hablar con socio / mujer",
  "Follow-up",
  "Enviar propuesta",
  "Firmar contrato",
  "Pago",
];

const FOLLOW_UP_STEPS = new Set(["Follow-up", "Enviar propuesta", "Hablar con socio / mujer", "Firmar contrato", "Pago"]);

const ETAPA_OPTIONS: { id: string; label: string }[] = [
  { id: "267658fd-26fb-4976-9cb9-c8308fff8d20", label: "Nuevo cualificado | Sin agenda" },
  { id: "ac3355de-a3d1-412a-8db0-75bc2e4276b8", label: "Agendado | Pendiente confirmación" },
  { id: "74566df6-7f7d-4df7-a849-89689626b206", label: "Agendado | Confirmado" },
  { id: "072230fe-3185-4871-a785-d47c028985d8", label: "Solicita Reagendar" },
  { id: "a180c129-b51c-4543-b275-de7934342d1f", label: "No-show | Recuperación" },
  { id: "b5e8900d-65b1-4174-9f10-ce0a68fa896c", label: "Reunión realizada | Interesado" },
  { id: "32634bf6-7aee-44f2-a9e7-196ee9e3f1d2", label: "Follow-up / Call 2" },
  { id: "4082dbca-df89-4ff0-9dd9-52b3986ee360", label: "Pagado" },
];
const STAGE_PAGADO = "4082dbca-df89-4ff0-9dd9-52b3986ee360";

const LOCATION_ID = "gNZGfOheofHgZtuYObm7";

type SecondaryAction = "" | "reunion2" | "perdido" | "abandonado";
type DiffItem = { label: string; before: string; after: string; warn?: boolean };
type StepResult = { label: string; ok: boolean; error?: string };

function fmtLocal(v: string): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(v));
}

export function GrowthEditPanel({
  opportunity,
  closers,
  onClose,
  onSaved,
}: {
  opportunity: PanelOpportunity;
  closers: CloserOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const originalAsistio = opportunity.asistioReunionRaw ?? "Pendiente";
  const originalProximoPaso = opportunity.proximoPaso ?? "No definido";

  const hasExistingFollowUp = Boolean(opportunity.followUpTaskId);

  const [draftCloser, setDraftCloser] = useState(opportunity.closerId ?? "");
  const [draftAsistio, setDraftAsistio] = useState(originalAsistio);
  const [draftProximoPaso, setDraftProximoPaso] = useState(originalProximoPaso);
  const [draftEtapa, setDraftEtapa] = useState(opportunity.stageId);
  const [reagendarOpen, setReagendarOpen] = useState(false);
  const [draftReagendarFecha, setDraftReagendarFecha] = useState("");
  const [followUpFecha, setFollowUpFecha] = useState(opportunity.followUpDueAt ? isoToMadridLocalInput(opportunity.followUpDueAt) : "");
  const [followUpAccion, setFollowUpAccion] = useState(opportunity.followUpTitle ?? "");
  const [followUpCompletar, setFollowUpCompletar] = useState(false);
  const [draftPagado, setDraftPagado] = useState(false);
  const [pagadoConfirmChecked, setPagadoConfirmChecked] = useState(false);

  const [step, setStep] = useState<"editing" | "reviewing">("editing");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResults, setSaveResults] = useState<StepResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showMore, setShowMore] = useState(false);
  const [secondaryAction, setSecondaryAction] = useState<SecondaryAction>("");
  const [confirmingSecondary, setConfirmingSecondary] = useState(false);
  const [secondaryFecha, setSecondaryFecha] = useState("");
  const [secondarySaving, setSecondarySaving] = useState(false);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);

  const yaPagado = opportunity.stageId === STAGE_PAGADO;
  const needsFollowUp = FOLLOW_UP_STEPS.has(draftProximoPaso);
  const followUpValid = !needsFollowUp || followUpCompletar || (followUpFecha.trim() !== "" && followUpAccion.trim() !== "");
  const reagendarValid = !reagendarOpen || draftReagendarFecha.trim() !== "";

  const followUpOriginalFecha = opportunity.followUpDueAt ? isoToMadridLocalInput(opportunity.followUpDueAt) : "";
  const followUpOriginalAccion = opportunity.followUpTitle ?? "";
  const followUpChanged = followUpFecha !== followUpOriginalFecha || followUpAccion !== followUpOriginalAccion;

  const isDirty =
    draftCloser !== (opportunity.closerId ?? "") ||
    draftAsistio !== originalAsistio ||
    draftProximoPaso !== originalProximoPaso ||
    draftEtapa !== opportunity.stageId ||
    (reagendarOpen && draftReagendarFecha !== "") ||
    draftPagado ||
    followUpCompletar ||
    (!hasExistingFollowUp && (followUpFecha !== "" || followUpAccion !== "")) ||
    (hasExistingFollowUp && followUpChanged);

  function closerLabel(id: string | null): string {
    if (!id) return "Sin asignar";
    return closers.find((c) => c.id === id)?.displayName ?? "Closer desconocido";
  }
  function etapaLabel(id: string): string {
    return ETAPA_OPTIONS.find((e) => e.id === id)?.label ?? id;
  }

  function buildDiffs(): DiffItem[] {
    const diffs: DiffItem[] = [];
    if (draftCloser !== (opportunity.closerId ?? "")) {
      diffs.push({ label: "Closer", before: closerLabel(opportunity.closerId), after: closerLabel(draftCloser || null) });
    }
    if (draftAsistio !== originalAsistio) {
      diffs.push({ label: "Resultado de la reunión", before: originalAsistio, after: draftAsistio });
    }
    if (reagendarOpen && draftReagendarFecha) {
      diffs.push({ label: "Nueva fecha de reunión", before: "—", after: fmtLocal(draftReagendarFecha) });
    }
    if (draftProximoPaso !== originalProximoPaso) {
      diffs.push({ label: "Próximo paso", before: originalProximoPaso, after: draftProximoPaso });
    }
    if (draftEtapa !== opportunity.stageId) {
      diffs.push({ label: "Etapa del pipeline (manual)", before: opportunity.stageName, after: etapaLabel(draftEtapa), warn: true });
    }
    if (followUpCompletar) {
      diffs.push({ label: "Follow-up", before: followUpOriginalAccion || "—", after: "Completado" });
    } else if (needsFollowUp && followUpFecha && followUpAccion.trim() && (!hasExistingFollowUp || followUpChanged)) {
      diffs.push({
        label: hasExistingFollowUp ? "Follow-up (editar tarea en GHL)" : "Follow-up (nueva tarea en GHL)",
        before: hasExistingFollowUp ? `${fmtLocal(opportunity.followUpDueAt ?? "")} — ${followUpOriginalAccion}` : "—",
        after: `${fmtLocal(followUpFecha)} — ${followUpAccion.trim()}`,
      });
    }
    if (draftPagado) {
      diffs.push({ label: "PAGADO", before: opportunity.stageName, after: "Pagado — cuenta como venta confirmada", warn: true });
    }
    return diffs;
  }

  async function postAction(body: Record<string, unknown>) {
    const res = await fetch("/api/growth/opportunity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId: opportunity.opportunityId, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail ?? json.error ?? "Error al guardar");
    return json;
  }

  function irARevisar() {
    setError(null);
    if (!followUpValid || !reagendarValid) return;
    setStep("reviewing");
  }

  async function confirmarYGuardar() {
    setSaving(true);
    setError(null);
    const results: StepResult[] = [];
    async function runStep(label: string, fn: () => Promise<unknown>) {
      try {
        await fn();
        results.push({ label, ok: true });
      } catch (err) {
        results.push({ label, ok: false, error: err instanceof Error ? err.message : "Error" });
      }
    }

    if (draftCloser !== (opportunity.closerId ?? "")) {
      await runStep("Closer", () => postAction({ action: "closer", closerId: draftCloser || null }));
    }
    if (draftAsistio !== originalAsistio && (draftAsistio === "Sí" || draftAsistio === "No")) {
      try {
        const res = await postAction({ action: "asistio", value: draftAsistio, appointmentId: opportunity.appointmentId ?? undefined });
        // El resultado ya quedó guardado en el histórico aunque GHL falle
        // (Fase 36) — se muestra como éxito con una nota, no como fallo.
        results.push({
          label: res.ghlSyncWarning ? "Resultado de la reunión (no se reflejó en GHL, revisa el pipeline)" : "Resultado de la reunión",
          ok: true,
        });
      } catch (err) {
        results.push({ label: "Resultado de la reunión", ok: false, error: err instanceof Error ? err.message : "Error" });
      }
    }
    if (reagendarOpen && draftReagendarFecha) {
      await runStep("Nueva fecha de reunión", () =>
        postAction({ action: "reagendar", nuevaFechaIso: new Date(draftReagendarFecha).toISOString() })
      );
    }
    if (draftProximoPaso !== originalProximoPaso) {
      await runStep("Próximo paso", () => postAction({ action: "proximoPaso", value: draftProximoPaso }));
    }
    if (draftEtapa !== opportunity.stageId) {
      await runStep("Etapa del pipeline", () => postAction({ action: "etapaManual", stageId: draftEtapa }));
    }
    if (followUpCompletar && opportunity.followUpTaskId) {
      await runStep("Follow-up completado", () => postAction({ action: "followUpComplete", taskId: opportunity.followUpTaskId }));
    } else if (needsFollowUp && followUpFecha && followUpAccion.trim() && (!hasExistingFollowUp || followUpChanged)) {
      await runStep(hasExistingFollowUp ? "Follow-up (editado)" : "Follow-up (creado)", () =>
        postAction({
          action: "followUp",
          dueIso: new Date(followUpFecha).toISOString(),
          titulo: followUpAccion.trim(),
          taskId: opportunity.followUpTaskId ?? undefined,
        })
      );
    }
    if (draftPagado) {
      await runStep("Pagado", () => postAction({ action: "pagado" }));
    }

    setSaving(false);
    setSaveResults(results);
    onSaved();
    if (results.every((r) => r.ok)) {
      onClose();
    }
  }

  async function ejecutarSecundaria() {
    setSecondarySaving(true);
    setSecondaryError(null);
    try {
      if (secondaryAction === "reunion2") {
        if (!secondaryFecha) throw new Error("Elige fecha y hora para la reunión 2");
        await postAction({ action: "reunion2", nuevaFechaIso: new Date(secondaryFecha).toISOString() });
      } else if (secondaryAction === "perdido") {
        await postAction({ action: "perdido" });
      } else if (secondaryAction === "abandonado") {
        await postAction({ action: "abandonado" });
      }
      onSaved();
      onClose();
    } catch (err) {
      setSecondaryError(err instanceof Error ? err.message : "Error al guardar");
      setConfirmingSecondary(false);
    } finally {
      setSecondarySaving(false);
    }
  }

  function handleCloseClick() {
    if (isDirty && !saveResults) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  const diffs = step === "reviewing" ? buildDiffs() : [];
  const canConfirmFinal = !draftPagado || pagadoConfirmChecked;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button aria-label="Cerrar" onClick={handleCloseClick} className="absolute inset-0" style={{ background: "rgba(11,11,11,0.35)" }} />
      <div
        className="relative z-10 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-5"
        style={{ background: "var(--surface)", borderLeft: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              {opportunity.contactName ?? "—"}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
              <span>
                {opportunity.companyName ?? "—"} · {opportunity.stageName}
              </span>
              {yaPagado && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(12,163,12,0.12)", color: "var(--status-good)" }}>
                  PAGADO ✓
                </span>
              )}
            </div>
          </div>
          <button onClick={handleCloseClick} className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Cerrar
          </button>
        </div>

        {confirmDiscard && (
          <div className="rounded border p-3" style={{ borderColor: "var(--status-warning)", background: "rgba(250,178,25,0.08)" }}>
            <p className="mb-2 text-xs" style={{ color: "var(--ink)" }}>
              Tienes cambios sin guardar. Si cierras ahora se descartan y no se envía nada a GHL.
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="text-xs font-medium" style={{ color: "var(--status-critical)" }}>
                Descartar y cerrar
              </button>
              <button onClick={() => setConfirmDiscard(false)} className="text-xs" style={{ color: "var(--ink-muted)" }}>
                Seguir editando
              </button>
            </div>
          </div>
        )}

        {saveResults && (
          <div
            className="rounded border p-3"
            style={{
              borderColor: saveResults.every((r) => r.ok) ? "var(--status-good)" : "var(--status-critical)",
              background: saveResults.every((r) => r.ok) ? "rgba(12,163,12,0.06)" : "rgba(208,59,59,0.06)",
            }}
          >
            <p className="mb-1.5 text-xs font-medium" style={{ color: "var(--ink)" }}>
              {saveResults.every((r) => r.ok) ? "Guardado correctamente." : "Guardado parcial — revisa qué falló:"}
            </p>
            <ul className="flex flex-col gap-0.5 text-xs">
              {saveResults.map((r, i) => (
                <li key={i} style={{ color: r.ok ? "var(--status-good)" : "var(--status-critical)" }}>
                  {r.ok ? "✓" : "✗"} {r.label}
                  {!r.ok && r.error ? ` — ${r.error}` : ""}
                </li>
              ))}
            </ul>
            {!saveResults.every((r) => r.ok) && (
              <button onClick={onClose} className="mt-2 text-xs underline" style={{ color: "var(--ink-secondary)" }}>
                Cerrar de todos modos
              </button>
            )}
          </div>
        )}

        {!saveResults && step === "editing" && !confirmDiscard && (
          <>
            <Field label="Closer">
              <select
                value={draftCloser}
                onChange={(e) => setDraftCloser(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
              >
                <option value="">Sin asignar</option>
                {closers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Resultado de la reunión">
              <select
                value={draftAsistio}
                onChange={(e) => setDraftAsistio(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
              >
                <option value="Pendiente">Pendiente</option>
                <option value="Sí">Asistió</option>
                <option value="No">No show</option>
              </select>
              {draftAsistio === "No" && (
                <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  Elige qué toca ahora: reprograma la reunión abajo, define un próximo paso de seguimiento, o usa
                  &quot;Acciones sensibles&quot; si se pierde.
                </span>
              )}
            </Field>

            <div className="flex flex-col gap-1.5">
              <button onClick={() => setReagendarOpen((v) => !v)} className="self-start text-xs underline" style={{ color: "var(--ink-secondary)" }}>
                {reagendarOpen ? "Cancelar reprogramación" : "Reprogramar esta reunión"}
              </button>
              {reagendarOpen && (
                <input
                  type="datetime-local"
                  value={draftReagendarFecha}
                  onChange={(e) => setDraftReagendarFecha(e.target.value)}
                  className="rounded border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
                />
              )}
              {reagendarOpen && !reagendarValid && (
                <span className="text-xs" style={{ color: "var(--status-critical)" }}>
                  Elige fecha y hora, o cancela la reprogramación.
                </span>
              )}
            </div>

            <Field label="Próximo paso">
              <select
                value={draftProximoPaso}
                onChange={(e) => setDraftProximoPaso(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
              >
                {PROXIMO_PASO_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            {needsFollowUp && (
              <div className="flex flex-col gap-1.5 rounded-lg border p-3" style={{ borderColor: "var(--status-critical)", background: "rgba(208,59,59,0.05)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--status-critical)" }}>
                  {hasExistingFollowUp ? "Follow-up pendiente para este lead" : "Este próximo paso requiere fecha y acción concreta de seguimiento"}
                </span>

                {hasExistingFollowUp && (
                  <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                    <input type="checkbox" checked={followUpCompletar} onChange={(e) => setFollowUpCompletar(e.target.checked)} />
                    Marcar como completado
                  </label>
                )}

                {!followUpCompletar && (
                  <>
                    <label className="text-xs" style={{ color: "var(--ink-secondary)" }}>
                      Fecha y hora de seguimiento
                    </label>
                    <input
                      type="datetime-local"
                      value={followUpFecha}
                      onChange={(e) => setFollowUpFecha(e.target.value)}
                      className="rounded border px-2 py-1.5 text-sm"
                      style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
                    />
                    <label className="text-xs" style={{ color: "var(--ink-secondary)" }}>
                      Acción concreta (se guarda como tarea en GHL)
                    </label>
                    <input
                      type="text"
                      value={followUpAccion}
                      onChange={(e) => setFollowUpAccion(e.target.value)}
                      placeholder="Ej: Llamar para resolver dudas de precio"
                      className="rounded border px-2 py-1.5 text-sm"
                      style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
                    />
                    {hasExistingFollowUp && (
                      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        Guardar con estos campos edita la misma tarea de GHL (fecha y/o acción) — no crea una tarea
                        duplicada. Para pasar al siguiente paso en vez de reprogramar este, márcalo completado y abre
                        el panel de nuevo.
                      </span>
                    )}
                    {!followUpValid && (
                      <span className="text-xs" style={{ color: "var(--status-critical)" }}>
                        No se puede guardar sin fecha y acción concreta cuando el próximo paso es de seguimiento.
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

            <Field label="Etapa del pipeline (manual)">
              <select
                value={draftEtapa}
                onChange={(e) => setDraftEtapa(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
              >
                {ETAPA_OPTIONS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
              {draftEtapa !== opportunity.stageId && (
                <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  Cambiar la etapa a mano puede activar automatizaciones de GHL asociadas a esa fase. Solo úsalo si sabes qué dispara.
                </span>
              )}
            </Field>

            {!yaPagado && (
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={draftPagado} onChange={(e) => setDraftPagado(e.target.checked)} />
                Marcar como PAGADO (venta confirmada)
              </label>
            )}

            <button
              onClick={irARevisar}
              disabled={!followUpValid || !reagendarValid}
              className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--brand)", color: "white" }}
            >
              Guardar cambios
            </button>

            <a
              href={`https://app.gohighlevel.com/v2/location/${LOCATION_ID}/contacts/detail/${opportunity.opportunityId}`}
              target="_blank"
              rel="noreferrer"
              className="self-start text-xs underline"
              style={{ color: "var(--ink-muted)" }}
            >
              Abrir en GHL
            </a>

            <hr style={{ borderColor: "var(--gridline)" }} />

            <button onClick={() => setShowMore((v) => !v)} className="text-left text-xs font-medium" style={{ color: "var(--ink-secondary)" }}>
              {showMore ? "Ocultar más acciones" : "Más acciones"}
            </button>

            {showMore && (
              <div className="flex flex-col gap-3 rounded border p-3" style={{ borderColor: "var(--gridline)" }}>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs" style={{ color: "var(--ink-secondary)" }}>
                    Registrar reunión 2 (crea una cita nueva en GHL)
                  </label>
                  <input
                    type="datetime-local"
                    value={secondaryAction === "reunion2" ? secondaryFecha : ""}
                    onChange={(e) => {
                      setSecondaryAction("reunion2");
                      setSecondaryFecha(e.target.value);
                    }}
                    className="rounded border px-2 py-1 text-sm"
                    style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
                  />
                  {secondaryAction === "reunion2" && (
                    <button
                      onClick={() => setConfirmingSecondary(true)}
                      disabled={!secondaryFecha}
                      className="self-start text-xs font-medium disabled:opacity-40"
                      style={{ color: "var(--brand)" }}
                    >
                      Registrar reunión 2
                    </button>
                  )}
                </div>
              </div>
            )}

            <details className="rounded border p-3" style={{ borderColor: "var(--status-critical)" }}>
              <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--status-critical)" }}>
                Acciones sensibles
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  Archivan la oportunidad: deja de contar como activa, de aparecer en la agenda y en el funnel del periodo. El historial se conserva.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => {
                      setSecondaryAction("perdido");
                      setConfirmingSecondary(true);
                    }}
                    className="text-xs font-medium"
                    style={{ color: "var(--status-critical)" }}
                  >
                    Marcar perdido
                  </button>
                  <button
                    onClick={() => {
                      setSecondaryAction("abandonado");
                      setConfirmingSecondary(true);
                    }}
                    className="text-xs font-medium"
                    style={{ color: "var(--status-critical)" }}
                  >
                    Marcar abandonado
                  </button>
                </div>
              </div>
            </details>

            {confirmingSecondary && (
              <div
                className="rounded border p-3"
                style={{
                  borderColor: secondaryAction === "reunion2" ? "var(--border)" : "var(--status-critical)",
                  background: secondaryAction === "reunion2" ? undefined : "rgba(208,59,59,0.06)",
                }}
              >
                <p className="mb-2 text-xs" style={{ color: "var(--ink)" }}>
                  {secondaryAction === "reunion2"
                    ? `¿Registrar reunión 2 para ${madridDateOnly(secondaryFecha)}? Se creará una cita real en GHL.`
                    : "Esta oportunidad dejará de aparecer en la vista activa y no contará en el funnel ni en el show rate del periodo, pero conservará su historial. ¿Confirmas?"}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={ejecutarSecundaria}
                    disabled={secondarySaving}
                    className="text-xs font-medium"
                    style={{ color: secondaryAction === "reunion2" ? "var(--brand)" : "var(--status-critical)" }}
                  >
                    {secondarySaving ? "Guardando…" : "Sí, continuar"}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmingSecondary(false);
                      setSecondaryAction("");
                    }}
                    disabled={secondarySaving}
                    className="text-xs"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {secondaryError && (
              <div className="text-xs" style={{ color: "var(--status-critical)" }}>
                {secondaryError}
              </div>
            )}
          </>
        )}

        {!saveResults && step === "reviewing" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              Cambios que se aplicarán
            </p>
            {diffs.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                No hay cambios que guardar.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {diffs.map((d) => (
                  <li
                    key={d.label}
                    className="rounded border p-2 text-xs"
                    style={{ borderColor: d.warn ? "var(--status-critical)" : "var(--gridline)", background: d.warn ? "rgba(208,59,59,0.06)" : undefined }}
                  >
                    <div className="font-medium" style={{ color: d.warn ? "var(--status-critical)" : "var(--ink)" }}>
                      {d.label}
                    </div>
                    <div style={{ color: "var(--ink-muted)" }}>
                      {d.before} → {d.after}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {draftPagado && (
              <label className="flex items-start gap-2 rounded border p-2 text-xs" style={{ borderColor: "var(--status-critical)", background: "rgba(208,59,59,0.06)", color: "var(--ink)" }}>
                <input type="checkbox" checked={pagadoConfirmChecked} onChange={(e) => setPagadoConfirmChecked(e.target.checked)} className="mt-0.5" />
                <span>
                  Confirmo que esta es una venta real y lista para contarse. Se moverá la oportunidad a la fase Pagado en GHL y se sumará a
                  facturación y close rate. No se deshace con un clic.
                </span>
              </label>
            )}

            {error && (
              <div className="text-xs" style={{ color: "var(--status-critical)" }}>
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={confirmarYGuardar}
                disabled={saving || diffs.length === 0 || !canConfirmFinal}
                className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--brand)", color: "white" }}
              >
                {saving ? "Guardando…" : "Confirmar y guardar"}
              </button>
              <button onClick={() => setStep("editing")} disabled={saving} className="text-xs" style={{ color: "var(--ink-muted)" }}>
                Volver a editar
              </button>
            </div>
          </div>
        )}

        <div className="mt-auto pt-4">
          <a
            href={`https://app.gohighlevel.com/v2/location/${LOCATION_ID}/opportunities/list`}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline"
            style={{ color: "var(--ink-muted)" }}
          >
            Ver pipeline completo en GHL
          </a>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs" style={{ color: "var(--ink-secondary)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
