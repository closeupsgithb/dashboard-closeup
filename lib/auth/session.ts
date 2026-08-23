import { SignJWT, jwtVerify } from "jose";
import { authQuery } from "./db";

export type Role = "admin" | "commercial";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
};

export const SESSION_COOKIE = "dc_session";
// Sesion deslizante: cada validacion correcta reemite la cookie con este
// TTL, asi que un usuario activo nunca "cae" a mitad de trabajo — pero una
// sesion inactiva expira sola. La revocacion real (Fase 13, usuario
// desactivado) no depende de esto: se comprueba `active` contra la base de
// datos en cada request, no solo la caducidad del JWT.
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 dias

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("MISSING_AUTH_SECRET");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

// Verifica la firma/caducidad del JWT y, si es valido, vuelve a consultar
// el usuario real en Neon (email, role, active, display_name) — nunca se
// confia en un role/estado embebido en el propio token, que podria estar
// desactualizado si alguien pierde el acceso despues de emitirse la
// cookie. Devuelve null si el token es invalido O si el usuario ya no
// existe/esta desactivado.
export async function verifySessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  let userId: string;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string") return null;
    userId = payload.sub;
  } catch {
    return null;
  }

  const rows = await authQuery<{
    id: string;
    email: string;
    role: Role;
    display_name: string | null;
    active: boolean;
  }>`select id, email, role, display_name, active from dashboard_users where id = ${userId} limit 1`;

  const row = rows[0];
  if (!row || !row.active) return null;

  return { id: row.id, email: row.email, role: row.role, displayName: row.display_name };
}
