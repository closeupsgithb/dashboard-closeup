import { StatusBadge } from "@/components/StatusBadge";

export type DataIssue = { cliente: string; raw: string; periodo?: string };

export function DataIssuesAlert({ data }: { data: DataIssue[] }) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--status-critical)", background: "var(--surface)" }}>
      <StatusBadge variant="critical" label="Importes sin interpretar — revisar en el Sheet" />
      <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--ink-secondary)" }}>
        {data.map((issue, i) => (
          <li key={`${issue.cliente}-${i}`}>
            <span className="font-medium" style={{ color: "var(--ink)" }}>
              {issue.cliente}
            </span>
            {issue.periodo ? ` (${issue.periodo})` : ""}: &quot;{issue.raw}&quot;
          </li>
        ))}
      </ul>
    </div>
  );
}
