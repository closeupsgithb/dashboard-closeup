# Arquitectura de reuniones — Dashboard Comercial GROWTH

Corrección estructural del 2026-08-28. Ver también `MEETINGS_METRICS_AUDIT.md`
(causa raíz detallada), `METRICS_DEFINITIONS.md` (fórmulas) y
`MEETING_QA_MATRIX.md` (casos probados).

## Principio

**Una reunión es un hecho histórico. Una oportunidad es un estado comercial
actual.** No son lo mismo y no comparten fuente de datos.

- **Oportunidad** (`growth_opportunities`) responde: ¿dónde está este lead
  AHORA? (fase del pipeline, próximo paso, closer asignado). Una oportunidad
  tiene UN estado actual, que se sobrescribe con cada cambio.
- **Reunión** (`growth_appointments`) responde: ¿qué ha OCURRIDO? Cada
  reunión es una fila propia, con su propio resultado, que no cambia nunca
  después de escribirse una vez.

Un contacto puede tener Call 1 (asistida) + Call 2 (agendada): son DOS filas
de `growth_appointments` sobre la MISMA oportunidad — nunca una sustituye a
la otra.

## Causa raíz del bug original

Antes de esta corrección, `growth_appointments` ya existía con esta forma
(una fila por reunión, `meeting_number`, `is_active`, columna `attendance`),
pero **nadie la usaba para calcular métricas**. El resultado de una reunión
(Asistió/No show) se guardaba solo en dos sitios, ambos a nivel de
OPORTUNIDAD, no de reunión:

1. `growth_opportunities.asistio_reunion` — un custom field de GHL, un único
   valor por oportunidad.
2. `growth_opportunities.pipeline_stage_id` — la fase actual del pipeline.

Cuando una oportunidad tenía Call 1 (asistida) y después se agendaba Call 2,
el mismo campo `asistio_reunion` se reescribía con el resultado de Call 2 en
cuanto el closer lo marcaba — borrando en silencio el resultado real de
Call 1 de todas las métricas. Mismo problema si la oportunidad se archivaba,
se perdía o se reprogramaba: solo existía un valor "actual", nunca un
histórico por reunión.

La columna `growth_appointments.attendance` existía en el esquema desde el
principio pero **nunca se escribía ni se leía** en ningún sitio del código —
el modelo de datos correcto ya estaba diseñado, solo le faltaba usarse.

## Qué cambió

### 1. `growth_appointments.attendance` es ahora la única fuente de verdad

`app/api/growth/opportunity/route.ts` (acción `asistio`) escribe el
resultado directamente en la fila de `growth_appointments` que corresponde a
la reunión concreta (identificada por `appointment_id`, no por
`opportunity_id`). Se escribe **primero** esto, en Neon — y solo después,
en un `try/catch` independiente, se intenta reflejar el resultado en GHL
(custom field + fase del pipeline). Si GHL falla, el resultado histórico YA
quedó guardado: nunca se pierde un dato real por un fallo externo (Fase 36
del brief).

`lib/growth/sync.ts` (`reconcileGrowth`) **nunca** escribe esta columna — la
sincronización con GHL solo actualiza `scheduled_at`/`ghl_status`/`closer_id`
de cada cita, nunca su `attendance`. Así un resync no puede pisar un
resultado ya registrado desde el dashboard.

### 2. Las métricas del periodo cuentan reuniones, no oportunidades

`computeMeetingsPeriodFunnel` (`lib/growth/metrics.ts`) recibe una lista de
reuniones (`MeetingRow[]`, una por fila de `growth_appointments`) filtrada
por SU PROPIA `scheduled_at` dentro del periodo activo — no por la cita
"activa" de la oportunidad. Una Call 1 asistida en agosto sigue contando en
agosto aunque en septiembre se agende (y falle) una Call 2 para la misma
oportunidad.

### 3. La ficha de una oportunidad sigue mostrando solo "lo que toca ahora"

La Agenda (`computeAgenda`) no cambió de forma — sigue mostrando una fila
por oportunidad, la de su cita ACTIVA, porque eso es lo único que un closer
puede accionar hoy (una reunión ya sustituida por otra no tiene ya un botón
que actualizar). Lo que cambió es de dónde saca el resultado mostrado:
`GrowthOpportunityView.activeAttendance` viene de
`growth_appointments.attendance` de la fila activa, nunca del campo mutable
de la oportunidad.

### 4. Borrar/perder una oportunidad ya no puede arrastrar su historial

`growth_appointments.opportunity_id` ya NO tiene `on delete cascade` — un
`DELETE FROM growth_opportunities` (que hoy ningún código ejecuta; solo se
marca `status`) fallaría de forma ruidosa en vez de borrar en silencio el
historial de reuniones asociado. Perdido/Abandonado/`eliminado_en_ghl` (ver
`sync.ts`) solo cambian el campo `status` de la oportunidad — nunca tocan
`growth_appointments`.

### 5. Corrección histórica auditada

`growth_metric_adjustments` (tabla nueva) permite un ajuste manual, con
motivo obligatorio y trazado por usuario, cuando el histórico real conocido
no se puede reconstruir con identidad exacta desde los datos existentes
(ver `MEETINGS_METRICS_AUDIT.md`, sección "Casos sin reconstruir"). Solo
admin (`app/api/growth/metric-adjustments/route.ts`), nunca se aplica en
silencio, y solo afecta a la vista "Mes" del periodo/mes exacto (o `'all'`).

## Relaciones

```
growth_closers
      │
      ▼
growth_opportunities  ──1:N──▶  growth_appointments
      │  (estado actual)             (histórico de reuniones,
      │  pipeline_stage_id            una fila = una reunión,
      │  proximo_paso                 attendance write-once)
      │  status (open/won/lost/
      │          abandoned/eliminado_en_ghl)
      │
      └─ pagado_confirmado_at (fecha de venta, congelada la primera vez)

growth_metric_adjustments  (correcciones históricas auditadas, admin-only)
growth_audit_log           (quién cambió qué, incluida cada escritura de attendance)
```

## Limitación conocida y explícitamente aceptada

La Agenda operativa sigue mostrando una sola fila por oportunidad (su cita
activa) — no una lista completa de todas las reuniones históricas de cada
lead. Esto es una decisión de scope deliberada: la vista operativa responde
"¿qué necesito hacer hoy?", y solo la cita activa es accionable. El
histórico completo de un lead (todas sus reuniones, con `meetingNumber`
propio) ya viaja en la respuesta de `/api/growth/metrics` dentro de
`agenda[].historial` (ver `app/api/growth/metrics/route.ts`,
`operativaFull`), listo para mostrarse si en el futuro se quiere una vista
de detalle por lead — no requiere cambios de backend adicionales.
