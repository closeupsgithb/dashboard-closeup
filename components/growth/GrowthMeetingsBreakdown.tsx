import { formatPercent } from "@/lib/format";

export type StageBreakdown = {
  agendada: number;
  confirmada: number;
  asistida: number;
  noShow: number;
};

export type CallNumberRow = {
  meetingNumber: number;
  label: string;
  reunionesAgendadas: number;
  reunionesRealizadas: number;
  noShows: number;
  pendientes: number;
  showRate: number | null;
};

function StageRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3.5 py-2" style={{ borderTop: "1px solid var(--gridline)" }}>
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
      <span className="w-[7.5rem] flex-shrink-0 text-[13.5px]" style={{ color: "var(--ink)" }}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded" style={{ background: "var(--gridline)" }}>
        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-8 flex-shrink-0 text-right text-[13.5px] font-semibold tabular" style={{ color: "var(--ink)" }}>
        {count}
      </span>
    </div>
  );
}

// Auditoría 2026-09-09/11, Paso 3: desglose adicional sobre las mismas
// reuniones del periodo que ya usa la tarjeta "Reuniones" — no la sustituye.
// 4 cajones sin solape (cada reunión cae en uno solo): Asistida/No show
// según attendance ya resuelto (aunque el closer no haya movido la etapa
// después); Agendada/Confirmada solo para las que siguen pendientes, según
// la etapa ACTUAL en GHL. Las pendientes de una oportunidad ya no abierta
// (eliminado_en_ghl/lost/abandoned) no entran en ningún cajón — se siguen
// guardando en Neon, pero no se muestran aquí (pedido explícito, 2026-09-11).
export function GrowthMeetingsBreakdown({ stage, byCall }: { stage: StageBreakdown; byCall: CallNumberRow[] }) {
  const total = stage.agendada + stage.confirmada + stage.asistida + stage.noShow;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--card-shadow)" }}>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-secondary)" }}>
          Por etapa
        </div>
        {total === 0 ? (
          <p className="py-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            Sin reuniones en este periodo.
          </p>
        ) : (
          <div>
            <StageRow label="Asistida" count={stage.asistida} total={total} color="var(--status-good)" />
            <StageRow label="No show" count={stage.noShow} total={total} color="var(--status-critical)" />
            <StageRow label="Confirmada" count={stage.confirmada} total={total} color="var(--brand)" />
            <StageRow label="Agendada" count={stage.agendada} total={total} color="var(--ink-muted)" />
          </div>
        )}
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--card-shadow)" }}>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-secondary)" }}>
          Por número de llamada
        </div>
        {byCall.length === 0 ? (
          <p className="py-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            Sin reuniones en este periodo.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left" style={{ color: "var(--ink-muted)" }}>
                <th className="pb-1.5 font-medium">Reunión</th>
                <th className="pb-1.5 text-right font-medium">Agend.</th>
                <th className="pb-1.5 text-right font-medium">Asist.</th>
                <th className="pb-1.5 text-right font-medium">No show</th>
                <th className="pb-1.5 text-right font-medium">Pend.</th>
                <th className="pb-1.5 text-right font-medium">Show rate</th>
              </tr>
            </thead>
            <tbody>
              {byCall.map((r) => (
                <tr key={r.meetingNumber} style={{ borderTop: "1px solid var(--gridline)" }}>
                  <td className="py-2 font-medium" style={{ color: "var(--ink)" }}>
                    {r.label}
                  </td>
                  <td className="py-2 text-right tabular" style={{ color: "var(--ink)" }}>
                    {r.reunionesAgendadas}
                  </td>
                  <td className="py-2 text-right tabular" style={{ color: "var(--ink)" }}>
                    {r.reunionesRealizadas}
                  </td>
                  <td className="py-2 text-right tabular" style={{ color: "var(--ink)" }}>
                    {r.noShows}
                  </td>
                  <td className="py-2 text-right tabular" style={{ color: "var(--ink-muted)" }}>
                    {r.pendientes}
                  </td>
                  <td className="py-2 text-right tabular font-semibold" style={{ color: "var(--status-good)" }}>
                    {formatPercent(r.showRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
