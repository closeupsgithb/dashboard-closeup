# Dashboard Comercial (GROWTH) — mapeo de campos, fases y métricas

Todos los IDs de este documento están verificados contra la API real de GHL
el 2026-08-20 (no son nombres visibles adivinados). Location: `gNZGfOheofHgZtuYObm7`.

## Pipeline

`GROWTH_PIPELINE_ID = Zn90LJV3N0dNlByaZ1vo` — creado 2026-08-14. En la fecha de
esta auditoría tenía 3 oportunidades, 2 de ellas contactos de prueba E2E
("TEST - No usar") — prácticamente sin histórico real todavía.

| Fase (visible) | ID |
|---|---|
| Nuevo cualificado \| Sin agenda | `267658fd-26fb-4976-9cb9-c8308fff8d20` |
| Agendado \| Pendiente confirmación | `ac3355de-a3d1-412a-8db0-75bc2e4276b8` |
| Agendado \| Confirmado | `74566df6-7f7d-4df7-a849-89689626b206` |
| Solicita Reagendar | `072230fe-3185-4871-a785-d47c028985d8` |
| No-show \| Recuperación | `a180c129-b51c-4543-b275-de7934342d1f` |
| Reunión realizada \| Interesado | `b5e8900d-65b1-4174-9f10-ce0a68fa896c` |
| Follow-up / Call 2 | `32634bf6-7aee-44f2-a9e7-196ee9e3f1d2` |
| Pagado | `4082dbca-df89-4ff0-9dd9-52b3986ee360` |

## Campos personalizados de oportunidad

| Nombre | ID | Tipo | Valores |
|---|---|---|---|
| asistio_reunion | `J54D8m3778Bu5Vninimm` | SINGLE_OPTIONS | Sí / No / Pendiente |
| fecha_reunion_agendada | `ZYQr2nc7006KhRrJBCzQ` | DATE (sin hora) | — no se usa como fuente de "próxima reunión": el dashboard usa la cita real del calendario |
| Próximo paso | `cI1rLkg3ODDh8kN8Bkzd` | SINGLE_OPTIONS | Call 2 / Hablar con socio / mujer / Follow-up / Enviar propuesta / Firmar contrato / Pago / No definido |
| PDF Pre-call | `l68qJ8cHzcCrq5Tysbfd` | SINGLE_OPTIONS | No enviado / Enviado / Abierto (no usado por el dashboard todavía) |
| Decision Maker | `ulgo0TCea4ihr3X2bfgq` | SINGLE_OPTIONS | (no usado por el dashboard todavía) |
| Objeción principal | `YCgwl33fj56uASRGyUih` | SINGLE_OPTIONS | (no usado por el dashboard todavía) |

## Closer e identidad

No existe campo custom de "closer". Se resuelve así, en orden: `assignedUserId`
de la cita activa de calendario → `assignedTo` de la oportunidad → sin
asignar. Mismo patrón que ya usaba el pipeline "FB Form Nativo" antiguo
(`lib/ghl.ts`).

**Calendario por closer — confirmado por API real (`GET /calendars/`), no
una suposición:** cada closer tiene su PROPIO calendario, con él mismo como
único team member. Reproducido en real el error de GHL al intentar cruzar
uno con otro ("The user id not part of calendar team"). Mapa completo en
`CLOSER_CALENDAR_MAP` (`lib/growth/ghl.ts`):

| Closer | Calendario | ID calendario |
|---|---|---|
| Daniel von Zedlitz | Estrategia Digital | `xiEtpyAXe41W1O029LSs` |
| Alejandro | Alejandro Setter-Closer | `Gd3eofu6Z1dJwLu6X5Na` |
| Iván | Ivan CloseUp | `LbbIFiBhBvgmViph0SCd` |

Crear/reprogramar una cita, o cambiar el closer de una oportunidad con cita
activa, usa siempre el calendario del closer FINAL, nunca uno fijo. Un
closer nuevo sin entrada en el mapa no podrá recibir citas hasta añadirlo.

## Fecha de seguimiento (cola de Follow-ups)

No existe un campo custom de "fecha de seguimiento" en GHL. Se reutilizan
las **Tareas nativas del contacto** (`GET /contacts/{id}/tasks`, campo
`dueDate`) en vez de inventar un campo nuevo — comprobado con un contacto
real que sí tenía una tarea con fecha real asociada. Solo se consulta para
leads cuyo "Próximo paso" implica seguimiento sin reunión (`Follow-up`,
`Enviar propuesta`, `Hablar con socio / mujer`, `Firmar contrato`, `Pago`) —
"Call 2" no entra aquí porque genera una cita real y vive en la Agenda, no
en Follow-ups. Sin tarea sin completar → cae en el cajón "Sin fecha".

## Forma real de las citas embebidas (importante, no obvio)

`opportunities/search?getCalendarEvents=true` (el campo embebido "calenders")
NO se usa como fuente de citas — se probó en real el 2026-08-20 y una cita
creada por API con el contactId correcto no aparecía ahí (GHL solo la enlaza
así cuando la cita se crea desde la propia ficha de la oportunidad,
"createdBy.source: opportunity_page"; una creada por API queda con
"source: third_party" y no se embebe). La fuente real usada es
`/calendars/events` directamente (mismo endpoint que ya usaba de forma
fiable el pipeline FB Form Nativo antiguo), barriendo `GROWTH_DEFAULT_CALENDAR_ID`
en una ventana de fechas y agrupando por `contactId` (`lib/growth/sync.ts`,
`fetchEventsByContact`). Esta forma sí trae `deleted`, `title`, `dateAdded` y
`rescheduledAt` (a diferencia del campo embebido, que es más pobre).

**Límite inherente de GHL, no de este código**: un evento de calendario solo
lleva `contactId`, nunca un `opportunityId` propio. Si un mismo contacto
tiene dos oportunidades abiertas a la vez en GROWTH (caso de borde explícito
de la lista de pruebas), no hay forma de saber por la API a cuál de las dos
pertenece una cita nueva — el código resuelve esto de forma estable
(la primera oportunidad que la reclama en una sincronización se queda con
ella, y no cambia en sincronizaciones futuras salvo que se borre el registro
local), pero es una ambigüedad real de los datos, no un bug. Probado en real
con las dos oportunidades de prueba (mismo contacto ficticio) — confirmado
que no duplica la cita ni la pierde, solo la atribuye de forma estable a una
de las dos.

**Sincronización de eventos borrados — límite conocido, no resuelto**: si
una cita se borra en GHL, la reconciliación no la ve más (no aparece en el
barrido), pero tampoco actualiza la fila ya guardada en `growth_appointments`
para marcarla como borrada (no hay lógica de "desaparecer implica cancelar").
Hoy no importa en la práctica (0 casos reales), pero si un closer borra una
cita completa en vez de cancelarla/reprogramarla, la fila local quedaría
obsoleta silenciosamente. Pendiente de resolver antes de confiar en esto a
volumen real.

## Fórmulas del funnel (cohorte = mes de entrada del lead)

- **Leads cualificados** = oportunidades cuyo `entry_month` (congelado la
  primera vez que se ve el lead) es el mes seleccionado.
- **Reuniones agendadas** = de esas, las que alguna vez tuvieron una cita
  registrada O cuya fase actual ya pasó de "Nuevo cualificado" (aproximación
  razonada: GHL no conserva historial de cambios de fase).
- **Asistieron** = `asistio_reunion = "Sí"` O fase ∈ {Reunión realizada,
  Follow-up/Call 2, Pagado}. Nunca se infiere por fecha pasada.
- **No shows** = `asistio_reunion = "No"` O fase = "No-show | Recuperación".
- **Pagados** = fase = `Pagado` (fuente canónica, no el estado "Ganado" —
  ver regla definitiva más abajo).
- Tasa de agenda = agendados ÷ leads. Show rate = asistieron ÷ "celebrables"
  (cita activa con fecha ya pasada, o resultado ya resuelto). No-show rate =
  mismo denominador. Close rate = pagados ÷ asistieron. Lead a cliente =
  pagados ÷ leads.

## Métricas del periodo (Hoy / Semana / Mes) — vista principal desde el rediseño

A diferencia de las fórmulas de cohorte de arriba (que siguen usándose solo
para el bloque secundario "Leads del mes"), las tarjetas y la Agenda de
Hoy/Semana/Mes se calculan sobre las oportunidades cuya **cita activa** cae
en el rango de fechas del periodo — sin aproximaciones: "Reuniones
agendadas" = nº de esas citas, exacto. Show rate/Close rate usan el mismo
conjunto, ver `lib/growth/metrics.ts` (`computePeriodFunnel`).

## Regla definitiva de ventas pagadas (Daniel, 2026-08-21)

La fuente canónica de una venta es la fase `Pagado` del pipeline GROWTH —
nunca el estado `Ganado` por sí solo. Implementación:

- `isVentaConfirmada(o)` (`lib/growth/metrics.ts`) = `pipelineStageId ===
  GROWTH_STAGES.pagado`. Usado en todos los conteos de "pagados"/"ventas".
- Columna nueva `pagado_confirmado_at` (`growth_opportunities`): la PRIMERA
  vez confirmada que se ve la oportunidad en fase Pagado
  (`lastStageChangeAt` de GHL, o el momento de la sincronización si GHL no
  lo da). Se escribe con `coalesce(existente, nuevo)` en el UPSERT — una vez
  puesta, nada la sobrescribe, ni reentradas en Pagado, ni webhooks
  duplicados, ni sincronizar primero desde el dashboard y luego desde GHL.
  Probado en real: fijada, repetida la reconciliación varias veces, sigue
  igual.
- Botón "Pagado" del dashboard: idempotente contra la FASE real (no el
  estado) — si ya está en Pagado, la segunda pulsación no vuelve a escribir
  nada (`{"ok":true,"alreadyWon":true}`), probado en real.
- Si GHL rechaza la escritura, no se guarda nada en Neon (el `catch` del
  endpoint no llega a llamar a la sincronización) — nunca se cuenta una
  venta de forma optimista.
- **Incoherencia "Ganado sin Pagado"**: `isGanadoSinPagado(o)` = `status ===
  "won" && pipelineStageId !== Pagado`. Se muestra en un aviso amarillo en
  el dashboard (no se cuenta como venta, no se oculta en silencio). Probado
  en real: forzada la incoherencia con una escritura directa a GHL, apareció
  en el aviso; revertida, desapareció.

## Riesgos / datos pendientes de validar por Daniel — actualizado 2026-08-20

1. **RESUELTO**: token con permiso de escritura de Calendarios activo,
   probado en real (crear+mover+borrar cita).
2. **RESUELTO**: `DATABASE_URL` (Neon) conectado y funcionando.
3. **RESUELTO**: cada closer tiene su propio calendario, confirmado por API
   — ver `CLOSER_CALENDAR_MAP` arriba. Un closer nuevo que se dé de alta en
   "Gestión de closers" necesitará que alguien añada su calendario a ese
   mapa en el código antes de poder recibir citas reales.
4. Sincronización de citas borradas directamente en GHL: sigue sin
   detectarse (ver más arriba) — no bloqueante hoy, cero casos reales.
5. La cola de Follow-ups depende de que los closers usen las Tareas nativas
   de GHL con fecha — si no las usan, todo cae en "Sin fecha" (no roto, pero
   menos útil). A validar con Daniel si el equipo ya trabaja así o si hace
   falta ajustar el proceso.
6. "Ventas pagadas" del periodo se atribuye por la fecha de la cita activa
   de la oportunidad, no por la fecha real de cobro — a confirmar con Daniel
   si esa es la lectura correcta para el negocio.
