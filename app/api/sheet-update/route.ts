import { NextResponse } from "next/server";
import {
  updateClientFields,
  renameClientEverywhere,
  addClientToSby,
  ClientRowNotFoundError,
  MissingCredentialsError,
} from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  periodo?: string;
  cliente?: string;
  estado?: string;
  importe?: string;
  facturaEmitida?: string;
  nombre?: string;
  origen?: string;
};

const VALID_ESTADOS = new Set(["Hecho", "Pendiente", "50%", "STAND BY", ""]);
// "" = automático (el dashboard decide por atribución de GHL, como hasta
// ahora). Un valor explícito aquí tiene SIEMPRE prioridad sobre ese cálculo
// automático — es la palabra de Daniel, no una sugerencia.
const VALID_ORIGENES = new Set(["CBO_LEADS_REFOR", "Organico", ""]);

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { periodo, cliente, estado, importe, facturaEmitida, nombre, origen } = body;
  const hayCambioDeCampos = estado !== undefined || importe !== undefined || facturaEmitida !== undefined || origen !== undefined;
  const hayRenombrado = nombre !== undefined && nombre.trim() !== "" && nombre.trim() !== cliente;
  if (!periodo || !cliente || (!hayCambioDeCampos && !hayRenombrado)) {
    return NextResponse.json(
      { error: "INVALID_BODY", detail: "Faltan periodo, cliente, o algún campo a cambiar (estado/importe/facturaEmitida/origen/nombre)" },
      { status: 400 }
    );
  }
  if (estado !== undefined && !VALID_ESTADOS.has(estado)) {
    return NextResponse.json({ error: "INVALID_ESTADO", detail: `Estado no reconocido: ${estado}` }, { status: 400 });
  }
  if (origen !== undefined && !VALID_ORIGENES.has(origen)) {
    return NextResponse.json({ error: "INVALID_ORIGEN", detail: `Origen no reconocido: ${origen}` }, { status: 400 });
  }

  try {
    // El renombrado se hace DESPUÉS de estado/importe/facturaEmitida/origen:
    // esos se localizan por el nombre ANTERIOR, así que si se renombrara
    // primero ya no se encontraría la fila.
    if (hayCambioDeCampos) {
      await updateClientFields(periodo, cliente, { estado, importe, facturaEmitida, origen });
    }
    let tabsRenombrados: string[] | undefined;
    if (hayRenombrado) {
      const result = await renameClientEverywhere(cliente, nombre!.trim());
      tabsRenombrados = result.tabsUpdated;
    }

    // Pedido explícito de Daniel: marcar STAND BY en la tabla de ingresos
    // debe mover al cliente a "Clientes en pausa" solo, sin tener que pulsar
    // "Mover a pausa" aparte. Se usa el nombre FINAL (si se renombró a la
    // vez en la misma petición) para no duplicar por escribir el nombre
    // antiguo en SBY. addClientToSby ya no duplica si ya estaba.
    let movidoAPausa = false;
    if (estado === "STAND BY") {
      const nombreFinal = hayRenombrado ? nombre!.trim() : cliente;
      await addClientToSby(nombreFinal, "");
      movidoAPausa = true;
    }

    return NextResponse.json({ ok: true, tabsRenombrados, movidoAPausa });
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
