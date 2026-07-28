import { NextResponse } from "next/server";
import { updateOpportunityCustomFields, ASISTIO_OPTIONS, MissingCredentialsError } from "@/lib/ghl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Body = { opportunityId?: string; fechaReunionAgendada?: string; asistioReunion?: string };

const VALID_ASISTIO = new Set<string>([...ASISTIO_OPTIONS, ""]);

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { opportunityId, fechaReunionAgendada, asistioReunion } = body;
  if (!opportunityId || (fechaReunionAgendada === undefined && asistioReunion === undefined)) {
    return NextResponse.json(
      { error: "INVALID_BODY", detail: "Faltan opportunityId, o fechaReunionAgendada/asistioReunion" },
      { status: 400 }
    );
  }
  if (asistioReunion !== undefined && !VALID_ASISTIO.has(asistioReunion)) {
    return NextResponse.json({ error: "INVALID_ASISTIO", detail: `Valor no reconocido: ${asistioReunion}` }, { status: 400 });
  }

  try {
    await updateOpportunityCustomFields(opportunityId, { fechaReunionAgendada, asistioReunion });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    }
    return NextResponse.json(
      { error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
