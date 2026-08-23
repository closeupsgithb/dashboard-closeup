-- Usuarios del dashboard (login + roles). Tabla propia, separada de las
-- tablas comerciales growth_* — no se toca ni se referencia nada de
-- db/growth-schema.sql. Idempotente (CREATE ... IF NOT EXISTS), mismo
-- patron que el resto del proyecto: se puede volver a ejecutar sin
-- duplicar nada.
--
-- role: 'admin' (acceso a todo, incluido el dashboard financiero) o
-- 'commercial' (solo /growth y sus endpoints). Se valida tambien en
-- codigo (lib/auth/session.ts) — el check aqui es una segunda barrera,
-- no la unica.
create table if not exists dashboard_users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'commercial')),
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dashboard_users_email on dashboard_users(lower(email));
