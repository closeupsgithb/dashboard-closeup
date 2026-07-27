type StatTileProps = {
  label: string;
  value: string;
  caption?: string;
  accent?: boolean;
};

export function StatTile({ label, value, caption, accent }: StatTileProps) {
  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="text-sm" style={{ color: "var(--ink-secondary)" }}>
        {label}
      </div>
      <div
        className="mt-2 text-3xl font-semibold"
        style={{ color: accent ? "var(--brand)" : "var(--ink)" }}
      >
        {value}
      </div>
      {caption && (
        <div className="mt-2 text-xs leading-snug" style={{ color: "var(--ink-muted)" }}>
          {caption}
        </div>
      )}
    </div>
  );
}
