import { NextResponse } from "next/server";
import { syncSingleOpportunity } from "@/lib/growth/sync";
import { query } from "@/lib/growth/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// INACTIVO mientras el dashboard siga solo en local: GHL no puede alcanzar
// esta URL hasta que exista un dominio público (Vercel). Código completo y
// listo para activarse el día del despliegue — solo falta, en GHL, crear un
// Workflow con una acción "Webhook" apuntando a
// https://<dominio>/api/growth/webhook, disparado por los eventos del
// pipeline GROWTH (cambio de fase, cita creada/actualizada, campos
// asistio_reunion/Próximo paso) y con "Opportunity ID" incluido en el
// payload — es el único dato que este receptor necesita para actuar,
// porque siempre relee el estado fresco de GHL en vez de fiarse del cuerpo
// del webhook (que puede llegar incompleto o desordenado).
//
// Idempotente por construcción: reprocesar el mismo evento (reintento de
// GHL, o llegar dos veces) no duplica nada porque syncSingleOpportunity
// hace upsert por opportunity_id/appointment_id, nunca inserta a ciegas. Si
// GHL manda un eventId se deduplica también a nivel de evento para no
// repetir trabajo de más.
export async function POST(request: Request) {
  let body: { eventId?: string; eventType?: string; opportunityId?: string; opportunity?: { id?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const opportunityId = body.opportunityId ?? body.opportunity?.id;
  if (!opportunityId) {
    return NextResponse.json({ error: "INVALID_BODY", detail: "Falta opportunityId en el payload del webhook" }, { status: 400 });
  }

  if (body.eventId) {
    const seen = await query<{ event_id: string }>`select event_id from growth_webhook_events where event_id = ${body.eventId}`;
    if (seen.length > 0) {
      return NextResponse.json({ ok: true, dedup: true });
    }
    await query`
      insert into growth_webhook_events (event_id, event_type, payload) values (${body.eventId}, ${body.eventType ?? "unknown"}, ${JSON.stringify(body)})
    `;
  }

  try {
    await syncSingleOpportunity(opportunityId);
    if (body.eventId) {
      await query`update growth_webhook_events set processed_at = now() where event_id = ${body.eventId}`;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
