import { NextResponse } from "next/server";
import { reconcileGrowth } from "@/lib/growth/sync";
import { MissingCredentialsError as GhlMissingCredentials } from "@/lib/growth/ghl";
import { MissingCredentialsError as DbMissingCredentials } from "@/lib/growth/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Botón "Actualizar": fuerza una reconciliación inmediata y devuelve el
// resultado. La sincronización ordinaria ya ocurre sola en cada carga de
// /api/growth/metrics — este endpoint es solo para el caso "quiero
// comprobar ahora mismo" o reintentar tras un fallo.
export async function POST() {
  try {
    const result = await reconcileGrowth();
    return NextResponse.json({ ok: true, ...result, syncedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof GhlMissingCredentials || err instanceof DbMissingCredentials) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    }
    return NextResponse.json(
      { error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
