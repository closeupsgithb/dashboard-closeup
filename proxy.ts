import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, signSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// Next.js 16 renombro middleware.ts -> proxy.ts (funcion `proxy`, no
// `middleware`) y ahora corre en runtime Node.js por defecto — no Edge.
// Ver node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

// Rutas accesibles para CUALQUIER usuario autenticado (admin o commercial).
// Todo lo que no empiece por uno de estos prefijos exige role === "admin"
// — allowlist explicita: "no access = no data delivered" por defecto, en
// vez de una lista negra de rutas financieras que alguien podria olvidar
// actualizar al anadir un endpoint nuevo.
const COMMERCIAL_PREFIXES = ["/growth", "/api/growth", "/materiales-comerciales", "/api/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

function isCommercialArea(pathname: string): boolean {
  return COMMERCIAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (session.role !== "admin" && !isCommercialArea(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/growth", request.url));
  }

  // Sesion deslizante: cada visita valida reemite la cookie con TTL fresco,
  // asi un usuario activo nunca "cae" a mitad de trabajo. La revocacion real
  // (usuario desactivado) no depende de esto — verifySessionToken ya
  // comprueba `active` contra Neon en cada llamada, no solo la firma/exp
  // del JWT.
  const response = NextResponse.next();
  const newToken = await signSessionToken(session.id);
  response.cookies.set(SESSION_COOKIE, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });
  return response;
}

// logo-closeup.png esta excluido a proposito: es el logo de marca, se ve en
// la propia pagina de /login antes de autenticarse — si quedara detras del
// proxy, la imagen se redirige a /login y el optimizador de imagenes de
// Next.js la recibe como "recurso invalido" (400), asi que el logo del
// login nunca cargaba. No es informacion sensible, a diferencia de
// /materiales-comerciales (esos si quedan protegidos, ver COMMERCIAL_PREFIXES).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo-closeup.png).*)"],
};
