"use client";

import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { StatTile } from "@/components/StatTile";
import { MonthlyIncomeChart, type IncomePoint } from "@/components/MonthlyIncomeChart";
import { OnboardingStageBar, type StageCount } from "@/components/OnboardingStageBar";
import { PendingFollowUpTable, type PendingRow } from "@/components/PendingFollowUpTable";
import { PausedClientsTable, type PausedRow } from "@/components/PausedClientsTable";
import { DataIssuesAlert, type DataIssue } from "@/components/DataIssuesAlert";
import { EditableClientTable, type RosterRow } from "@/components/EditableClientTable";
import { formatEUR, formatMonths, formatPercent } from "@/lib/format";

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

type IncomePointWithIssues = IncomePoint & { entradasNoInterpretables: { cliente: string; raw: string }[] };

type ApiResponse = {
  generatedAt: string;
  ingresoMensualConfirmado: IncomePointWithIssues[];
  cac: CacResult[];
  churn: ChurnResult[];
  ltv: LtvResult;
  seguimientoPendientes: PendingRow[];
  estadoOnboarding: StageCount[];
  clientesEnPausa: PausedRow[];
  periodoEditable: string | null;
  rosterEditable: RosterRow[];
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

  const idx = lastReportedIndex(data.ingresoMensualConfirmado);
  const ultimoIngreso = data.ingresoMensualConfirmado[idx];
  const ultimoCac = data.cac[idx];
  const ultimoChurn = data.churn[idx];

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
      </header>

      {dataIssues.length > 0 && (
        <div className="mb-6">
          <DataIssuesAlert data={dataIssues} />
        </div>
      )}

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
          <PendingFollowUpTable data={data.seguimientoPendientes} />
        </div>

        <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
            Clientes en pausa
          </h2>
          <PausedClientsTable data={data.clientesEnPausa} />
        </div>
      </section>

      <section className="mb-8 rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
          Clientes por fase de Onboarding
        </h2>
        <OnboardingStageBar data={data.estadoOnboarding} />
      </section>

      {data.periodoEditable && (
        <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="mb-4 text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
            Editar {data.periodoEditable}
          </h2>
          <EditableClientTable periodo={data.periodoEditable} roster={data.rosterEditable} onSaved={load} />
        </section>
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
