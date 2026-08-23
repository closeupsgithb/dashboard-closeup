import { NextResponse } from "next/server";
import { listClosers, upsertCloser } from "@/lib/growth/closers";
import { MissingCredentialsError as DbMissingCredentials } from "@/lib/growth/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const closers = await listClosers();
    return NextResponse.json({ closers });
  } catch (err) {
    if (err instanceof DbMissingCredentials) return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    return NextResponse.json({ error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

type Body = { id?: string; displayName?: string; active?: boolean; color?: string | null; sortOrder?: number };

// Cambiar el nombre visible o desactivar un closer NUNCA toca su id
// (ghl_user_id, identidad permanente) — así no se duplican métricas ni se
// pierden asignaciones históricas. Un closer inactivo conserva sus datos:
// solo deja de aparecer en el selector de "closers activos" por defecto.
export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const { id, displayName, active, color, sortOrder } = body;
  if (!id || !displayName || active === undefined) {
    return NextResponse.json({ error: "INVALID_BODY", detail: "Faltan id, displayName o active" }, { status: 400 });
  }
  try {
    await upsertCloser({ id, displayName, active, color: color ?? null, sortOrder: sortOrder ?? 999 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DbMissingCredentials) return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    return NextResponse.json({ error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
