"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/growth";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error === "INVALID_CREDENTIALS" ? "Email o contraseña incorrectos." : "No se pudo iniciar sesión.");
        setLoading(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("No se pudo iniciar sesión. Comprueba tu conexión.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6" style={{ background: "var(--page)" }}>
      <div
        className="w-full max-w-sm rounded-xl border p-8"
        style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--card-shadow)" }}
      >
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              Closeup Marketing
            </div>
            <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Dashboard comercial
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs" style={{ color: "var(--ink-secondary)" }}>
              Email
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs" style={{ color: "var(--ink-secondary)" }}>
              Contraseña
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--page)", color: "var(--ink)" }}
            />
          </div>

          {error && (
            <div className="text-xs" style={{ color: "var(--status-critical)" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--brand)", color: "white" }}
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
