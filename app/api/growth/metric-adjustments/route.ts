import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireRole";
import { query, MissingCredentialsError as DbMissingCredentials } from "@/lib/growth/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Corrección histórica auditada (Fase 21/22 del brief de reconciliación de
// Daniel, 2026-08-28): cuando el histórico real conocido no se puede
// reconstruir con identidad exacta (reunión, contacto, fecha) desde GHL/Neon,
// se registra aquí un ajuste explícito en vez de fabricar reuniones o
// contactos falsos. Solo admin — no aparece en ningún sitio para "commercial"
// (proxy.ts ya deja pasar cualquier usuario autenticado a /api/growth/*, así
// que este endpoint concreto necesita su propia barrera).

export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof Response) return session;
  try {
    const rows = await query`select id, metric_type, period, delta, reason, created_by, created_at from growth_metric_adjustments order by created_at desc`;
    return NextResponse.json({ adjustments: rows });
  } catch (err) {
    if (err instanceof DbMissingCredentials) return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    return NextResponse.json({ error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof Response) return session;

  let body: { metricType?: string; period?: string; delta?: number; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  if (body.metricType !== "attended" && body.metricType !== "no_show") {
    return NextResponse.json({ error: "INVALID_VALUE", detail: "metricType debe ser attended o no_show" }, { status: 400 });
  }
  if (!body.period || !/^(\d{4}-\d{2}|all)$/.test(body.period)) {
    return NextResponse.json({ error: "INVALID_VALUE", detail: "period debe ser YYYY-MM o 'all'" }, { status: 400 });
  }
  if (!Number.isInteger(body.delta) || body.delta === 0) {
    return NextResponse.json({ error: "INVALID_VALUE", detail: "delta debe ser un entero distinto de cero" }, { status: 400 });
  }
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "INVALID_VALUE", detail: "reason es obligatorio — no se aplican ajustes sin motivo documentado" }, { status: 400 });
  }

  try {
    await query`
      insert into growth_metric_adjustments (metric_type, period, delta, reason, created_by)
      values (${body.metricType}, ${body.period}, ${body.delta}, ${body.reason.trim()}, ${session.email})
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DbMissingCredentials) return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    return NextResponse.json({ error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
