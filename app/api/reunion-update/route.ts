import { NextResponse } from "next/server";
import { upsertManualAttendance, MissingCredentialsError as SheetsMissingCredentials } from "@/lib/sheets";
import { moveOpportunityToNoAsiste, MissingCredentialsError as GhlMissingCredentials } from "@/lib/ghl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Body = { opportunityId?: string; contacto?: string; asistio?: string; fecha?: string; comentario?: string };

const VALID_ASISTIO = new Set(["Sí", "No", ""]);

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { opportunityId, contacto, asistio, fecha, comentario } = body;
  if (!opportunityId || !contacto || asistio === undefined) {
    return NextResponse.json({ error: "INVALID_BODY", detail: "Faltan opportunityId, contacto, o asistio" }, { status: 400 });
  }
  if (!VALID_ASISTIO.has(asistio)) {
    return NextResponse.json({ error: "INVALID_ASISTIO", detail: `Valor no reconocido: ${asistio}` }, { status: 400 });
  }

  try {
    await upsertManualAttendance(opportunityId, {
      contacto,
      asistio,
      fecha: fecha ?? "",
      comentario: comentario ?? "",
    });

    // Pedido explícito de Daniel: marcar "No" en el dashboard debe mover la
    // oportunidad a la fase "No Asiste" en GHL, no solo quedar guardado en el
    // Sheet. No es fatal si esto falla (el Sheet ya tiene prioridad de
    // lectura) — se informa en la respuesta en vez de romper la escritura ya
    // hecha.
    let ghl: { moved: boolean; motivo?: string } | undefined;
    if (asistio === "No") {
      try {
        ghl = await moveOpportunityToNoAsiste(opportunityId);
      } catch (err) {
        ghl = { moved: false, motivo: err instanceof Error ? err.message : String(err) };
      }
    }

    return NextResponse.json({ ok: true, ghl });
  } catch (err) {
    if (err instanceof SheetsMissingCredentials || err instanceof GhlMissingCredentials) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    }
    return NextResponse.json(
      { error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
