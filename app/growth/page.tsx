"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { GrowthMetricsCompact, type PeriodFunnel } from "@/components/growth/GrowthMetricsCompact";
import { GrowthAgenda, type AgendaRow } from "@/components/growth/GrowthAgenda";
import { GrowthOrphanedMeetings, type OrphanedMeetingRow } from "@/components/growth/GrowthOrphanedMeetings";
import { GrowthFollowUps, type FollowUpBuckets, type FollowUpRow } from "@/components/growth/GrowthFollowUps";
import { GrowthLeadsSecondary, type LeadsFunnel, type LeadRow } from "@/components/growth/GrowthLeadsSecondary";
import { GrowthCloserComparison, type PeriodCloserRow } from "@/components/growth/GrowthCloserComparison";
import { GrowthMeetingsBreakdown, type StageBreakdown, type CallNumberRow } from "@/components/growth/GrowthMeetingsBreakdown";
import { GrowthEditPanel, type CloserOption, type PanelOpportunity } from "@/components/growth/GrowthEditPanel";
import { GrowthClosersConfig, type CloserRow } from "@/components/growth/GrowthClosersConfig";
import { UserMenu } from "@/components/growth/UserMenu";

type PeriodoInfo = {
  tipo: "hoy" | "semana" | "mes";
  ref: string;
  label: string;
  start: string;
  end: string;
  prevRef: string;
  nextRef: string;
};

type ApiResponse = {
  generatedAt: string;
  periodo: PeriodoInfo;
  closerFilter: string;
  closers: CloserRow[];
  metricasPeriodo: PeriodFunnel;
  closerBreakdown: PeriodCloserRow[];
  desglosePorEtapa: StageBreakdown;
  desglosePorLlamada: CallNumberRow[];
  pendientesGlobalCount: number;
  reunionesSinResolver: OrphanedMeetingRow[];
  inconsistenciasGanadoSinPagado: { opportunityId: string; contacto: string | null; closer: string; estadoActual: string }[];
  agenda: AgendaRow[];
  agendaPorDia: { date: string; rows: AgendaRow[] }[] | null;
  followUps: FollowUpBuckets;
  leadsLabel: string;
  leadsFunnel: LeadsFunnel;
  leadsRows: LeadRow[];
  leadsSinContactar: number;
  tiempoMedioPrimerContactoMs: number | null;
  lastSyncedAt: string | null;
  syncError: string | null;
};

type ApiError = { error: "MISSING_CREDENTIALS" | "UPSTREAM_ERROR"; detail?: string };

const REFRESH_MS = 5 * 60 * 1000;

export default function GrowthPage() {
  const [tipo, setTipo] = useState<"hoy" | "semana" | "mes">("hoy");
  const [ref, setRef] = useState<string | null>(null);
  const [closerFilter, setCloserFilter] = useState("all");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [showClosersConfig, setShowClosersConfig] = useState(false);
  const [editing, setEditing] = useState<PanelOpportunity | null>(null);

  const load = useCallback(async (t: string, r: string | null, c: string) => {
    try {
      const params = new URLSearchParams();
      params.set("periodo", t);
      if (r) params.set("ref", r);
      params.set("closer", c);
      const res = await fetch(`/api/growth/metrics?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json as ApiError);
        return;
      }
      setError(null);
      setData(json as ApiResponse);
    } catch {
      setError({ error: "UPSTREAM_ERROR" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mismo patrón ya aceptado en app/page.tsx
    load(tipo, ref, closerFilter);
    const interval = setInterval(() => load(tipo, ref, closerFilter), REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, ref, closerFilter]);

  async function actualizar() {
    setReconciling(true);
    try {
      await fetch("/api/growth/reconcile", { method: "POST" });
      await load(tipo, ref, closerFilter);
    } finally {
      setReconciling(false);
    }
  }

  function volverAHoy() {
    setTipo("hoy");
    setRef(null);
  }

  function shift(delta: "prev" | "next") {
    if (!data) return;
    setRef(delta === "prev" ? data.periodo.prevRef : data.periodo.nextRef);
  }

  function cambiarTipo(nuevo: "hoy" | "semana" | "mes") {
    setTipo(nuevo);
    setRef(null);
  }

  if (error?.error === "MISSING_CREDENTIALS") {
    return (
      <Centered>
        Faltan credenciales configuradas en <code>.env.local</code>. Añade GHL_PRIVATE_TOKEN y DATABASE_URL.
      </Centered>
    );
  }
  if (error) return <Centered>No se pudo cargar el dashboard comercial. {error.detail ?? ""}</Centered>;
  if (!data) return <Centered>Cargando…</Centered>;

  const activeClosers: CloserOption[] = data.closers.filter((c) => c.active).map((c) => ({ id: c.id, displayName: c.displayName, active: c.active }));

  function openPanelFromAgenda(row: AgendaRow) {
    setEditing({
      opportunityId: row.opportunityId,
      appointmentId: row.appointmentId,
      contactName: row.contactName,
      companyName: row.companyName,
      closerId: row.closerId,
      proximoPaso: row.proximoPaso,
      stageId: row.stageId,
      stageName: row.stageName,
      status: row.status,
      asistioReunionRaw: row.asistioReunionRaw,
      activeAttendance: row.attendance,
      scheduledAt: row.scheduledAt,
    });
  }

  // Auditoría 2026-09-09, Paso 2: esta reunión ya no es la activa de su
  // oportunidad (is_active=false), así que proximoPaso/asistioReunionRaw del
  // día de hoy no describen esta cita concreta — se pasan null a propósito
  // en vez de un dato que podría venir de una reunión posterior. activeAttendance
  // se fija en "pendiente" porque es exactamente el filtro que la trajo aquí.
  function openPanelFromOrphan(row: OrphanedMeetingRow) {
    setEditing({
      opportunityId: row.opportunityId,
      appointmentId: row.appointmentId,
      contactName: row.contactName,
      companyName: row.companyName,
      closerId: row.closerId,
      proximoPaso: null,
      stageId: row.stageId,
      stageName: row.stageName,
      status: row.status,
      asistioReunionRaw: null,
      activeAttendance: "pendiente",
      scheduledAt: row.scheduledAt,
    });
  }

  function openPanelFromFollowUp(row: FollowUpRow) {
    setEditing({
      opportunityId: row.opportunityId,
      contactName: row.contactName,
      companyName: row.companyName,
      closerId: row.closerId,
      proximoPaso: row.proximoPaso,
      stageId: row.stageId,
      stageName: row.stageName,
      status: row.status,
      asistioReunionRaw: row.asistioReunionRaw,
      activeAttendance: row.activeAttendance,
      scheduledAt: null,
      followUpDueAt: row.dueAt,
      followUpTitle: row.accion,
      followUpTaskId: row.taskId,
    });
  }

  function openPanelFromLead(row: LeadRow) {
    setEditing({
      opportunityId: row.opportunityId,
      contactName: row.contacto,
      companyName: row.empresa,
      closerId: row.responsableId,
      proximoPaso: row.proximoPasoRaw,
      stageId: row.stageId,
      stageName: row.stageName,
      status: row.status,
      asistioReunionRaw: row.asistioReunionRaw,
      activeAttendance: row.activeAttendance,
      scheduledAt: null,
      followUpDueAt: row.followUpDueAt,
      followUpTitle: row.followUpTitle,
      followUpTaskId: row.followUpTaskId,
    });
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold leading-tight" style={{ color: "var(--ink)" }}>
              Dashboard comercial
            </h1>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
              Pipeline GROWTH · GoHighLevel + Neon
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--ink-muted)" }}>
          <span>
            {data.lastSyncedAt ? `Sincronizado ${new Date(data.lastSyncedAt).toLocaleTimeString("es-ES")}` : "Sin sincronizar"}
            {data.syncError && <span style={{ color: "var(--status-critical)" }}> · error de sync</span>}
          </span>
          <button
            onClick={actualizar}
            disabled={reconciling}
            className="rounded-md border px-3 py-1.5 font-medium transition-shadow"
            style={{ borderColor: "var(--border)", color: "var(--ink)", background: "var(--surface)", boxShadow: "var(--card-shadow)" }}
          >
            {reconciling ? "Actualizando…" : "Actualizar"}
          </button>
          <UserMenu />
        </div>
      </header>

      <div
        className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3.5"
        style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--card-shadow)" }}
      >
        <select
          value={closerFilter}
          onChange={(e) => setCloserFilter(e.target.value)}
          className="rounded-md border px-2.5 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
        >
          <option value="all">Todos los closers</option>
          <option value="unassigned">Sin asignar</option>
          {data.closers.filter((c) => c.active).map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>

        <div className="flex rounded-md border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          {(["hoy", "semana", "mes"] as const).map((t) => (
            <button
              key={t}
              onClick={() => cambiarTipo(t)}
              className="px-3.5 py-1.5 text-xs font-medium capitalize transition-colors"
              style={{
                background: tipo === t ? "var(--brand)" : "transparent",
                color: tipo === t ? "white" : "var(--ink-secondary)",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => shift("prev")}
            className="flex h-6 w-6 items-center justify-center rounded-md border text-sm"
            style={{ borderColor: "var(--border)", color: "var(--ink-secondary)" }}
          >
            ←
          </button>
          <span className="text-sm font-medium tabular" style={{ color: "var(--ink)" }}>
            {data.periodo.label}
          </span>
          <button
            onClick={() => shift("next")}
            className="flex h-6 w-6 items-center justify-center rounded-md border text-sm"
            style={{ borderColor: "var(--border)", color: "var(--ink-secondary)" }}
          >
            →
          </button>
        </div>

        {tipo !== "hoy" && (
          <button onClick={volverAHoy} className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
            Volver a hoy
          </button>
        )}

        <Link href="/growth/documentacion" className="ml-auto text-xs underline" style={{ color: "var(--ink-secondary)" }}>
          Centro comercial
        </Link>

        <button onClick={() => setShowClosersConfig((v) => !v)} className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
          Gestión de closers
        </button>
      </div>

      {data.pendientesGlobalCount > 0 && (
        <div
          className="mb-4 rounded-xl border px-4 py-2.5 text-sm font-medium"
          style={{
            borderColor: "var(--status-critical)",
            background: "rgba(208,59,59,0.06)",
            color: "var(--status-critical)",
            boxShadow: "var(--card-shadow)",
          }}
        >
          {data.pendientesGlobalCount} reunión{data.pendientesGlobalCount === 1 ? "" : "es"} pendiente{data.pendientesGlobalCount === 1 ? "" : "s"} de actualizar
          (de todos los periodos y closers)
        </div>
      )}

      {data.inconsistenciasGanadoSinPagado.length > 0 && (
        <div
          className="mb-4 rounded-xl border px-4 py-2.5 text-sm"
          style={{ borderColor: "var(--status-critical)", background: "rgba(208,59,59,0.06)", color: "var(--ink)", boxShadow: "var(--card-shadow)" }}
        >
          <span className="font-medium" style={{ color: "var(--status-critical)" }}>
            {data.inconsistenciasGanadoSinPagado.length} oportunidad{data.inconsistenciasGanadoSinPagado.length === 1 ? "" : "es"} marcada
            {data.inconsistenciasGanadoSinPagado.length === 1 ? "" : "s"} &quot;Ganado&quot; sin estar en la fase Pagado
          </span>
          <span> — no se cuentan como venta hasta revisar: </span>
          {data.inconsistenciasGanadoSinPagado.map((i, idx) => (
            <span key={i.opportunityId}>
              {idx > 0 && ", "}
              {i.contacto} ({i.closer})
            </span>
          ))}
        </div>
      )}

      {showClosersConfig && (
        <section className="growth-section mb-7">
          <h2 className="growth-section-title mb-4">
            <span className="bar" />
            Equipo comercial
          </h2>
          <GrowthClosersConfig closers={data.closers} onSaved={() => load(tipo, ref, closerFilter)} />
        </section>
      )}

      <GrowthMetricsCompact funnel={data.metricasPeriodo} />

      <section className="growth-section mb-7">
        <h2 className="growth-section-title mb-4">
          <span className="bar" />
          Agenda
        </h2>
        <GrowthAgenda rows={data.agenda} groupedByDay={data.agendaPorDia} onEdit={openPanelFromAgenda} />
      </section>

      <section className="growth-section mb-7">
        <h2 className="growth-section-title mb-4">
          <span className="bar" />
          Reuniones sin resolver
          {data.reunionesSinResolver.length > 0 && (
            <span
              className="ml-2 rounded-full px-2 py-0.5 text-xs font-medium normal-case tracking-normal"
              style={{ background: "rgba(208,59,59,0.1)", color: "var(--status-critical)" }}
            >
              {data.reunionesSinResolver.length}
            </span>
          )}
        </h2>
        <GrowthOrphanedMeetings rows={data.reunionesSinResolver} onEdit={openPanelFromOrphan} />
      </section>

      <section className="growth-section mb-7">
        <h2 className="growth-section-title mb-4">
          <span className="bar" />
          Follow-ups
        </h2>
        <GrowthFollowUps buckets={data.followUps} periodoLabel={data.periodo.label} onEdit={openPanelFromFollowUp} />
      </section>

      {closerFilter === "all" && (
        <section className="growth-section mb-7">
          <h2 className="growth-section-title mb-4">
            <span className="bar" />
            Comparativa por closer — {data.periodo.label}
          </h2>
          <GrowthCloserComparison data={data.closerBreakdown} />
        </section>
      )}

      <section className="growth-section mb-7">
        <h2 className="growth-section-title mb-4">
          <span className="bar" />
          Desglose — {data.periodo.label}
        </h2>
        <GrowthMeetingsBreakdown stage={data.desglosePorEtapa} byCall={data.desglosePorLlamada} />
      </section>

      <section className="growth-section mb-7">
        <h2 className="growth-section-title mb-4">
          <span className="bar" />
          Leads sin reunión — {data.leadsLabel} ({data.leadsRows.length})
          {data.leadsSinContactar > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium normal-case tracking-normal"
              style={{ background: "rgba(208,59,59,0.1)", color: "var(--status-critical)" }}
            >
              {data.leadsSinContactar} sin contactar
            </span>
          )}
        </h2>
        <GrowthLeadsSecondary
          funnel={data.leadsFunnel}
          rows={data.leadsRows}
          leadsSinContactar={data.leadsSinContactar}
          tiempoMedioPrimerContactoMs={data.tiempoMedioPrimerContactoMs}
          onEdit={openPanelFromLead}
        />
      </section>

      {editing && (
        <GrowthEditPanel
          opportunity={editing}
          closers={activeClosers}
          onClose={() => setEditing(null)}
          onSaved={() => load(tipo, ref, closerFilter)}
        />
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center text-sm" style={{ color: "var(--ink-secondary)" }}>
      {children}
    </main>
  );
}
