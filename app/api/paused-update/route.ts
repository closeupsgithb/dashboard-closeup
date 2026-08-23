import { NextResponse } from "next/server";
import {
  addClientToSby,
  removeClientFromSby,
  updateClientFields,
  renameClientEverywhere,
  ClientRowNotFoundError,
  MissingCredentialsError,
} from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  action?: "moveToPause" | "moveToActive" | "update";
  cliente?: string;
  comentario?: string;
  estado?: string;
  importe?: string;
  facturaEmitida?: string;
  nombre?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { action, cliente } = body;
  if (!action || !cliente) {
    return NextResponse.json({ error: "INVALID_BODY", detail: "Faltan action o cliente" }, { status: 400 });
  }

  try {
    if (action === "moveToPause") {
      await addClientToSby(cliente, body.comentario ?? "");
      return NextResponse.json({ ok: true });
    }
    if (action === "moveToActive") {
      await removeClientFromSby(cliente);
      return NextResponse.json({ ok: true });
    }
    if (action === "update") {
      const { estado, importe, facturaEmitida, comentario, nombre } = body;
      const hayCambioDeCampos =
        estado !== undefined || importe !== undefined || facturaEmitida !== undefined || comentario !== undefined;
      const hayRenombrado = nombre !== undefined && nombre.trim() !== "" && nombre.trim() !== cliente;
      if (hayCambioDeCampos) {
        await updateClientFields("SBY", cliente, { estado, importe, facturaEmitida, comentario });
      }
      if (hayRenombrado) {
        await renameClientEverywhere(cliente, nombre!.trim());
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "INVALID_ACTION", detail: `Acción no reconocida: ${action}` }, { status: 400 });
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
