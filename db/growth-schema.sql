-- Dashboard comercial (pipeline GROWTH). GoHighLevel es la fuente de verdad;
-- estas tablas son una copia normalizada + histórico + auditoría, nunca la
-- fuente principal de contactos/oportunidades/citas. Todo idempotente: se
-- puede volver a ejecutar sin duplicar nada (CREATE ... IF NOT EXISTS).

create table if not exists growth_closers (
  id text primary key,               -- ghl_user_id real (identidad permanente)
  display_name text not null,
  active boolean not null default true,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una fila = una oportunidad de GHL = un lead comercial único. No se crea
-- una fila nueva por cambio de fase, reprogramación, no-show, reunión 2, etc.
create table if not exists growth_opportunities (
  opportunity_id text primary key,
  contact_id text not null,
  contact_name text,
  company_name text,
  phone text,
  email text,
  pipeline_stage_id text not null,
  status text not null,                     -- open | won | lost | abandoned (valor real de GHL) | eliminado_en_ghl (local, ver lib/growth/sync.ts: contacto/oportunidad borrado directamente en GHL, detectado por reconcileGrowth)
  closer_id text references growth_closers(id) on delete set null,
  -- Mes (YYYY-MM, hora Madrid) de la PRIMERA entrada observada en "Nuevo
  -- cualificado | Sin agenda". Se congela la primera vez que se ve al lead:
  -- nunca se recalcula después, para que el funnel de un mes no cambie
  -- retroactivamente aunque el lead avance en meses posteriores (cohorte).
  entry_month text not null,
  asistio_reunion text,                     -- valor crudo de GHL: Sí | No | Pendiente
  proximo_paso text,                        -- valor crudo de GHL (picklist)
  fecha_reunion_agendada timestamptz,       -- próxima cita ACTIVA resuelta (evento real, no solo el campo DATE de GHL)
  -- Fecha de seguimiento para la cola de Follow-ups: la due_date de la tarea
  -- de GHL más próxima sin completar del contacto, cuando el "Próximo paso"
  -- lo requiere (Follow-up/Enviar propuesta/Hablar con socio/Firmar
  -- contrato/Pago/Call 2 sin cita). No existe un campo custom dedicado en
  -- GHL para esto — se reutilizan las Tareas nativas, no se inventa un campo
  -- nuevo. Null = sin fecha conocida (bucket "Sin fecha" en el dashboard).
  follow_up_due_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_growth_opportunities_entry_month on growth_opportunities(entry_month);
create index if not exists idx_growth_opportunities_closer on growth_opportunities(closer_id);

-- Historial de citas de una misma oportunidad. Una reprogramación NO borra
-- la fila anterior (se marca replaces vía replaces_appointment_id en la
-- nueva); una reunión 2 es una fila nueva con meeting_number = 2 sobre la
-- MISMA opportunity_id.
-- SIN "on delete cascade" a propósito (corregido 2026-08-28, ver
-- docs/MEETING_ARCHITECTURE.md): una reunión es un hecho histórico
-- independiente de la oportunidad que la originó. Si algún día se borra una
-- fila de growth_opportunities, debe fallar de forma ruidosa en vez de
-- arrastrar en silencio el historial de reuniones — hoy nada del código borra
-- oportunidades (solo se marca el status), así que esta restricción no
-- debería dispararse nunca en operación normal.
create table if not exists growth_appointments (
  id bigserial primary key,
  opportunity_id text not null references growth_opportunities(opportunity_id),
  appointment_id text not null,             -- id real del evento de calendario en GHL
  meeting_number integer not null,
  scheduled_at timestamptz not null,
  original_scheduled_at timestamptz,        -- primera hora conocida, antes de reprogramar (si aplica)
  ghl_status text,                          -- appointmentStatus crudo de GHL (confirmed/cancelled/showed/noshow/...) — GHL NO trackea asistencia aquí, solo confirmación/cancelación
  -- FUENTE DE VERDAD de asistencia (corregido 2026-08-28): pendiente | si | no.
  -- Se escribe UNA SOLA VEZ por reunión, directamente desde el dashboard
  -- (app/api/growth/opportunity/route.ts, acción "asistio"), identificando la
  -- fila exacta por appointment_id — nunca se infiere de un campo mutable de
  -- la oportunidad (asistio_reunion/pipeline_stage_id), que solo puede
  -- describir el estado ACTUAL de la oportunidad, no el histórico de cada
  -- reunión. reconcileGrowth() (lib/growth/sync.ts) nunca escribe esta
  -- columna — solo el dashboard, para que un resync de GHL no pueda pisar un
  -- resultado ya registrado.
  attendance text not null default 'pendiente',
  closer_id text references growth_closers(id) on delete set null,
  replaces_appointment_id text,
  is_active boolean not null default true,  -- false = reprogramada/sustituida/cancelada, ya no es la cita vigente
  source text not null default 'ghl',       -- ghl | dashboard
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id)
);
create index if not exists idx_growth_appointments_opportunity on growth_appointments(opportunity_id);

-- Auditoría: quién cambió qué, desde dónde, y si la sincronización con GHL
-- salió bien. No se muestra en la pantalla principal, pero tiene que existir
-- para poder diagnosticar cualquier incidencia.
create table if not exists growth_audit_log (
  id bigserial primary key,
  opportunity_id text,
  appointment_id text,
  actor text not null,                      -- dashboard | ghl_reconciliation | ghl_webhook
  field text not null,
  old_value text,
  new_value text,
  sync_status text not null,                -- ok | failed | retrying
  error_detail text,
  created_at timestamptz not null default now()
);
create index if not exists idx_growth_audit_opportunity on growth_audit_log(opportunity_id);

-- Deduplicación de webhooks (listo para cuando se despliegue y GHL pueda
-- alcanzar la URL pública). event_id es la clave de idempotencia: si GHL
-- reenvía el mismo evento, la segunda escritura no vuelve a procesarlo.
create table if not exists growth_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists growth_sync_state (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- Columnas añadidas después de la primera versión del esquema: "create
-- table if not exists" no las añade a una tabla ya existente, así que se
-- declaran aquí aparte, también de forma idempotente.
alter table growth_opportunities add column if not exists follow_up_due_at timestamptz;
-- Fecha comercial de cierre: la PRIMERA vez confirmada que la oportunidad
-- entró en la fase "Pagado" (fuente canónica de una venta, ver
-- app/api/growth/opportunity/route.ts y lib/growth/sync.ts). Nunca se
-- sobrescribe una vez puesta — reentradas posteriores en "Pagado" no cambian
-- la fecha de cierre ni cuentan una segunda venta.
alter table growth_opportunities add column if not exists pagado_confirmado_at timestamptz;
-- Fecha/hora real de entrada del lead (primera vez visto, congelada igual
-- que entry_month) — entry_month solo tiene granularidad de mes y no basta
-- para que el bloque "Leads" respete el selector Hoy/Semana/Mes.
alter table growth_opportunities add column if not exists entry_at timestamptz;
-- Título (texto libre) y id real de la tarea de GHL que resuelve
-- follow_up_due_at — permite mostrar la acción concreta del follow-up en el
-- dashboard y, sobre todo, EDITAR esa misma tarea (PUT) en vez de crear una
-- nueva cada vez que se revisa un follow-up (evita la acumulación de tareas
-- duplicadas descrita en DASHBOARD_CONTEXT.md §7). Se sobrescriben en cada
-- sync — a diferencia de entry_at/pagado_confirmado_at, no son "write-once":
-- reflejan siempre la tarea pendiente más próxima vigente en GHL.
alter table growth_opportunities add column if not exists follow_up_title text;
alter table growth_opportunities add column if not exists follow_up_task_id text;
-- Fecha/hora real del primer contacto: la primera vez confirmada que la
-- oportunidad deja la fase "Nuevo cualificado | Sin agenda" (se agenda,
-- entra en cualquier otra fase, o se marca perdida/abandonada). Congelada la
-- primera vez, igual que entry_at/pagado_confirmado_at — mide velocidad de
-- respuesta real del setter, no se recalcula si el lead retrocede después.
alter table growth_opportunities add column if not exists first_contact_at timestamptz;

-- Corrección estructural 2026-08-28 (ver docs/MEETING_ARCHITECTURE.md): quita
-- el "on delete cascade" de una tabla ya creada en producción con esa
-- cláusula — "create table if not exists" de arriba no la toca porque la
-- tabla ya existe. Una sola sentencia (drop + add de la misma constraint) a
-- propósito: lib/growth/db.ts trocea este archivo por ";\n", así que un
-- bloque DO/BEGIN con punto y coma dentro se rompería a medias. Segura de
-- repetir: si ya se aplicó, vuelve a dejar la misma constraint sin cascada.
alter table growth_appointments
  drop constraint if exists growth_appointments_opportunity_id_fkey,
  add constraint growth_appointments_opportunity_id_fkey
    foreign key (opportunity_id) references growth_opportunities(opportunity_id);

-- Corrección histórica auditada (Fase 21 del brief de Daniel, 2026-08-28):
-- cuando el histórico real conocido no puede reconstruirse con identidad
-- exacta (reunión, contacto, fecha) desde GHL/Neon, se registra aquí un
-- ajuste explícito en vez de fabricar reuniones o contactos falsos. Nunca se
-- usa para inflar métricas sin motivo documentado — cada fila debe explicar
-- su "reason" y quién la creó. Los ajustes de un mes concreto se suman a las
-- métricas de ese periodo (ver lib/growth/metrics.ts); "all" se aplica en
-- todos los periodos que lo incluyan (uso pensado solo para el arranque).
create table if not exists growth_metric_adjustments (
  id bigserial primary key,
  metric_type text not null,       -- 'attended' | 'no_show'
  period text not null,            -- 'YYYY-MM' o 'all'
  delta integer not null,
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
