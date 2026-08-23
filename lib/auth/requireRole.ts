import { verifySessionToken, SESSION_COOKIE, type SessionUser } from "./session";

// Segunda barrera, independiente de proxy.ts (Fase 9: "nunca confiar
// exclusivamente en el middleware/proxy" — un matcher mal configurado o un
// refactor de rutas no debe dejar un endpoint financiero desprotegido). Se
// llama al principio de cada route handler sensible; si devuelve una
// Response, el handler debe devolverla tal cual y no seguir ejecutando.
export function getSessionFromRequest(request: Request): Promise<SessionUser | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const token = match ? decodeURIComponent(match[1]) : undefined;
  return verifySessionToken(token);
}

export async function requireSession(request: Request): Promise<SessionUser | Response> {
  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return session;
}

export async function requireAdmin(request: Request): Promise<SessionUser | Response> {
  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  return session;
}
