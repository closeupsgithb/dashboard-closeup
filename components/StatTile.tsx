type StatTileProps = {
  label: string;
  value: string;
  caption?: string;
  accent?: boolean;
};

export function StatTile({ label, value, caption, accent }: StatTileProps) {
  return (
    <div
      className="flex h-full flex-col justify-between rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--surface)", minHeight: 116 }}
    >
      <div className="text-sm leading-snug" style={{ color: "var(--ink-secondary)" }}>
        {label}
      </div>
      <div className="my-1 text-4xl font-semibold tabular tracking-tight md:text-[2.75rem]" style={{ color: accent ? "var(--brand)" : "var(--ink)" }}>
        {value}
      </div>
      <div className="text-xs leading-snug" style={{ color: "var(--ink-muted)", minHeight: caption ? undefined : 0 }}>
        {caption ?? ""}
      </div>
    </div>
  );
}
