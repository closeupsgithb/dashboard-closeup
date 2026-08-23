import { query } from "@/lib/growth/db";

export type Closer = {
  id: string;
  displayName: string;
  active: boolean;
  color: string | null;
  sortOrder: number;
};

// Semilla inicial: los 3 closers ya identificados en el pipeline antiguo
// (lib/ghl.ts CLOSER_NAMES), confirmados por Daniel el 2026-07-29. Solo se
// inserta si la tabla está vacía — una vez editada desde el dashboard, la
// tabla manda.
const SEED_CLOSERS: Omit<Closer, "active">[] = [
  { id: "Nalb9lAN8S9Gzr9RLTcI", displayName: "Daniel von Zedlitz", color: "#2563EB", sortOrder: 0 },
  { id: "VU25EtZCt8PuhTZnfA1v", displayName: "Alejandro", color: "#059669", sortOrder: 1 },
  { id: "3EESUj1Gk1ikcfHr4Owf", displayName: "Iván", color: "#D97706", sortOrder: 2 },
];

export async function listClosers(includeInactive = true): Promise<Closer[]> {
  const existing = await query<{
    id: string;
    display_name: string;
    active: boolean;
    color: string | null;
    sort_order: number;
  }>`select id, display_name, active, color, sort_order from growth_closers order by sort_order asc`;

  if (existing.length === 0) {
    for (const c of SEED_CLOSERS) {
      await query`insert into growth_closers (id, display_name, color, sort_order)
        values (${c.id}, ${c.displayName}, ${c.color}, ${c.sortOrder})
        on conflict (id) do nothing`;
    }
    return SEED_CLOSERS.map((c) => ({ ...c, active: true }));
  }

  const rows = existing.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    active: r.active,
    color: r.color,
    sortOrder: r.sort_order,
  }));
  return includeInactive ? rows : rows.filter((r) => r.active);
}

// Cambiar el nombre visible o el estado activo/inactivo NUNCA toca el id
// (ghl_user_id) — así no se puede duplicar histórico ni romper asignaciones
// existentes, que apuntan siempre al id, nunca al nombre.
export async function upsertCloser(input: {
  id: string;
  displayName: string;
  active: boolean;
  color: string | null;
  sortOrder: number;
}): Promise<void> {
  await query`
    insert into growth_closers (id, display_name, active, color, sort_order, updated_at)
    values (${input.id}, ${input.displayName}, ${input.active}, ${input.color}, ${input.sortOrder}, now())
    on conflict (id) do update set
      display_name = excluded.display_name,
      active = excluded.active,
      color = excluded.color,
      sort_order = excluded.sort_order,
      updated_at = now()
  `;
}

export async function resolveCloserDisplayName(closerId: string | null, closers: Closer[]): Promise<string> {
  if (!closerId) return "Sin asignar";
  return closers.find((c) => c.id === closerId)?.displayName ?? "Otros closers";
}
