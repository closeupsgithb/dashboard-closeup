type Variant = "good" | "warning" | "muted" | "critical";

const VARIANT_COLOR: Record<Variant, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  muted: "var(--ink-muted)",
  critical: "var(--status-critical)",
};

// Un icono simple por variante — el color nunca va solo, siempre acompañado
// de forma (icono) y texto (label), por la regla de accesibilidad del skill.
function Icon({ variant }: { variant: Variant }) {
  const color = VARIANT_COLOR[variant];
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2.5 };
  switch (variant) {
    case "good":
      return (
        <svg {...common}>
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="0.5" fill={color} />
        </svg>
      );
    case "critical":
      return (
        <svg {...common}>
          <path d="M12 3l10 18H2L12 3z" strokeLinejoin="round" />
          <path d="M12 10v4" strokeLinecap="round" />
          <circle cx="12" cy="17" r="0.5" fill={color} />
        </svg>
      );
    case "muted":
      return (
        <svg {...common}>
          <rect x="6" y="5" width="4" height="14" rx="1" fill={color} stroke="none" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill={color} stroke="none" />
        </svg>
      );
  }
}

export function StatusBadge({ variant, label }: { variant: Variant; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--ink)" }}>
      <Icon variant={variant} />
      {label}
    </span>
  );
}
