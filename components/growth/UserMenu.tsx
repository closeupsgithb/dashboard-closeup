"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Me = { email: string; role: "admin" | "commercial"; displayName: string | null } | null;

// Solo para UI (mostrar el enlace al financiero unicamente a admin, y quien
// ha entrado). La barrera de seguridad real es proxy.ts + requireAdmin en
// cada endpoint financiero — esto nunca decide acceso, solo lo refleja.
export function UserMenu() {
  const [me, setMe] = useState<Me>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((json) => setMe(json.user))
      .catch(() => setMe(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="flex items-center gap-3 text-xs" style={{ color: "var(--ink-muted)" }}>
      {me && <span>{me.displayName ?? me.email}</span>}
      {me?.role === "admin" && (
        <Link href="/" className="underline" style={{ color: "var(--ink-secondary)" }}>
          Dashboard financiero
        </Link>
      )}
      <button onClick={logout} className="underline" style={{ color: "var(--ink-secondary)" }}>
        Cerrar sesión
      </button>
    </div>
  );
}
