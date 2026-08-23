"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPercent } from "@/lib/format";

type Summary = {
  periodo: { label: string; ref: string; prevRef: string; nextRef: string };
  leadsFunnel: { leadsCualificados: number };
  metricasPeriodo: {
    reunionesAgendadas: number;
    reunionesRealizadas: number;
    ventasPagadas: number;
    showRate: number | null;
    closeRate: number | null;
  };
};

// Resumen de solo lectura del pipeline GROWTH, para no duplicar la agenda ni
// las acciones operativas del dashboard comercial aquí — solo las cifras
// clave, con enlace a la herramienta completa. Tiene su PROPIO selector de
// mes (formato calendario YYYY-MM, vía lib/growth/period.ts) independiente
// del selector de "Editar ingresos por mes" del dashboard financiero: ese
// usa los nombres de pestaña del Sheet (p.ej. "AGOSTO"), un sistema de
// periodos distinto al de GROWTH, que no se puede mapear 1:1 sin arriesgarse
// a mostrar el mes equivocado si el año fiscal del Sheet no coincide con el
// calendario — por eso no comparten selector.
export function GrowthSummaryReadOnly() {
  const [ref, setRef] = useState<string | null>(null);
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ periodo: "mes" });
    if (ref) params.set("ref", ref);
    fetch(`/api/growth/metrics?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [ref]);

  if (!data) return null;

  const items = [
    { label: "Leads", value: String(data.leadsFunnel.leadsCualificados) },
    { label: "Agendadas", value: String(data.metricasPeriodo.reunionesAgendadas) },
    { label: "Asistencias", value: String(data.metricasPeriodo.reunionesRealizadas) },
    { label: "Show rate", value: formatPercent(data.metricasPeriodo.showRate) },
    { label: "Ventas", value: String(data.metricasPeriodo.ventasPagadas) },
    { label: "Close rate", value: formatPercent(data.metricasPeriodo.closeRate) },
  ];

  return (
    <section className="mb-8 rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium" style={{ color: "var(--ink-secondary)" }}>
            Resumen comercial GROWTH — {data.periodo.label}
          </h2>
          <button onClick={() => setRef(data.periodo.prevRef)} className="text-xs" style={{ color: "var(--ink-secondary)" }}>
            ←
          </button>
          <button onClick={() => setRef(data.periodo.nextRef)} className="text-xs" style={{ color: "var(--ink-secondary)" }}>
            →
          </button>
          {ref !== null && (
            <button onClick={() => setRef(null)} className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
              Mes actual
            </button>
          )}
        </div>
        <Link href="/growth" className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
          Ir al dashboard comercial
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-xl font-semibold tabular" style={{ color: "var(--ink)" }}>
              {it.value}
            </div>
            <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {it.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
