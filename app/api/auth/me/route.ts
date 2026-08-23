import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/requireRole";

// Usado por el header de /growth y /growth/documentacion para saber si
// mostrar el enlace "Dashboard financiero" (solo admin) y el email del
// usuario. No es la barrera de seguridad — eso es proxy.ts + requireAdmin
// en cada endpoint financiero — esto es solo para la UI.
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { email: session.email, role: session.role, displayName: session.displayName } });
}
