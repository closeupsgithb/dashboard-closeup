import { NextResponse } from "next/server";
import { updateClientFields, ClientRowNotFoundError, MissingCredentialsError } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Body = { periodo?: string; cliente?: string; estado?: string; importe?: string };

const VALID_ESTADOS = new Set(["Hecho", "Pendiente", "50%", "STAND BY", ""]);

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { periodo, cliente, estado, importe } = body;
  if (!periodo || !cliente || (estado === undefined && importe === undefined)) {
    return NextResponse.json({ error: "INVALID_BODY", detail: "Faltan periodo, cliente, o estado/importe" }, { status: 400 });
  }
  if (estado !== undefined && !VALID_ESTADOS.has(estado)) {
    return NextResponse.json({ error: "INVALID_ESTADO", detail: `Estado no reconocido: ${estado}` }, { status: 400 });
  }

  try {
    await updateClientFields(periodo, cliente, { estado, importe });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    }
    if (err instanceof ClientRowNotFoundError) {
      return NextResponse.json({ error: "CLIENT_NOT_FOUND", detail: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: "UPSTREAM_ERROR", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
