"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { StatTile } from "@/components/StatTile";
import { GrowthSummaryReadOnly } from "@/components/GrowthSummaryReadOnly";
import { MonthlyIncomeChart, type IncomePoint } from "@/components/MonthlyIncomeChart";
import { OnboardingStageBar, type StageCount } from "@/components/OnboardingStageBar";
import { PendingFollowUpTable, type PendingRow } from "@/components/PendingFollowUpTable";
import { PausedClientsTable, type PausedRow } from "@/components/PausedClientsTable";
import { DataIssuesAlert, type DataIssue } from "@/components/DataIssuesAlert";
import { EditableClientTable, type PeriodRoster } from "@/components/EditableClientTable";
import { RoasTable, type RoasRow } from "@/components/RoasTable";
import { formatEUR, formatMonths, formatPercent, formatRatio } from "@/lib/format";

type CacResult = {
  periodo: string;
  mes: string | null;
  gastoAds: number | null;
  clientesNuevos: number | null;
  cac: number | null;
  motivo: string | null;
};

type ChurnResult = {
  periodo: string;
  clientesMesAnterior: number;
  clientesBaja: string[];
  churnRate: number | null;
  motivo: string | null;
};

type LtvResult = {
  arpuMedio: number | null;
  vidaMediaMeses: number | null;
  ltv: number | null;
  muestraClientesFinalizados: number;
  motivo: string | null;
};

type LtvCacResult = { ratio: number | null; motivo: string | null };

type IncomePointWithIssues = IncomePoint & { entradasNoInterpretables: { cliente: string; raw: string }[] };

type ApiResponse = {
  generatedAt: string;
  ingresoMensualConfirmado: IncomePointWithIssues[];
  cac: CacResult[];
  churn: ChurnResult[];
  ltv: LtvResult;
  ltvCacRatio: LtvCacResult;
  roas: RoasRow;
  seguimientoPendientes: PendingRow[];
  estadoOnboarding: StageCount[];
  clientesEnPausa: PausedRow[];
  periodoEditable: string | null;
  rostersPorPeriodo: PeriodRoster[];
};

type ApiError = { error: "MISSING_CREDENTIALS" | "UPSTREAM_ERROR"; detail?: string };

const REFRESH_MS = 5 * 60 * 1000;

function lastReportedIndex(data: ApiResponse["ingresoMensualConfirmado"]): number {
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].reportado) return i;
  }
  return data.length - 1;
}

export default function Home() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Selector de mes de las tarjetas superiores — independiente del selector
  // de "Editar ingresos por mes" (ese ya tenía el suyo). null = seguir el
  // último mes reportado automáticamente; con navegación manual se fija un
  // índice concreto sobre ingresoMensualConfirmado hasta volver a "Ahora".
  const [statsIdx, setStatsIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
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
    document.title = "Dashboard Financiero — Closeup Marketing";
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(interval);
    };
  }, [load]);

  if (error?.error === "MISSING_CREDENTIALS") {
    return (
      <Centered>
        Faltan credenciales configuradas en <code>.env.local</code>. Añade
        GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY, GHL_PRIVATE_TOKEN y
        META_ACCESS_TOKEN.
      </Centered>
    );
  }

  if (error) {
    return <Centered>No se pudo cargar el dashboard. {error.detail ?? ""}</Centered>;
  }

  if (!data) {
    return <Centered>Cargando…</Centered>;
  }

  const autoIdx = lastReportedIndex(data.ingresoMensualConfirmado);
  const idx = statsIdx !== null && statsIdx >= 0 && statsIdx < data.ingresoMensualConfirmado.length ? statsIdx : autoIdx;
  const ultimoIngreso = data.ingresoMensualConfirmado[idx];
  const ultimoCac = data.cac[idx];
  const ultimoChurn = data.churn[idx];
  const roas = data.roas;

  const dataIssues: DataIssue[] = data.ingresoMensualConfirmado.flatMap((p) =>
    p.entradasNoInterpretables.map((e) => ({ cliente: e.cliente, raw: e.raw, periodo: p.periodo }))
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>
              Dashboard Financiero — Closeup Marketing
            </h1>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Actualizado {new Date(data.generatedAt).toLocaleString("es-ES")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/growth" className="underline" style={{ color: "var(--ink-secondary)" }}>
            Ir al dashboard comercial
          </Link>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="underline"
            style={{ color: "var(--ink-secondary)" }}
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      {dataIssues.length > 0 && (
        <div className="mb-6">
          <DataIssuesAlert data={dataIssues} />
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setStatsIdx(Math.max(0, idx - 1))}
          disabled={idx <= 0}
          className="text-sm disabled:opacity-30"
          style={{ color: "var(--ink-secondary)" }}
        >
          ←
        </button>
        <span className="text-sm font-medium tabular" style={{ color: "var(--ink)" }}>
          {ultimoIngreso?.periodo ?? "—"}
        </span>
        <button
          onClick={() => setStatsIdx(Math.min(data.ingresoMensualConfirmado.length - 1, idx + 1))}
          disabled={idx >= data.ingresoMensualConfirmado.length - 1}
          className="text-sm disabled:opacity-30"
          style={{ color: "var(--ink-secondary)" }}
        >
          →
        </button>
        {idx !== autoIdx && (
          <button onClick={() => setStatsIdx(null)} className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
            Volver al mes actual
          </button>
        )}
      </div>

      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label={`Ingreso confirmado — ${ultimoIngreso?.periodo ?? ""}`}
          value={formatEUR(ultimoIngreso?.ingreso ?? null)}
          accent
        />
        <StatTile
          label="CAC"
          value={ultimoCac?.cac !== null && ultimoCac?.cac !== undefined ? formatEUR(ultimoCac.cac) : "N/D"}
          caption={ultimoCac?.motivo ?? undefined}
        />
        <StatTile
          label="LTV"
          value={data.ltv.ltv !== null ? formatEUR(data.ltv.ltv) : "N/D"}
          caption={
            data.ltv.motivo ??
            (data.ltv.vidaMediaMeses !== null
              ? `ARPU ${formatEUR(data.ltv.arpuMedio)} × ${formatMonths(data.ltv.vidaMediaMeses)}`
              : undefined)
          }
        />
        <StatTile
          label="Churn mensual"
          value={ultimoChurn?.churnRate !== null && ultimoChurn?.churnRate !== undefined ? formatPercent(ultimoChurn.churnRate) : "N/D"}
          caption={ultimoChurn?.motivo ?? undefined}
        />
      </section>

      <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-2">
        <StatTile
          label={`ROAS CBO_LEADS_REFOR — acumulado${roas.ultimoPeriodo ? ` hasta ${roas.ultimoPeriodo}` : ""}`}
          value={formatRatio(roas.roas)}
          caption={roas.motivo ?? undefined}
        />
        <StatTile
          label="Ratio LTV : CAC"
          value={formatRatio(data.ltvCacRatio.ratio)}
          caption={data.ltvCacRatio.motivo ?? undefined}
        />
      </section>

      <GrowthSummaryReadOnly />

      <section className="mb-8 rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
          Ingreso mensual confirmado
        </h2>
        <MonthlyIncomeChart data={data.ingresoMensualConfirmado} />
      </section>

      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
            Seguimiento de pendientes de cobro
          </h2>
          <PendingFollowUpTable data={data.seguimientoPendientes} onSaved={load} />
        </div>

        <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
            Clientes en pausa
          </h2>
          <PausedClientsTable data={data.clientesEnPausa} onSaved={load} />
        </div>
      </section>

      <section className="mb-8 rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
          Clientes por fase de Onboarding
        </h2>
        <OnboardingStageBar data={data.estadoOnboarding} />
      </section>

      {data.rostersPorPeriodo.length > 0 && (
        <section className="mb-8 rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
            Editar ingresos por mes
          </h2>
          <EditableClientTable rostersPorPeriodo={data.rostersPorPeriodo} defaultPeriodo={data.periodoEditable} onSaved={load} />
        </section>
      )}

      <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
          ROAS — detalle por cliente
        </h2>
        <RoasTable data={data.roas} onSaved={load} />
      </section>
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
