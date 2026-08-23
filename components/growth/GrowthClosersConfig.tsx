"use client";

import { useState } from "react";

export type CloserRow = { id: string; displayName: string; active: boolean; color: string | null };

export function GrowthClosersConfig({ closers, onSaved }: { closers: CloserRow[]; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function save(closer: CloserRow, patch: Partial<CloserRow>) {
    setSaving(closer.id);
    try {
      await fetch("/api/growth/closers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: closer.id,
          displayName: patch.displayName ?? closer.displayName,
          active: patch.active ?? closer.active,
          color: closer.color,
        }),
      });
      onSaved();
    } finally {
      setSaving(null);
    }
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
          <th className="pb-2 font-normal">Nombre visible</th>
          <th className="pb-2 font-normal">Estado</th>
          <th className="pb-2 font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {closers.map((c) => (
          <tr key={c.id} className="border-t" style={{ borderColor: "var(--gridline)" }}>
            <td className="py-2">
              <input
                defaultValue={c.displayName}
                onChange={(e) => setDrafts((p) => ({ ...p, [c.id]: e.target.value }))}
                className="rounded border px-1.5 py-0.5"
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
              />
            </td>
            <td className="py-2">{c.active ? "Activo" : "Inactivo"}</td>
            <td className="py-2 flex gap-3">
              <button
                disabled={saving === c.id}
                onClick={() => save(c, { displayName: drafts[c.id] ?? c.displayName })}
                className="text-xs font-medium"
                style={{ color: "var(--brand)" }}
              >
                Guardar nombre
              </button>
              <button
                disabled={saving === c.id}
                onClick={() => save(c, { active: !c.active })}
                className="text-xs underline"
                style={{ color: "var(--ink-secondary)" }}
              >
                {c.active ? "Desactivar" : "Activar"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
