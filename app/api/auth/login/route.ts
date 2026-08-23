import { NextResponse } from "next/server";
import { authQuery } from "@/lib/auth/db";
import { verifyPassword } from "@/lib/auth/password";
import { signSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// Hash bcrypt valido pero de una contrasena que no existe en ningun sitio —
// se compara contra esto cuando el email no existe, para que responder
// "no existe" tarde lo mismo que responder "contrasena incorrecta" (evita
// que el tiempo de respuesta revele si un email esta registrado).
const DUMMY_HASH = "$2b$12$gWsxHozBedWCri3iTjTFTeYixR6BzH.Q1CrkopzKMSIrzzXE014Xy";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 400 });
  }

  const rows = await authQuery<{ id: string; password_hash: string; active: boolean }>`
    select id, password_hash, active from dashboard_users where lower(email) = ${email} limit 1
  `;
  const row = rows[0];

  const valid = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !row.active || !valid) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const token = await signSessionToken(row.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });
  return res;
}
