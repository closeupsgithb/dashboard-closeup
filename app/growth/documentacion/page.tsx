"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

const PIPELINE_STAGES: { name: string; situacion: string }[] = [
  { name: "Nuevo cualificado | Sin agenda", situacion: "Lead cualificado que todavía no tiene reunión." },
  { name: "Agendado | Pendiente confirmación", situacion: "Existe una cita, pero todavía no hay confirmación expresa." },
  { name: "Agendado | Confirmado", situacion: "El lead ha confirmado la cita y los decisores necesarios asistirán." },
  { name: "Solicita Reagendar", situacion: "El lead avisa antes de la reunión de que necesita otra fecha." },
  { name: "No-show | Recuperación", situacion: "La reunión llega y el lead no asiste. Se activa la recuperación y el enlace de reagenda." },
  { name: "Reunión realizada | Interesado", situacion: "La reunión se ha realizado, no se ha cerrado y existe interés real." },
  { name: "Follow-up / Call 2", situacion: "Hay una segunda reunión o una próxima acción comercial ya definida." },
  { name: "Pagado", situacion: "El pago está confirmado." },
];

const ESIGN_PLATFORMS: { label: string; url: string }[] = [
  { label: "YouTrust", url: "https://youtrust.com/" },
  { label: "SignNow", url: "https://www.signnow.com/" },
  { label: "SignWell", url: "https://www.signwell.com/" },
  { label: "DocuSign", url: "https://www.docusign.com/es-es" },
];

function CopyButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard no disponible — no bloquea el resto de la acción */
        }
      }}
      className="rounded-md border px-2.5 py-1 text-xs font-medium"
      style={{ borderColor: "var(--border)", color: "var(--ink)" }}
    >
      {copied ? "Copiado ✓" : "Copiar enlace"}
    </button>
  );
}

function OpenButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-md px-2.5 py-1 text-xs font-medium"
      style={{ background: "var(--brand)", color: "white" }}
    >
      {label}
    </a>
  );
}

function PendingBadge() {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: "var(--baseline)", color: "var(--ink-secondary)" }}
    >
      Pendiente de configurar
    </span>
  );
}

type QuickLink = { label: string; sectionId: string; href?: string; pending?: boolean };

const QUICK_LINKS: QuickLink[] = [
  { label: "Presentación", sectionId: "presentacion", pending: true },
  { label: "Contrato", sectionId: "contratos" },
  { label: "Pago", sectionId: "pagos", href: "/materiales-comerciales/guia-pagos-reformas-system.html" },
  { label: "Pre-Call", sectionId: "precall", href: "/materiales-comerciales/mas-reformas-system.pdf" },
];

function Accordion({
  id,
  title,
  subtitle,
  tag,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="growth-section">
      <button onClick={onToggle} className="flex w-full items-start justify-between gap-3 text-left">
        <div>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--brand)" }}>{open ? "▾" : "▸"}</span>
            <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              {title}
            </h2>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: "color-mix(in srgb, var(--brand) 12%, transparent)", color: "var(--brand)" }}
            >
              {tag}
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
            {subtitle}
          </p>
        </div>
      </button>
      {open && <div className="mt-4 flex flex-col gap-3">{children}</div>}
    </section>
  );
}

function Resource({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--gridline)" }}>
      <div className="mb-1 text-sm font-medium" style={{ color: "var(--ink)" }}>
        {title}
      </div>
      <p className="mb-2.5 text-xs" style={{ color: "var(--ink-secondary)" }}>
        {description}
      </p>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export default function CentroComercialPage() {
  const [open, setOpen] = useState<string | null>("dashboard");
  const [showPipeline, setShowPipeline] = useState(false);
  const [showFirma, setShowFirma] = useState(false);

  function toggle(id: string) {
    setOpen((cur) => (cur === id ? null : id));
  }

  function goTo(sectionId: string) {
    setOpen(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold leading-tight" style={{ color: "var(--ink)" }}>
              Centro comercial
            </h1>
            <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
              Recursos y herramientas para gestionar tus oportunidades.
            </p>
          </div>
        </div>
        <Link href="/growth" className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
          ← Volver al dashboard comercial
        </Link>
      </header>

      <div
        className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3.5"
        style={{ borderColor: "var(--border)", background: "var(--surface)", boxShadow: "var(--card-shadow)" }}
      >
        {QUICK_LINKS.map((q) =>
          q.href ? (
            <a
              key={q.label}
              href={q.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--border)", color: "var(--ink)" }}
            >
              {q.label}
            </a>
          ) : (
            <button
              key={q.label}
              onClick={() => goTo(q.sectionId)}
              className="flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
            >
              {q.label}
              {q.pending && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--baseline)" }} />}
            </button>
          )
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Accordion
          id="dashboard"
          title="Dashboard"
          subtitle="Reuniones, pendientes y follow-ups"
          tag="Uso diario"
          open={open === "dashboard"}
          onToggle={() => toggle("dashboard")}
        >
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            &quot;Tengo este contacto en esta situación. ¿Qué hago ahora?&quot;
          </p>
          <Resource
            title="Guía de uso — Dashboard comercial"
            description="Cómo trabajar reuniones, no shows, reagendas, Call 2 y follow-ups."
            actions={
              <>
                <OpenButton href="/materiales-comerciales/guia-uso-dashboard-growth.html" label="Abrir guía" />
                <a href="/materiales-comerciales/guia-uso-dashboard-growth.pdf" target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
                  Descargar PDF
                </a>
              </>
            }
          />
        </Accordion>

        <Accordion
          id="guia-comercial"
          title="Guía comercial"
          subtitle="Setter, closer y pipeline"
          tag="Proceso comercial"
          open={open === "guia-comercial"}
          onToggle={() => toggle("guia-comercial")}
        >
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            &quot;¿Qué tengo que decir o hacer con este lead?&quot;
          </p>
          <Resource
            title="Proceso comercial — Setter + Closer"
            description="Cualificación, agenda, discovery, cierre y próximo paso."
            actions={<OpenButton href="/materiales-comerciales/guia-comercial-setter-closer.pdf" label="Abrir guía" />}
          />
          <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--gridline)" }}>
            <div className="mb-1 text-sm font-medium" style={{ color: "var(--ink)" }}>
              Mapa del pipeline
            </div>
            <p className="mb-2.5 text-xs" style={{ color: "var(--ink-secondary)" }}>
              Qué significa cada etapa y cuándo mover una oportunidad.
            </p>
            <button
              onClick={() => setShowPipeline((v) => !v)}
              className="rounded-md px-2.5 py-1 text-xs font-medium"
              style={{ background: "var(--brand)", color: "white" }}
            >
              {showPipeline ? "Ocultar pipeline" : "Ver pipeline"}
            </button>
            {showPipeline && (
              <div className="mt-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left" style={{ color: "var(--ink-secondary)" }}>
                      <th className="pb-1.5 pr-3 font-medium">Etapa</th>
                      <th className="pb-1.5 font-medium">Cuándo se utiliza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PIPELINE_STAGES.map((s) => (
                      <tr key={s.name} style={{ borderTop: "1px solid var(--gridline)" }}>
                        <td className="py-2 pr-3 font-medium whitespace-nowrap" style={{ color: "var(--ink)" }}>
                          {s.name}
                        </td>
                        <td className="py-2" style={{ color: "var(--ink-secondary)" }}>
                          {s.situacion}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2.5 text-xs" style={{ color: "var(--status-critical)" }}>
                  Mover una ficha puede activar mensajes, tareas o workflows. Muévela únicamente cuando el evento
                  correspondiente haya ocurrido de verdad — nunca para &quot;ordenar&quot; el pipeline.
                </p>
              </div>
            )}
          </div>
        </Accordion>

        <Accordion
          id="presentacion"
          title="Presentación de ventas"
          subtitle="Material para utilizar en la llamada"
          tag="Usar en la reunión"
          open={open === "presentacion"}
          onToggle={() => toggle("presentacion")}
        >
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            &quot;¿Qué presentación utilizo para vender +Reformas System?&quot;
          </p>
          <Resource
            title="+Reformas System — Presentación de ventas"
            description="Daniel añadirá aquí la versión definitiva. Todavía no hay una presentación confirmada para usar en llamada."
            actions={<PendingBadge />}
          />
        </Accordion>

        <Accordion
          id="precall"
          title="Pre-call"
          subtitle="Material que recibe el prospecto"
          tag="Enviar al prospecto"
          open={open === "precall"}
          onToggle={() => toggle("precall")}
        >
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            &quot;¿Qué recibe el prospecto antes de la llamada?&quot;
          </p>
          <Resource
            title="+Reformas System — Pre-Call"
            description="Documento previo que se envía al prospecto para preparar la reunión. No es la presentación de ventas — la consume el prospecto antes de la llamada, no el closer durante ella."
            actions={
              <>
                <OpenButton href="/materiales-comerciales/mas-reformas-system.pdf" label="Abrir PDF" />
                <CopyButton path="/materiales-comerciales/mas-reformas-system.pdf" />
              </>
            }
          />
        </Accordion>

        <Accordion
          id="contratos"
          title="Contratos"
          subtitle="Documentación para formalizar el cierre"
          tag="Cierre"
          open={open === "contratos"}
          onToggle={() => toggle("contratos")}
        >
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            &quot;¿Qué contrato tengo que enviar?&quot;
          </p>
          <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--gridline)" }}>
            <div className="mb-1 text-sm font-medium" style={{ color: "var(--ink)" }}>
              Datos que hay que pedir al cliente
            </div>
            <p className="mb-2.5 text-xs" style={{ color: "var(--ink-secondary)" }}>
              Pídelos antes de generar el contrato — sin esto no se puede formalizar el cierre.
            </p>
            <ul className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--ink)" }}>
              <li>Nombre completo</li>
              <li>DNI</li>
              <li>Nombre de la sociedad</li>
              <li>Dirección comercial</li>
              <li>CIF</li>
            </ul>
          </div>
          <Resource
            title="Contrato +Reformas System — Pago único"
            description="2.997 € + IVA en un solo pago. Versión estándar del contrato."
            actions={
              <>
                <OpenButton href="/materiales-comerciales/contrato-reformas-system-2997.pdf" label="Abrir PDF" />
                <CopyButton path="/materiales-comerciales/contrato-reformas-system-2997.pdf" />
              </>
            }
          />
          <Resource
            title="Contrato +Reformas System — Pago fraccionado"
            description="1.500 € + IVA de entrada y el resto a 30 días. Misma garantía y condiciones que la versión estándar."
            actions={
              <>
                <OpenButton href="/materiales-comerciales/contrato-reformas-system-1500.pdf" label="Abrir PDF" />
                <CopyButton path="/materiales-comerciales/contrato-reformas-system-1500.pdf" />
              </>
            }
          />
          <Resource
            title="Generador de contrato"
            description="Rellena los datos del cliente, elige pago único o fraccionado, y genera el PDF ya personalizado en segundos."
            actions={<OpenButton href="/materiales-comerciales/generador-contrato-reformas-system.html" label="Abrir generador" />}
          />
          <Resource
            title="Prompt maestro (alternativa vía IA)"
            description="Si no puedes usar el generador, pega este prompt en Claude o ChatGPT junto con los datos del cliente para obtener el contrato ya rellenado."
            actions={
              <>
                <OpenButton href="/materiales-comerciales/prompt-maestro-contrato-reformas-system.txt" label="Abrir prompt" />
                <CopyButton path="/materiales-comerciales/prompt-maestro-contrato-reformas-system.txt" />
              </>
            }
          />
          <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--gridline)" }}>
            <div className="mb-1 text-sm font-medium" style={{ color: "var(--ink)" }}>
              Firma electrónica
            </div>
            <p className="mb-2.5 text-xs" style={{ color: "var(--ink-secondary)" }}>
              Plataformas para formalizar la firma del contrato.
            </p>
            <button
              onClick={() => setShowFirma((v) => !v)}
              className="rounded-md px-2.5 py-1 text-xs font-medium"
              style={{ background: "var(--brand)", color: "white" }}
            >
              {showFirma ? "Ocultar plataformas" : "Ver plataformas"}
            </button>
            {showFirma && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {ESIGN_PLATFORMS.map((p) => (
                  <li key={p.url}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline"
                      style={{ color: "var(--ink)" }}
                    >
                      {p.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Accordion>

        <Accordion
          id="pagos"
          title="Pagos"
          subtitle="Enlaces para completar el cierre"
          tag="Pago"
          open={open === "pagos"}
          onToggle={() => toggle("pagos")}
        >
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            &quot;¿Qué enlace de pago tengo que enviar?&quot;
          </p>
          <Resource
            title="Guía de pagos — +Reformas System"
            description="Transferencia, tarjeta (Stripe) y reglas de fraccionamiento. Uso interno — no compartir con el cliente."
            actions={
              <>
                <OpenButton href="/materiales-comerciales/guia-pagos-reformas-system.html" label="Abrir guía" />
                <a href="/materiales-comerciales/guia-pagos-reformas-system.pdf" target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: "var(--ink-secondary)" }}>
                  Descargar PDF
                </a>
                <CopyButton path="/materiales-comerciales/guia-pagos-reformas-system.html" />
              </>
            }
          />
        </Accordion>

        <Accordion
          id="automatizaciones"
          title="Automatizaciones"
          subtitle="Workflows y comunicación del embudo"
          tag="Interno / Operaciones"
          open={open === "automatizaciones"}
          onToggle={() => toggle("automatizaciones")}
        >
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            &quot;¿Qué está recibiendo automáticamente este contacto?&quot;
          </p>
          <Resource
            title="Comunicación del embudo — Workflows"
            description="Mensajes automáticos, agenda, no show y nurture — documento interno, más técnico."
            actions={<OpenButton href="/materiales-comerciales/embudo-comunicacion-workflows.html" label="Abrir documento" />}
          />
        </Accordion>
      </div>
    </main>
  );
}
