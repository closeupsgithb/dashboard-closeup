# DEPLOYMENT_REPORT — Dashboard Comercial Closeup

Fecha: 2026-08-24

## 1. URL de producción

**https://dashboard-closeup.vercel.app**

- HTTPS obligatorio (Vercel lo fuerza; `Strict-Transport-Security` presente en todas las respuestas).
- URL estable — cada `git push` a `master` la actualiza (a diferencia de la URL de deployment individual con hash, que no debe usarse ni compartirse).
- Acceso protegido por login propio de la app (no por "Vercel Authentication" — esa protección de Vercel está desactivada a propósito, ver §4).

## 2. Arquitectura final

```
GoHighLevel (CRM)
   │  webhook + sync
   ▼
Neon Postgres (mismo proyecto ya existente — ep-wispy-butterfly-b1aln0nt)
   │  growth_* tablas (pipeline comercial, sin tocar)
   │  dashboard_users (nueva, solo autenticación)
   ▼
Next.js 16 (App Router, Node runtime) — este repo
   │  proxy.ts → gate de autenticación/autorización en cada request
   ▼
Vercel (proyecto "dashboard-closeup", team-1505's projects)
   │  git-linked a github.com/closeupsgithb/dashboard-closeup (rama master)
   ▼
https://dashboard-closeup.vercel.app
```

No se creó infraestructura nueva de Neon ni un segundo proyecto de Vercel — se reutilizó el Neon existente y se creó un único proyecto de Vercel nuevo (no existía ninguno previo para este dashboard).

## 3. Proveedores

- **Frontend + backend**: Vercel (Next.js 16, runtime Node.js).
- **Base de datos**: Neon (Postgres serverless), proyecto ya existente.
- **CRM origen**: GoHighLevel (vía Private Integration Token, solo lectura de Opportunities/Pipelines).
- **Datos financieros**: Google Sheets (service account) + Meta Ads (System User token).
- **Repositorio**: GitHub — `github.com/closeupsgithb/dashboard-closeup`.

## 4. Sistema de autenticación y autorización

- Login propio con email + contraseña (`bcryptjs`, 12 salt rounds). No se usa NextAuth/Auth.js: se implementó con `jose` (JWT) por simplicidad, dado el tamaño del equipo (3-5 personas) y una versión de Next.js muy reciente donde varias librerías de auth aún no tienen soporte completo.
- Sesión: cookie `dc_session` — `httpOnly`, `secure`, `sameSite=lax`, 14 días, deslizante (se renueva en cada request válido).
- **La sesión NUNCA confía en el propio JWT para permisos**: en cada request, `proxy.ts` vuelve a consultar Neon (`dashboard_users`) para leer `role` y `active` en tiempo real. Un usuario desactivado pierde el acceso inmediatamente, incluso con una cookie de sesión válida — verificado en producción (ver §7).
- Autorización por **allowlist, no blocklist**: todo lo que no esté explícitamente marcado como "área comercial" (`/growth`, `/api/growth`, `/materiales-comerciales`, `/api/auth`) exige `role = admin` por defecto. Así, cualquier ruta financiera nueva que se añada en el futuro queda protegida automáticamente sin tener que acordarse de añadirla a una lista negra.
- **Defensa en profundidad**: además de `proxy.ts`, cada endpoint financiero (`/api/metrics`, `/api/ghl-raw`, `/api/meta-raw`, `/api/sheets-raw`, `/api/paused-update`, `/api/reunion-update`, `/api/sheet-update`) vuelve a comprobar `requireAdmin()` de forma independiente al inicio de su handler. Si algún día se rompe el matcher del proxy, estos endpoints siguen protegidos.
- Login con timing uniforme: si el email no existe, igualmente se ejecuta un `bcrypt.compare` contra un hash señuelo, para que el tiempo de respuesta no revele si un email está registrado. El error devuelto es siempre el mismo (`INVALID_CREDENTIALS`).
- Sin panel de administración de usuarios en la UI (decisión deliberada por tiempo): la gestión es por CLI (`scripts/manage-user.js`), ver §6.

## 5. Roles existentes

| Rol | Valor interno | Acceso |
|---|---|---|
| Administrador | `admin` | Todo: dashboard financiero (`/`), dashboard comercial (`/growth`), documentación, gestión de leads/reuniones/ventas. |
| Comercial | `commercial` | Solo `/growth`, `/api/growth/*`, `/materiales-comerciales`. Cualquier intento de acceder a rutas o endpoints financieros devuelve 403 (API) o redirección a `/growth` (páginas) — verificado, no es solo ocultación visual. |

## 6. Cómo crear / desactivar un usuario

Desde la raíz del proyecto, con `.env.local` configurado (usa el mismo `DATABASE_URL` que producción):

```bash
node scripts/manage-user.js create <email> <admin|commercial> ["Nombre visible"]
node scripts/manage-user.js deactivate <email>
node scripts/manage-user.js activate <email>
node scripts/manage-user.js reset-password <email>
node scripts/manage-user.js list
```

- `create` y `reset-password` generan una contraseña aleatoria de 14 caracteres y la imprimen **una sola vez** por consola — no queda guardada en texto plano en ningún sitio (solo su hash en Neon). Debe copiarse y entregarse a la persona en el momento.
- `deactivate` corta el acceso de inmediato, aunque la persona tenga sesión iniciada (verificado en producción).

**Usuarios actuales:**

| Email | Rol | Estado |
|---|---|---|
| daniel@closeupmarketing.com | admin | activo |
| test-commercial@closeupmarketing.com | commercial | activo (cuenta de pruebas, no operativa) |

**Pendiente**: Alejandro e Iván ya existen como *closers* dentro del pipeline comercial (GHL/Neon), pero **no tienen todavía cuenta de login** — falta su email real para crear sus usuarios `commercial` con el comando de arriba.

## 7. Variables de entorno requeridas (nombres, nunca valores)

Configuradas en Vercel → Project Settings → Environment Variables (Production + Preview):

- `AUTH_SECRET` — clave de firma de sesión (distinta de la de desarrollo local).
- `DATABASE_URL` — conexión Neon.
- `GHL_PRIVATE_TOKEN` — token de solo lectura de GoHighLevel.
- `GOOGLE_SHEETS_CLIENT_EMAIL` — service account de Google Sheets.
- `GOOGLE_SHEETS_PRIVATE_KEY` — clave privada del service account (con secuencias `\n` literales, sin comillas envolventes — así es como la lee el código en `lib/sheets.ts`).
- `META_ACCESS_TOKEN` — token de System User de Meta.

Ninguna de estas variables está expuesta con prefijo `NEXT_PUBLIC_` ni hardcodeada en el código fuente (verificado con búsqueda en todo el repositorio). No hay archivos `.env*` versionados en git.

## 8. Cómo desplegar cambios futuros

El proyecto está conectado a GitHub. Cualquier `git push` a la rama `master` dispara automáticamente un nuevo deployment en Vercel que sustituye la URL de producción.

```bash
git add <archivos>
git commit -m "mensaje"
git push origin master
```

Un cambio en las variables de entorno **no se aplica solo**: hay que añadir/editar la variable en Vercel y luego provocar un nuevo deployment (un `git push`, aunque sea un commit vacío, es suficiente).

## 9. Comprobaciones realizadas

- `npm run build` limpio, sin desactivar reglas de lint/tipos para forzar el build.
- Auditoría completa de arquitectura existente antes de empezar (Neon, Vercel, GHL, variables de entorno, sistema de auth previo — no existía ninguno).
- Búsqueda de secretos hardcodeados y de uso indebido de `NEXT_PUBLIC_*` en todo el repositorio: sin hallazgos.
- Verificación de que las 7 rutas API financieras tienen guard `requireAdmin` explícito además de la protección del proxy.
- Verificación de que las rutas `/api/growth/*` siguen exigiendo sesión autenticada (401 sin cookie) aunque sean accesibles para ambos roles.

## 10. Resultado de pruebas — sesión ADMIN (producción)

| Prueba | Resultado |
|---|---|
| Login con credenciales reales | 200, cookie de sesión emitida |
| `/api/auth/me` | Devuelve email, rol `admin`, nombre |
| `GET /growth` | 200 |
| `GET /` (financiero) | 200 |
| `GET /api/metrics` | 200, datos reales (ingresos, CAC, churn) |
| Logout | 200, cookie limpiada |
| `/api/auth/me` tras logout | 401 `UNAUTHORIZED` |
| `GET /growth` tras logout | Redirección a `/login` |

## 11. Resultado de pruebas — sesión COMERCIAL (producción)

| Prueba | Resultado |
|---|---|
| Login con credenciales reales | 200 |
| `/api/auth/me` | rol `commercial` correcto |
| `GET /growth` | 200 |
| `GET /growth/documentacion` | 200 |
| `GET /` (financiero) | 307 → redirección a `/growth` (no se sirve contenido) |
| `GET /api/metrics` directo | 403 `{"error":"FORBIDDEN"}` |
| `GET /api/ghl-raw` directo | 403 |
| `GET /api/meta-raw` directo | 403 |
| `GET /api/sheets-raw` directo | 403 |
| `POST /api/paused-update` directo | 403 |
| `GET /api/growth/metrics` (datos GHL sincronizados) | 200, datos reales (closers, follow-ups, KPIs) |
| Desactivación en caliente (`deactivate` con sesión ya iniciada) | Sesión existente pierde acceso de inmediato (`/growth` → redirección, `/api/auth/me` → 401) |
| Login tras desactivación | 401 |

## 12. Resultado de pruebas — sin autenticar

| Prueba | Resultado |
|---|---|
| `GET /growth` | Redirección a `/login` |
| `GET /` | Redirección a `/login` |
| `GET /api/metrics` | 401 |
| `GET /api/growth/metrics` | 401 |

## 13. Funcionalidad comercial verificada en producción

- Sincronización con GHL activa: closers reales (Daniel von Zedlitz, Alejandro, Iván), follow-ups reales con datos de contacto y etapa de pipeline.
- Estructura de KPIs intacta: Reuniones (Agendadas/Realizadas), Asistencia (Show rate/Asistidas/No shows), Ventas (Close rate/Ventas) — sin cambios respecto a la versión ya validada antes del despliegue.
- Documentación comercial accesible en `/growth/documentacion`.

## 14. Limitaciones pendientes

- **Alejandro e Iván sin cuenta de login todavía** — se necesita su email real para crear sus usuarios `commercial` (comando en §6).
- **`public/materiales-comerciales/mas-reformas-system.pdf` (3.7 MB)** no se incluyó en este despliegue por tamaño; el resto de materiales sí está desplegado, incluyendo `presentacion-ventas-reformas-system.pdf`, que sigue sin subirse a git (aparece como archivo sin trackear en el repositorio local) y por tanto tampoco está en producción — pendiente decidir si se sube.
- **Sin panel de administración de usuarios en la UI**: la gestión de usuarios es solo por CLI (`scripts/manage-user.js`), directa contra Neon. Es una limitación de alcance, no de seguridad.
- **Logging de diagnóstico mínimo**: las rutas API no emiten logs propios (`console.log`/`console.error`); ante un fallo, la fuente principal de diagnóstico son los logs de función de Vercel (Observability → Logs), que si capturan excepciones no controladas. Si en el futuro aparecen errores difíciles de reproducir, merece la pena añadir logging estructurado sin datos sensibles.
- **Plan Hobby de Vercel**: sin garantías de uptime/soporte de nivel Pro. Suficiente para un equipo de 3-5 personas, pero a tener en cuenta si el uso crece.
- Se observó un **502 puntual y aislado** en `/api/metrics` inmediatamente después del redeploy (cold start), que se resolvió solo en el siguiente intento y no volvió a repetirse en las siguientes verificaciones. No se considera un problema estructural, pero conviene vigilarlo si vuelve a aparecer.
