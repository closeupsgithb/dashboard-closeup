# Contexto del Dashboard — Closeup Marketing

Documento de referencia permanente para trabajar sobre `dashboard-closeup`. No
contiene tokens, contraseñas ni credenciales — esas viven solo en
`.env.local` (no versionado). Para los IDs exactos de campos/etapas de GHL,
ver `GROWTH_MAPPING.md`; este documento explica el conjunto y el porqué.

## 1. Qué es esto

Suite interna de dos dashboards, Next.js 16 / React 19 / TypeScript /
Tailwind v4, pensada para correr en local (`npm run dev`,
`http://localhost:3000`) por el equipo de Closeup:

- **`/` — Dashboard financiero.** Ingresos, CAC, LTV, churn, ROAS, gestión de
  clientes y facturación. Fuente de datos: Google Sheets (roster de clientes
  por pestaña de mes) + Meta Ads (gasto) + GoHighLevel (conteo de clientes).
- **`/growth` — Dashboard comercial.** Agenda, follow-ups y funnel del
  pipeline GROWTH de GoHighLevel. Fuente de datos: GoHighLevel (API real) +
  Neon Postgres (copia normalizada + histórico + auditoría).

Ninguno de los dos está desplegado — ambos viven solo en localhost hasta que
se autorice explícitamente un despliegue.

## 2. Quién es la fuente de verdad

- **GoHighLevel** es la fuente de verdad de contactos, oportunidades, citas y
  tareas del pipeline GROWTH. Postgres es una **copia** normalizada para
  poder calcular métricas y mantener histórico/auditoría rápido — nunca al
  revés. Toda escritura real pasa primero por la API de GHL; Postgres se
  actualiza después, vía `syncSingleOpportunity` (`lib/growth/sync.ts`).
- **Google Sheets** es la fuente de verdad del roster de clientes y su
  estado de pago para el dashboard financiero (`lib/metrics.ts`).
- El dashboard **nunca escribe** directamente en Postgres como si fuera la
  fuente principal de un dato comercial — Postgres puede reconstruirse
  siempre desde GHL vía `reconcileGrowth()`.

## 3. Modelo de datos GROWTH (Postgres)

Ver `db/growth-schema.sql` para el esquema completo y comentado. Resumen:

- `growth_opportunities` — una fila por oportunidad de GHL (no por evento:
  cambios de fase, no-shows, reprogramaciones, etc. actualizan la misma
  fila). Columnas clave: `pipeline_stage_id`, `status` (open/won/lost/
  abandoned, valor real de GHL), `closer_id`, `asistio_reunion`,
  `proximo_paso`, `entry_month`/`entry_at` (congelados la primera vez que se
  ve el lead — cohorte, no se recalculan), `pagado_confirmado_at` (congelado
  la primera vez que entra en fase Pagado), `follow_up_due_at` (due date de
  la tarea de GHL más próxima sin completar).
- `growth_appointments` — historial de citas. Una reprogramación no borra la
  fila anterior; una reunión 2 es una fila nueva con `meeting_number = 2`
  sobre la misma oportunidad. `is_active` marca cuál es la cita vigente.
- `growth_audit_log` — quién cambió qué campo, desde dónde (`dashboard` /
  `ghl_reconciliation` / `ghl_webhook`), y si la escritura en GHL salió bien.
- `growth_webhook_events` — deduplicación de webhooks (ver §7, inactivo).
- `growth_closers` — equipo comercial visible en el dashboard, gestionable
  desde "Gestión de closers".

**Patrón de columna "write-once, congelada la primera vez"**: `entry_at` y
`pagado_confirmado_at` usan `coalesce(tabla.columna, excluded.columna)` en el
`ON CONFLICT DO UPDATE` del sync — nunca se leen desde un mapa JS de "valores
existentes" (falló en la práctica: una columna añadida después de que ya
hubiera filas no se puede rellenar así, porque el primer insert de esas filas
ya pasó sin ella). Cualquier columna nueva con esta misma necesidad debe
seguir el patrón SQL, no el JS.

### 3.1 Columnas añadidas 2026-08-21 (speed to lead + follow-ups editables)

- `follow_up_title` / `follow_up_task_id` (`growth_opportunities`): título
  (texto libre) e id real de la tarea de GHL que resuelve `follow_up_due_at`.
  A diferencia de `entry_at`/`pagado_confirmado_at`, **no son "write-once"**:
  se sobrescriben en cada sync porque reflejan la tarea pendiente vigente, no
  un hecho congelado. `follow_up_task_id` es lo que permite editar/completar
  la tarea correcta en vez de crear una nueva (ver §7).
- `first_contact_at` (`growth_opportunities`, congelada la primera vez,
  mismo patrón `coalesce` que `entry_at`): mejor aproximación disponible al
  momento del primer contacto real con el lead — se fija la primera vez que
  "Próximo paso" tiene un valor distinto de `null`/"No definido". GHL no
  expone la fecha de cambio de un custom field concreto (solo
  `lastStageChangeAt`, que es de FASE), así que se usa ese valor como proxy,
  con la hora del sync como respaldo. Alimenta "Tiempo medio de primer
  contacto" y "Esperando desde" en el bloque Leads sin reunión
  (`lib/growth/metrics.ts` vía `app/api/growth/metrics/route.ts`).
- **"Responsable de contacto" vs "Closer" — misma columna (`closer_id`),
  etiqueta distinta según el momento.** No se creó un campo/rol nuevo en GHL
  ni en Postgres: antes de que exista una cita activa, `closer_id` viene de
  `assignedTo` de la oportunidad (nadie ha dado una reunión todavía) y se
  muestra como "Responsable de contacto" (bloque Leads sin reunión); en
  cuanto hay una cita activa, `closer_id` pasa a venir del
  `assignedUserId` del evento de calendario y se muestra como "Closer"
  (Agenda, Comparativa). Es el mismo patrón que ya reflejaba el nombre real
  del calendario de Alejandro en GHL ("Alejandro Setter-Closer") — no una
  distinción inventada por el dashboard.

## 4. Campos y etapas reales de GHL (resumen — IDs en `GROWTH_MAPPING.md`)

Todos verificados contra la API real de GHL (no adivinados):

- **Pipeline GROWTH**, 8 etapas fijas: Nuevo cualificado | Sin agenda →
  Agendado (Pendiente/Confirmado) → Solicita Reagendar / No-show |
  Recuperación → Reunión realizada | Interesado → Follow-up / Call 2 →
  Pagado. `GROWTH_STAGES` / `GROWTH_STAGE_NAMES` en `lib/growth/ghl.ts`.
- **Custom fields de la oportunidad**: `asistioReunion` (picklist Sí/No/
  Pendiente), `proximoPaso` (picklist de 7 valores reales — ver
  `PROXIMO_PASO_VALUES`), `fechaReunionAgendada`, `pdfPrecall`,
  `decisionMaker`, `objecionPrincipal`.
- **Fecha y acción concreta de un follow-up**: NO existe un custom field
  dedicado en GHL (comprobado con `locations/get-custom-fields`). Se
  reutilizan las **Tareas nativas del contacto** — el `dueDate` de la tarea
  pendiente más próxima es la fecha de seguimiento, y el `title` de esa
  tarea es la acción concreta en texto libre. El panel de revisión crea la
  tarea (`createContactTask`, `lib/growth/ghl.ts`); el sync solo la lee
  (`fetchContactTasks`, `resolveFollowUpDueAt`). No se ha creado ningún
  campo nuevo para esto — se decidió reutilizar lo que ya existe.
- **Calendarios**: cada closer tiene su propio calendario de GHL (no
  comparten uno común — confirmado con un intento real de cruzar closer/
  calendario, que GHL rechazó). `CLOSER_CALENDAR_MAP` en `lib/growth/ghl.ts`.
- **Fuente real de citas**: el endpoint `/calendars/events`, no el campo
  `calenders` embebido en `opportunities/search` (ese último no refleja
  citas creadas por API, solo las creadas desde la ficha de la oportunidad
  en GHL — comprobado con una prueba real).

## 5. Modelo de edición: panel único, nada se envía sin confirmar

Desde la revisión de 2026-08-21, **no existen acciones de un clic** sobre
una fila de la Agenda o de Follow-ups. Todo pasa por un único botón
"Revisar / actualizar" que abre `GrowthEditPanel`
(`components/growth/GrowthEditPanel.tsx`):

1. Los cambios (closer, resultado de la reunión, reprogramar, próximo paso,
   etapa manual, follow-up, marcar pagado) se acumulan solo en estado local
   de React — **ninguna petición sale hacia GHL** mientras se edita.
2. "Guardar cambios" valida (fecha+acción obligatorias si el próximo paso
   requiere seguimiento; fecha obligatoria si se abrió "Reprogramar") y pasa
   a una pantalla de **resumen de cambios** (diff antes/después), con aviso
   reforzado y checkbox de confirmación aparte cuando se va a marcar
   **Pagado**.
3. Solo "Confirmar y guardar" ejecuta las llamadas reales a
   `/api/growth/opportunity`, en orden (closer → resultado → reprogramar →
   próximo paso → etapa manual → follow-up → pagado), una por cada campo que
   cambió. Cada paso se ejecuta aunque uno anterior falle, y el resultado
   final muestra qué se guardó y qué no (guardado parcial explícito, nunca
   silencioso).
4. Cerrar el panel con cambios sin guardar pide confirmación explícita de
   descarte.
5. **Perdido** y **Abandonado** viven en una sección colapsada "Acciones
   sensibles" dentro del panel — nunca como enlace directo en una tabla.
   Archivan la oportunidad (deja de contar en agenda/funnel del periodo) sin
   borrar su historial.

El endpoint `app/api/growth/opportunity/route.ts` sigue siendo la única
puerta de escritura hacia GHL; cada acción ahí es idempotente donde aplica
(p. ej. `pagado` no vuelve a escribir ni auditar si la oportunidad ya está en
esa fase).

## 6. Definiciones de métricas

- **Show rate** = asistieron / reuniones "celebrables" (con hora ya pasada,
  para no penalizar citas futuras que aún no han podido celebrarse).
- **Close rate** = ventas pagadas / asistieron.
- **Venta confirmada** (`isVentaConfirmada`) = la oportunidad está en la fase
  **Pagado** del pipeline. Deliberadamente NO se usa `status === "won"` en
  solitario, porque un "Ganado" puede marcarse sin pasar por Pagado — ese
  caso se detecta aparte (`isGanadoSinPagado`) y se avisa en el dashboard sin
  contarlo como venta hasta revisar.
- **RowStatus de una fila de Agenda**: `pendiente_vencido` (cita ya pasada
  sin resultado) > `pendiente_paso` (asistió pero sin próximo paso
  definido) > `futura` (informativa) > `trabajada` (verde, ya resuelta).
  Ámbar = pendiente de revisar, verde = actualizado, gris = futuro, **rojo
  reservado solo para errores de sincronización** — nunca para un no-show ya
  procesado correctamente.
- **Cola de Follow-ups**: 3 cajones relativos al periodo activo (Hoy/Semana/
  Mes) — *Vencidos* (fecha ya pasada, respecto a ahora, sin importar el
  periodo visible), *en el periodo* (cae dentro de la ventana activa) y
  *sin fecha* (ninguna tarea pendiente con due date). Candidatos: leads
  abiertos cuyo Próximo paso está en `FOLLOW_UP_REQUIRED_STEPS`.
- **Periodo unificado** (`lib/growth/period.ts`, `resolvePeriod`): Hoy/
  Semana/Mes calculan un único `{start, end}` en huso horario Madrid,
  consumido por agenda, funnel del periodo, comparativa por closer,
  follow-ups y leads — así ningún bloque puede desincronizarse del selector.

## 7. Limitaciones conocidas

- **Webhook de GHL inactivo.** `app/api/growth/webhook/route.ts` está
  completo y listo (idempotente por `event_id` y por upsert), pero GHL no
  puede alcanzar una URL en localhost — hace falta un dominio público
  (despliegue) y crear el Workflow correspondiente en GHL. Mientras tanto,
  la sincronización ocurre en cada carga de `/api/growth/metrics` y bajo
  demanda con el botón "Actualizar" (`reconcileGrowth`).
- **RESUELTO (2026-08-21): las tareas de follow-up ya se editan y completan
  desde el dashboard.** `growth_opportunities.follow_up_task_id` guarda el id
  real de la tarea de GHL que resuelve el follow-up vigente; el panel de
  revisión, al abrirse desde una fila de Follow-ups o de Leads sin reunión,
  precarga esa fecha/acción y permite: (a) editarlas — hace un PUT sobre la
  MISMA tarea (`updateContactTask`, `lib/growth/ghl.ts`), nunca crea una
  duplicada — o (b) marcarla "Completado" (`action: "followUpComplete"`,
  `app/api/growth/opportunity/route.ts`). Solo se crea una tarea nueva
  (`createContactTask`) cuando la oportunidad no tenía ninguna pendiente
  todavía. Probado en real: completar una tarea existente y volver a crear
  una nueva sobre la misma oportunidad no duplica nada (confirmado
  reconciliando dos veces seguidas, `cambiosDetectados: 0`).
- **El selector de mes del resumen GROWTH en el dashboard financiero es
  independiente del selector de "Editar ingresos por mes".** El primero usa
  meses de calendario (`YYYY-MM`, vía `lib/growth/period.ts`); el segundo usa
  los nombres de pestaña del Sheet (p. ej. "AGOSTO"), que son un sistema de
  periodos de negocio distinto y no necesariamente alineado 1:1 con el
  calendario. Mapearlos a la fuerza podría mostrar el mes equivocado si el
  año fiscal del Sheet no coincide — se prefirió mantenerlos separados y
  explícitos antes que adivinar la correspondencia.
- **Volumen real todavía bajo.** El pipeline GROWTH se creó el 2026-08-14;
  los mapeos de campos/etapas están verificados contra la API real pero no
  contra volumen de producción alto.
- **`GROWTH_MAPPING.md` vs este documento**: `GROWTH_MAPPING.md` es la
  referencia exhaustiva de IDs reales (pipeline, etapas, campos,
  calendarios); este documento es el resumen operativo y de arquitectura.
  Si cambian IDs reales en GHL, se actualiza primero `GROWTH_MAPPING.md` y
  luego se refleja aquí si afecta a la explicación general.

## 8. Cómo probar cambios

- **Nunca probar escrituras contra contactos/oportunidades reales.** Usar
  fixtures marcados "TEST - No usar" en GHL para cualquier prueba que
  escriba (cambiar fase, marcar asistencia, crear cita, crear tarea).
- **Fixture de prueba "TEST DASHBOARD — Follow-up"** (creado 2026-08-21 para
  verificar de extremo a extremo el bloque de follow-ups): contacto sin
  teléfono ni email (creado así a propósito — sin canal de contacto, ningún
  workflow puede enviarle nada), empresa "PRUEBA INTERNA CLOSEUP",
  responsable inicial Alejandro. IDs reales (sin datos personales):
  `contactId=8UQuwovLOPM1njC4uV6o`, `opportunityId=ph3f4yhWoUdKixOTaf9r`.
  Vive en fase "Nuevo cualificado | Sin agenda" con "Próximo paso = Follow-up"
  y una tarea nativa de GHL pendiente — reutilizar esta misma oportunidad
  (por nombre exacto, `fetchGrowthOpportunities().find(o => o.name === "TEST
  DASHBOARD — Follow-up")`) para cualquier prueba futura del bloque de
  follow-ups o de Leads sin reunión, en vez de crear una nueva. `lib/growth/
  ghl.ts` expone `createContact`/`createOpportunity`/`searchContacts` por si
  hace falta otro fixture — GHL exige `firstName`+`lastName` o
  email/teléfono para crear un contacto (comprobado en real: rechaza un
  contacto sin ninguno de los dos con 422).
- Tras cualquier prueba de escritura, revertir el estado y verificarlo antes
  de dar la prueba por terminada.
- Antes de disparar cualquier acción que pueda activar una automatización
  real de GHL (SMS/WhatsApp/email a un contacto), confirmar primero quién lo
  recibiría y las consecuencias — no lanzar mensajes de prueba sin controlar
  eso.
- `npx tsc --noEmit -p .` y `npx eslint <rutas>` antes de dar por buena
  cualquier tanda de cambios de código.
- El botón "Actualizar" del dashboard comercial fuerza una reconciliación
  completa contra GHL — útil para comprobar que un cambio se refleja de
  verdad, no solo en el estado local de React.

## 9. Mantenimiento

- Los valores de picklist de GHL (`PROXIMO_PASO_VALUES`,
  `ASISTIO_REUNION_VALUES`) están duplicados intencionalmente en
  `components/growth/GrowthEditPanel.tsx` porque `lib/growth/ghl.ts` es
  código de servidor (usa credenciales) y no debe importarse en un
  componente cliente. Si cambian en GHL, hay que actualizar los dos sitios.
- Si se añade una etapa o un campo nuevo en el pipeline GROWTH, hay que:
  1. Verificarlo contra la API real (no adivinar el ID).
  2. Actualizarlo en `GROWTH_MAPPING.md` y en `lib/growth/ghl.ts`.
  3. Revisar si `GrowthEditPanel.tsx` necesita reflejarlo en sus dropdowns.
- El despliegue a un dominio público (Vercel u otro) sigue sin estar
  autorizado — es una decisión explícita pendiente, no algo que deba
  asumirse como parte de una tarea de mejora del dashboard.

## 10. Centro comercial (`/growth/documentacion`) — reconstruido 2026-08-23

Antes era un "Centro de documentación comercial" (lista de PDFs agrupados
por categoría). Se reconstruyó por completo como **Centro comercial**:
accesos rápidos + acordeones por situación de uso, siguiendo el principio
"la persona no piensa en qué carpeta está el documento, piensa en qué
necesita" (presentación / contrato / pago / pre-call / guía / pipeline).

**Estructura** (`app/growth/documentacion/page.tsx`, client component,
acordeón de un solo bloque abierto a la vez, estado local `open`):

1. **Accesos rápidos** (barra superior, 4 botones pequeños): Presentación,
   Contrato, Pago — hacen scroll + abren su sección (están pendientes, ver
   abajo, por eso llevan borde discontinuo + punto gris) — y Pre-Call, que
   sí abre el PDF real directamente.
2. **Dashboard** — guía de uso de este mismo dashboard (abierto por
   defecto).
3. **Guía comercial** — el documento "Proceso comercial — Setter + Closer"
   (ver abajo) + un sub-bloque **Mapa del pipeline**, construido en línea
   con las 8 etapas reales del pipeline GROWTH (nombre + "cuándo se
   utiliza"), en vez de crear otro PDF — texto tomado literalmente de la
   sección 4 del propio documento "Proceso comercial", que ya usa el
   pipeline real de GHL, no un esquema teórico. No se creó ningún archivo
   nuevo para esto; es contenido estático en el componente (mismo patrón
   que los picklists duplicados en `GrowthEditPanel.tsx`, ver §9).
4. **Presentación de ventas** — sin recurso real todavía (ver más abajo).
5. **Pre-call** — `+Reformas System.pdf` (ver mapeo de archivos).
6. **Contratos** — sin recurso real todavía (ver más abajo).
7. **Pagos** — sin recurso real todavía (ver más abajo).
8. **Automatizaciones** — Comunicación del embudo — Workflows, al final de
   la jerarquía a propósito (documento interno, no debe competir
   visualmente con presentación/contrato/pago/pre-call).

**Eliminado**: "Manual del Setter — Reformas" (`manual-setter-reformas.
{pdf,html}`) — borrado de `public/materiales-comerciales/` y de toda la
navegación. Sustituido por el documento real "Proceso comercial — Setter +
Closer" (`guia-comercial-setter-closer.pdf`), que además ya usa
explícitamente el pipeline real de GHL en vez del esquema teórico que
manejaba el manual antiguo.

**Mapeo de archivos reales usados** (todos verificados byte a byte contra
el Drive ID que dio Daniel, mismo `fileSize`/`modifiedTime` — no se ha
vuelto a descargar nada, las copias locales ya estaban al día):

| Recurso en el Centro comercial | Archivo servido | Drive ID de origen |
|---|---|---|
| Proceso comercial — Setter + Closer | `guia-comercial-setter-closer.pdf` | `1ltiF8nS2jzjocW5GeUeRyXZeD_lsWdWe` |
| +Reformas System — Pre-Call | `mas-reformas-system.pdf` | `18kWfP4MMLGXn1mhOEFApi-zSc2QYkuOi` |
| Comunicación del embudo — Workflows | `embudo-comunicacion-workflows.{html,pdf}` | `19LYNPLutSwrCcNH92SR42UXVutnYqyyQ` |

**Pendiente de que Daniel confirme y añada (deliberadamente sin inventar
nada aquí, per regla explícita del brief "no inventar enlaces")**:

- **Presentación de ventas** — no se encontró ningún archivo identificable
  como "BORRADOR 1" ni ningún material distinto del Pre-Call que sirva como
  presentación a usar durante la llamada. Sección muestra un estado
  "Pendiente de configurar" explícito, sin enlace.
- **Contratos — RESUELTO (2026-08-23).** El archivo candidato de julio
  (`Servicio leads/CONTRATO Closeup Growth System - PLANTILLA.pdf`, de un
  contexto distinto) quedó descartado sin usarse, como se documentó. Daniel
  confirmó los contratos reales de **+Reformas System** — dos versiones
  finales (pago único 2.997 €+IVA y pago fraccionado 1.500 €+IVA de
  entrada), un generador HTML que los rellena con los datos del cliente, y
  un prompt maestro alternativo para generarlo vía IA si no se puede usar
  el generador. Los 4 archivos llegaron ya copiados en
  `public/materiales-comerciales/` (`contrato-reformas-system-2997.pdf`,
  `contrato-reformas-system-1500.pdf`,
  `generador-contrato-reformas-system.html`,
  `prompt-maestro-contrato-reformas-system.txt`) junto con un prompt
  (`PROMPT_DASHBOARD_Seccion_Contratos.txt`, en
  `CLOSEUP_JAVIER_GROWTH_SALES_SYSTEM/materiales_venta/`) con el cambio de
  código exacto — aplicado tal cual, sin desviaciones: 4 `<Resource>`
  nuevos en el Accordion `contratos` (pago único, pago fraccionado,
  generador, prompt maestro) y `pending: true` quitado de la entrada
  "Contrato" en `QUICK_LINKS`. El bloque "Datos que hay que pedir al
  cliente" y "Firma electrónica" no se tocaron.
  - **Bug real encontrado y corregido en el generador** (`generador-
    contrato-reformas-system.html`, y su fuente
    `CLOSEUP_JAVIER_GROWTH_SALES_SYSTEM/materiales_venta/
    Generador_Contrato_Reformas_System.html`, ambos actualizados): el
    bloque "Forma de pago fraccionada" y su cláusula de impago (clase CSS
    `.frac-only`) solo se mostraban/ocultaban dentro de `generarContrato()`,
    que corta en seco con "Faltan datos: ..." si falta cualquiera de los 6
    campos del cliente — así que cambiar el radio de pago único/fraccionado
    no tenía ningún efecto visible hasta rellenar todo el formulario y
    pulsar "Generar contrato". Se separó esa lógica en una función propia
    `actualizarFormaPago()`, enganchada a `change` de los dos radios y
    ejecutada también al cargar la página — ahora el contrato se ve
    diferente en cuanto se cambia la opción de pago, sin depender de tener
    los datos del cliente rellenos. Verificado con JS directo en consola
    (`getComputedStyle(...).display`), no solo visualmente — el snapshot de
    accesibilidad de la herramienta de navegador usada en esta sesión no
    refleja `display:none`, así que no sirve para confirmar visibilidad
    real en este tipo de comprobación.
  - **Contenido del contrato 1.500 € actualizado (2026-08-23, a petición de
    Daniel)**: el "2º pago (resto)" pasó de "Hasta completar 2.997 € + IVA"
    a explicitar el importe real, "1.497 € + IVA" (mismo valor que ya
    aparecía como cuota de continuidad, pero como concepto distinto: aquí
    es el segundo plazo del pago fraccionado, no la mensualidad tras los 15
    presupuestos — coincide en cifra por diseño del pricing, no es un
    error). Se eliminó la cláusula de interés de demora/costes de recobro
    y se sustituyó por una consecuencia simple: si no llega el segundo pago
    en 30 días, se pausan las campañas y se cancela el sistema. Editado en
    los 3 sitios donde vive este texto — `Contrato_+Reformas_System_
    CloseUp_FINAL_1500.html` (fuente del contrato standalone),
    `Generador_Contrato_Reformas_System.html` (fuente del generador) y su
    copia `public/materiales-comerciales/generador-contrato-reformas-
    system.html` — y el PDF `contrato-reformas-system-1500.pdf` se
    regeneró con Puppeteer (mismo patrón que `scripts/generate-manual.js`:
    `format: 'A4', printBackground: true, preferCSSPageSize: true`) y se
    resincronizó a `public/materiales-comerciales/`. **No se ha tocado el
    `.docx`** (`Contrato_+Reformas_System_CloseUp_FINAL_1500.docx`) — no
    hay herramienta en este entorno para editarlo de forma fiable; si se
    sigue usando ese formato hay que actualizarlo a mano con el mismo
    texto antes de enviarlo a un cliente.
- **Pagos — RESUELTO (2026-08-23).** Daniel añadió
  `CloseUp_+Reformas_System_Guia_Pagos.pdf` (y su equivalente
  `guia_pagos_reformas_system.html`, con los 3 enlaces reales de Stripe
  como `<a href>` navegables) en
  `CLOSEUP_JAVIER_GROWTH_SALES_SYSTEM/materiales_venta/`. Copiado a
  `public/materiales-comerciales/guia-pagos-reformas-system.{html,pdf}` y
  enlazado tanto en el acceso rápido "Pago" como en el acordeón "Pagos". El
  documento está marcado "USO INTERNO · No compartir con el cliente" en su
  propia cabecera (IBAN, titular de cuenta y enlaces de cobro) — coherente
  con que el Centro comercial es una herramienta interna en localhost, no
  algo expuesto a clientes.

Cuando Daniel confirme estos tres materiales, añadir el archivo real a
`public/materiales-comerciales/` y sustituir el `<PendingBadge />` por un
`<Resource>` con `<OpenButton>`/`<CopyButton>` en
`app/growth/documentacion/page.tsx` — el patrón ya está armado, solo falta
el contenido real.

- Los archivos son **copias locales** servidas como estáticos de Next.js en
  `public/materiales-comerciales/` (incluye `assets/` con las capturas
  reales de la guía) — no se leen en vivo desde Drive ni desde
  `CLOSEUP_JAVIER_GROWTH_SALES_SYSTEM/`. Si el material original cambia, hay
  que volver a copiar el archivo a esa carpeta.
- Al no estar desplegado el dashboard, estos archivos solo son accesibles en
  localhost — si en algún momento se autoriza un despliegue público, revisar
  primero si conviene que estos materiales comerciales sean públicos o si
  hace falta protegerlos de otra forma (no son secretos, pero tampoco están
  pensados para circular fuera del equipo).

## 11. Rediseño visual (2026-08-21)

`/growth` y `/growth/documentacion` usan ahora `.growth-section` /
`.growth-section-title` (`app/globals.css`) para una tarjeta con sombra
(`--card-shadow`/`--card-shadow-hover`, ya validados en claro y oscuro) y un
acento de color por sección, en vez del borde plano anterior. La paleta de
marca (naranja `--brand` + tokens de estado) no cambió — el rediseño es de
jerarquía y elevación, no de color. Los tiles de `GrowthMetricsCompact`
llevan una barra de acento lateral por categoría (Reuniones/Ventas en
naranja, Asistencia en verde).

**Aviso para la próxima sesión que edite estilos de este proyecto**: si una
clase de Tailwind nueva (p. ej. `gap-5`) no genera CSS aunque el código esté
bien escrito, no es necesariamente un bug de código — puede ser la caché de
Turbopack (`.next/`) sin re-escanear el contenido nuevo. Se confirmó en real
el 2026-08-21: `gap-5` no compilaba tras un simple reinicio de `npm run dev`,
y solo se resolvió borrando `.next/` por completo antes de reiniciar.
Verificar con `getComputedStyle` en la consola antes de asumir que el CSS
está mal escrito.

## 12. Bug real encontrado y corregido (2026-08-23): orden de Follow-ups

`computeFollowUpQueue` (`lib/growth/metrics.ts`) ordenaba los cajones
"Vencidos" y "en el periodo" con `(a.dueAt ?? "").localeCompare(...)`,
asumiendo que `dueAt` siempre es un `string`. **`@neondatabase/serverless`
devuelve las columnas `timestamptz` (como `follow_up_due_at`) como objetos
`Date` nativos de JS, no strings** — comprobado contra el driver real
(`node_modules/@neondatabase/serverless`, parser de tipo OID 1184). Con un
solo follow-up con fecha en el cajón, `Array.prototype.sort` nunca llega a
invocar el comparador, así que el bug se quedó agazapado desde que se creó
esta función — solo se manifestó cuando un uso real del dashboard (un
segundo follow-up guardado sobre una oportunidad distinta, en el mismo
cajón "Vencidos") forzó una comparación real, y `/api/growth/metrics`
empezó a devolver `UPSTREAM_ERROR` con el dashboard entero caído.

**Corregido** comparando por `new Date(x).getTime()` en vez de
`localeCompare` — funciona igual reciba `Date` o `string`. El resto del
código ya toleraba esto porque casi todo pasa el valor por `new Date(x)`
antes de usarlo (que acepta tanto `Date` como `string`); `localeCompare` era
el único punto que operaba sobre el valor "en crudo" asumiendo texto. Se
revisó el resto de `lib/growth/` y `app/api/growth/` en busca de otros usos
de `.localeCompare`/`.split`/`.slice` sobre campos que puedan venir de una
columna `timestamptz` — no se encontró ningún otro caso.

## 13. Simplificación UI/UX de `/growth` (2026-08-23)

Revisión completa de UI/UX del dashboard comercial pedida por Daniel: "menos
interfaz, más claridad". Sin cambios de lógica de sincronización, escritura
en GHL ni cálculo de métricas — solo presentación. Puntos clave:

- **Sistema de color reducido a 4 usos, sin leyenda permanente.** Se eliminó
  `GrowthAgendaLegend` (el bloque fijo "Ámbar/Verde/Gris/Rojo" que se mostraba
  siempre encima de la Agenda) y el uso de `--status-warning` (ámbar) como
  estado de fila en los tres bloques operativos (Agenda, Follow-ups, Leads sin
  reunión). Regla nueva, aplicada de forma consistente:
  - **Verde** (`--status-good`) = ya resuelto / resultado positivo (fila
    "trabajada" de la Agenda, tile Ventas — antes en rojo, corregido a verde
    porque representa un resultado comercial positivo, no una alerta —, badge
    "PAGADO ✓" en el panel).
  - **Rojo** (`--status-critical`) = requiere acción (falta próximo paso,
    follow-up vencido, lead sin contactar, aviso "Ganado sin Pagado" — antes
    ámbar, ahora rojo porque exige revisión —, errores de sync).
  - **Gris/negro** (`--ink*`) = informativo, sin acción requerida.
  - **Naranja** (`--brand`) = identidad/interacción (botones principales,
    filtro activo, barra de acento de sección), nunca un cuarto estado.
  - Los tokens `--status-warning`/`--status-serious` **no se han borrado** de
    `globals.css` porque el dashboard financiero (`/`) los sigue usando —
    solo se dejó de consumirlos desde los componentes de `/growth`.
  - En vez de pintar la fila entera, los estados que requieren acción usan un
    indicador discreto: una barra izquierda de 3px (`inset box-shadow`) +
    texto semántico ("Falta próximo paso", "Sin contactar"), nunca un fondo
    de fila coloreado completo.
- **Textos, no jerga de pipeline.** La columna "Estado" de la Agenda ya no
  muestra el nombre técnico de la fase de GHL (p. ej. "Reunión realizada |
  Interesado") — muestra un estado humano derivado de `attendance`
  ("Agendada" / "Reunión realizada" / "No show"). El nombre de fase completo
  sigue disponible en la cabecera del panel de edición.
- **Botones con verbo específico en vez de "Revisar / actualizar" genérico**:
  Agenda usa "Añadir próximo paso" / "Actualizar reunión" / "Editar" según
  `rowStatus`; Leads sin reunión usa "Contactar" si no ha sido contactado o
  "Actualizar" si ya lo fue; Follow-ups usa "Actualizar (vencido)" en el
  cajón de vencidos.
- **Fechas humanas** (`formatHumanDate`, `lib/format.ts`): "Hoy" / "Mañana" /
  "23 de agosto" (con año solo si no es el año en curso) en vez de fechas
  ISO. Usado en Follow-ups (columna Fecha, fusionada con la hora en una sola
  celda) y en "Esperando desde" de Leads sin reunión.
- **Tiempos de espera sin decimales** (`formatWaitTime`, `lib/format.ts`):
  "7 días" en vez de "6,9 días" para el tiempo que un closer escanea de un
  vistazo. `formatDurationMs` (con un decimal) se conserva para el agregado
  "Tiempo medio de primer contacto", donde la precisión sí importa.
  `formatWaitTime` es una función nueva, no un reemplazo — no se tocó ninguna
  llamada existente a `formatDurationMs`.
- **Columnas reducidas donde eran redundantes**: Follow-ups pasó de 8 a 6
  columnas (Fecha+Hora fusionadas; se quitó "Estado", que en esa tabla
  siempre decía "Pendiente" para toda fila — la única señal real ya la da la
  fecha en rojo del cajón "Vencidos").
- **Etiqueta "CALL 2"** en vez de "Reunión 2" en la fila de Agenda cuando
  `meetingNumber === 2` (pedido explícito del brief) — sin cambiar la lógica
  de `meetingNumber`, que sigue viniendo de `growth_appointments`.
- **`GrowthEditPanel`**: mismo flujo de edición/diff/confirmación de siempre,
  sin cambios de lógica. Solo se añadió un badge verde "PAGADO ✓" en la
  cabecera cuando `opportunity.stageId === STAGE_PAGADO`, se recoloreó de
  ámbar a rojo el aviso "este próximo paso requiere fecha y acción de
  seguimiento" (bloquea guardar, encaja en "requiere acción"), y se añadió un
  texto contextual (gris, informativo) cuando se marca "No show" recordando
  las tres salidas posibles (reprogramar / follow-up / acciones sensibles).
- **Guía de uso reescrita por completo** (de 8 páginas técnicas a 6,
  escrita para setters/closers sin vocabulario de desarrollador). Vuelta a
  reescribir el 2026-08-23 con una organización distinta (por etapa real
  del pipeline en vez de por función del dashboard) — ver §14, que
  documenta la versión vigente.
- **No se tocó**: `lib/growth/sync.ts`, `lib/growth/ghl.ts`, `lib/growth/
  view.ts`, `lib/growth/metrics.ts`, ninguna ruta de `app/api/growth/*`, ni
  IDs/mappings de `GROWTH_MAPPING.md`. El cálculo de `rowStatus`, los
  cajones de Follow-ups, el filtro de Leads sin reunión y el modelo
  "panel único, nada se envía sin confirmar" (§5) siguen siendo exactamente
  los mismos — la revisión fue estrictamente de presentación.
- Verificado en real (localhost, sin desplegar): `npx tsc --noEmit` y
  `npx eslint components/growth app/growth lib/format.ts` limpios; probado en
  navegador a 1920×1080 y 1366×768 con datos reales del pipeline (incluye el
  fixture "TEST DASHBOARD — Follow-up" del §8, que sigue sirviendo para
  reproducir el estado "follow-up vencido" sin tocar contactos reales), panel
  de edición abierto y cerrado sin guardar cambios sobre una oportunidad real
  para confirmar que el rediseño no afecta el flujo de guardado.

## 14. Guía de uso v2 (2026-08-23) — organizada por situación del pipeline

Segunda reescritura de la guía el mismo día, a petición explícita de
Daniel: la v1 (§13) organizaba por bloques del dashboard; esta versión
organiza por **la situación real del contacto en el pipeline** — la
pregunta que responde cada página es "¿en qué situación está este
contacto y qué tengo que hacer ahora?", no "¿qué hace este botón?".

- **Fuente**: `docs/guia-uso-dashboard-comercial.html`, sincronizada en
  `public/materiales-comerciales/guia-uso-dashboard-growth.{html,pdf}` +
  `docs/assets/guia-0{1..5}-*.{jpg,png}` (capturas), también copiadas en
  `public/materiales-comerciales/assets/`.
- **6 páginas** (portada + 5): 1) qué es el dashboard + regla ESTADO+
  RESPONSABLE+PRÓXIMA ACCIÓN+FECHA + los 4 bloques con captura real
  numerada; 2) las 3 etapas antes de la reunión (Nuevo cualificado|Sin
  agenda → Agendado|Pendiente confirmación → Agendado|Confirmado); 3) árbol
  de decisión ¿ASISTIÓ? (CSS puro, sin librería de diagramas — es un HTML
  estático impreso a PDF) + los 4 casos de "asiste" + captura del panel con
  callouts numerados 1-5; 4) los 5 casos de no-show/reagenda/follow-up
  ("me dice que le llame la semana que viene", etc.) + captura del bloque
  Follow-ups; 5) las 7 reglas de uso diario + tabla final "qué hago en cada
  situación" + los 4 colores (sin leyenda compleja, coherente con §13).
- **5 capturas reales** del dashboard ya rediseñado (no mockups), tomadas
  con `mcp__claude-in-chrome` contra `localhost:3000/growth` en vivo:
  dashboard completo, bloque Agenda, bloque Follow-ups, y el panel de
  edición en dos crops (campos de reunión/follow-up, y Guardar cambios).
  Los callouts numerados son `<span class="badge">` posicionados con
  `left/top` en **porcentaje** sobre un contenedor `position:relative` del
  mismo tamaño que la imagen — así el badge queda alineado sea cual sea el
  ancho final de render (pantalla o PDF). Los porcentajes se calcularon a
  mano a partir de las coordenadas de captura; si se vuelve a capturar una
  pantalla distinta hay que recalcularlos, no reusar los mismos números.
- **Gotcha encontrado con la herramienta de captura**: `computer` acción
  `zoom` con una región de la ventana completa (viewport casi tan alto como
  la región pedida) devolvió una imagen con contenido duplicado/superpuesto
  en la parte inferior — parece un problema de la propia herramienta al
  capturar una región grande, no del dashboard. Se resolvió usando la
  acción `screenshot` normal (con `save_to_disk: true`) para la captura de
  pantalla completa, y reservando `zoom` para recortes pequeños de un solo
  bloque (que sí funcionaron limpios en todos los casos). Si una captura
  futura sale con contenido repetido, probar `screenshot` en vez de `zoom`
  antes de asumir que es un bug del dashboard.
- **Documentos de Drive verificados, no descargados de nuevo**: los 3 IDs
  de Drive que dio Daniel (`1ltiF8nS2jzjocW5GeUeRyXZeD_lsWdWe`,
  `19LYNPLutSwrCcNH92SR42UXVutnYqyyQ`, `18kWfP4MMLGXn1mhOEFApi-zSc2QYkuOi`)
  ya existían en local con **el mismo `fileSize` exacto** que en Drive — se
  usaron las copias locales tal cual, sin re-descargar nada. El contenido
  completo de la guía "Proceso comercial — Setter + Closer"
  (`1ltiF8nS2jzjocW5GeUeRyXZeD_lsWdWe`) se leyó vía Drive para extraer la
  tabla oficial de 8 etapas del pipeline (sección "4. Pipeline real y
  automatizaciones" de ese documento) — es la fuente de la tabla que
  aparece tanto en la página 2 de esta guía como en "Mapa del pipeline" del
  Centro comercial (§10), para que ambos usen exactamente el mismo texto
  que el equipo comercial ya conoce.

## 15. Tarjetas de KPIs del bloque superior (2026-08-24)

`components/growth/GrowthMetricsCompact.tsx` — cambio puramente
presentacional, sin tocar `lib/growth/metrics.ts` ni `app/api/growth/
metrics/route.ts`: `PeriodFunnel` ya traía todos los campos necesarios
(`reunionesRealizadas` ya era, semánticamente, el número de "asistidas" —
solo faltaba mostrarlo en la tarjeta Asistencia).

- **Asistencia** pasó de 2 a 3 métricas: Show rate, **Asistidas**
  (`reunionesRealizadas`, el mismo valor que ya se mostraba como
  "Realizadas" en Reuniones — coincide a propósito, mismo campo con
  etiqueta distinta según la tarjeta, mismo patrón que "Responsable de
  contacto" vs "Closer" del §3.1), No shows.
- **Ventas** se simplificó a 2 métricas en el orden Close rate → Ventas
  (antes iba Pagadas → Close rate, en ese orden y con el color en el
  campo equivocado). No se añadió "No ventas" ni ninguna métrica extra.
- **Se eliminó la barra de acento lateral** (`<span
  class="absolute left-0 top-0 h-full w-1">`) de las 3 tarjetas — pintaba
  la tarjeta entera de un color por su categoría, lo cual leía como un
  estado de toda la sección. El color ahora vive solo en el valor
  numérico de los KPIs de tasa (Show rate, Close rate, y Agendadas por
  identidad de marca) — los valores absolutos (Realizadas, Asistidas, No
  shows, Ventas) se quedan en `--ink` (negro/grafito), sin excepción.
- Cada tarjeta usa `display: grid` con `grid-template-columns:
  repeat(N, minmax(0, 1fr))` (N=2 en Reuniones y Ventas, N=3 en
  Asistencia) en vez del `flex` anterior — columnas de ancho igual
  garantizado en vez de que el contenido más corto (Ventas) deje hueco a
  la derecha. Las tres tarjetas siguen teniendo la misma altura porque
  siguen siendo celdas de la misma fila del grid exterior
  (`md:grid-cols-3`), sin necesidad de fijar altura a mano.
- Labels subidos de `text-xs` (12px) a 13px — pedido explícito de
  legibilidad, sin tocar el tamaño de los valores (28px) ni de los
  títulos de tarjeta.
- No se ha introducido ningún threshold de color (verde/naranja/rojo
  según valor) — el color de Show rate/Close rate es fijo
  (`--status-good`), igual que antes; no existía esa lógica en el sistema
  y no se ha inventado.
- Verificado con datos reales (`MES · AGOSTO 2026`): Realizadas=Asistidas=1
  en ambas tarjetas, Show rate 100% coherente con 1 asistida / 0 no
  shows, Close rate 0% coherente con 0 ventas / 1 asistida. `npx tsc
  --noEmit` y `npx eslint components/growth/GrowthMetricsCompact.tsx`
  limpios.

## 16. Bug real de mobile encontrado y corregido (2026-08-24): `<main>` sin `w-full`

Al revisar `/growth` en móvil se encontró un bug estructural real, no solo
cosmético: en pantallas estrechas, **toda la página se desbordaba
horizontalmente** en vez de que las tarjetas/tablas se apilaran dentro del
ancho disponible.

**Causa raíz**: `app/layout.tsx` pone `<body className="min-h-full flex
flex-col">`. Dentro de un `flex flex-col`, un hijo con `mx-auto` (como
`<main className="mx-auto max-w-6xl px-6 py-8">`, sin `w-full`) usa
márgenes automáticos para centrarse — y los márgenes automáticos en el eje
cruzado de flexbox **anulan `align-items: stretch`**, así que `<main>` deja
de heredar el ancho del contenedor y en su lugar se dimensiona a su
contenido (shrink-to-fit), acotado solo por `max-w-6xl` (1152px) hacia
arriba, sin límite inferior real. Como dentro hay tablas con columnas de
ancho fijo (`colgroup` en rem — Follow-ups, Leads sin reunión), `<main>`
crecía para acomodarlas en vez de encogerse al ancho real del móvil, y
**los envoltorios `overflow-x-auto` de esas tablas (ver §13) no servían de
nada** porque nunca llegaban a ser más estrechos que su contenido — el
`<main>` que los contenía ya se había ensanchado antes.

**Corregido**: `mx-auto max-w-6xl` → `mx-auto w-full max-w-6xl` en el
`<main>` de `app/growth/page.tsx` y `app/growth/documentacion/page.tsx`.
Con `width:100%` explícito, `<main>` ya no depende del comportamiento de
shrink-to-fit — ocupa el ancho real disponible, y a partir de ahí los
`overflow-x-auto` de las tablas sí funcionan como estaba previsto (scroll
horizontal contenido dentro de la tarjeta, en vez de desbordar toda la
página).

**Cómo se verificó** (sin depender de `resize_window`, que en este entorno
no cambia el viewport real — comprobado con `window.innerWidth` quedándose
en 1920 pese a pedir tamaños más pequeños): se inyectó un `<style>` vía
`javascript_tool` forzando `html, body { width: 390px !important;
overflow-x: hidden !important }` más un override de `.md\:grid-cols-3` a
una columna, y se midió con `getBoundingClientRect()`/`scrollWidth` en vez
de fiarse solo de capturas de pantalla (que en esta sesión mostraron algún
artefacto de renderizado puntual). Antes del fix: `<main>` medía 762px
dentro de un `<body>` de 390px (desbordado). Después: `<main>` = 390px,
`body.scrollWidth` = 390px (sin overflow), y el envoltorio de la tabla de
Follow-ups pasó de 664px a 292px con scrollbar horizontal propia y
funcional.

**No se ha tocado** `app/page.tsx` (dashboard financiero) — usa el mismo
patrón `mx-auto max-w-6xl` sin `w-full` y probablemente tiene el mismo
problema si contiene tablas anchas, pero no estaba en el alcance de esta
tarea (solo Dashboard Comercial) y no se ha modificado sin que se pida
explícitamente.
