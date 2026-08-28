# Definiciones de métricas — Dashboard Comercial GROWTH

Fuente de verdad de cada fórmula. Si el dashboard muestra un número que no
cuadra con esto, es un bug — no una definición alternativa a inventar sobre
la marcha. Ver `lib/growth/metrics.ts` para la implementación exacta.

## Reuniones (KPIs del periodo — tarjetas Hoy/Semana/Mes)

Todas se calculan sobre `growth_appointments` (una fila = una reunión real,
con fecha propia y resultado propio), filtradas por `scheduled_at` dentro
del periodo activo y `ghl_status <> 'cancelled'`.

| Métrica | Fórmula | Notas |
|---|---|---|
| **Reuniones agendadas** | nº de citas (no canceladas) cuya `scheduled_at` cae en el periodo | Incluye pasadas, presentes y futuras del periodo. Call 1 y Call 2 de un mismo lead cuentan como 2 si sus fechas caen en el periodo — son reuniones distintas, no leads distintos. |
| **Reuniones realizadas** | nº de esas citas con `attendance = 'si'` | |
| **No shows** | nº de esas citas con `attendance = 'no'` | |
| **Show rate** | `asistidas / (asistidas + no_shows)` | **No incluye**: futuras, canceladas, reprogramadas, ni pasadas todavía sin marcar ("pendientes de celebrar" no son ni un show ni un no-show hasta que alguien las marca). |
| **Ventas** | nº de oportunidades cuya `pagado_confirmado_at` cae en el periodo | Evento de OPORTUNIDAD (fase "Pagado" confirmada), no de reunión — tiene su propia fecha de cierre, congelada la primera vez que se confirma. |
| **Close rate** | `ventas / reuniones realizadas` (mismo periodo) | Nunca `ventas / leads` ni `ventas / reuniones agendadas`. |

## Leads (bloque "Leads del periodo")

Cohorte de oportunidades cuya `entry_at` (fecha de entrada real, no la de
`created_at` de GHL sin más) cae en el periodo. Estas son métricas por LEAD,
no por reunión — no confundir con las de arriba:

| Métrica | Fórmula |
|---|---|
| **Leads cualificados** | tamaño de la cohorte |
| **Con reunión** | leads de la cohorte con al menos una cita registrada (activa o no) |
| **Lead → agenda** | Con reunión / Leads cualificados |
| **Lead → cliente** | ventas confirmadas de la cohorte / Leads cualificados |

## Asistencia de una oportunidad (Agenda, ficha, Follow-ups)

`activeAttendance`: el resultado (`asistio` / `no_show` / `pendiente`) de la
cita ACTIVA de esa oportunidad — la más reciente no cancelada. Responde
"¿qué necesito hacer AHORA con este lead?", no "¿qué ha pasado en total?".
Por eso una oportunidad con Call 1 asistida y Call 2 recién agendada (sin
resolver todavía) muestra `pendiente` aquí — correctamente, porque Call 2
sigue sin resultado — aunque el show rate del periodo de Call 1 ya cuente su
asistencia real.

## Reunión celebrable

Una reunión con `attendance` distinto de `pendiente`, o cuya `scheduled_at`
ya pasó. Se usa solo para decidir si una fila de la Agenda necesita acción
(`isPendingAttention`) — nunca como denominador del show rate (ver arriba).

## Corrección histórica (`growth_metric_adjustments`)

Delta manual, auditado (motivo + usuario + fecha), sobre `attended` o
`no_show` de un mes concreto (`YYYY-MM`) o `'all'`. Se suma DESPUÉS de
calcular el funnel del periodo, y solo en la vista "Mes". Nunca sustituye una
reconstrucción real cuando esta es posible — es el último recurso cuando el
histórico exacto (reunión, contacto, fecha) no puede identificarse desde
GHL/Neon (ver `MEETINGS_METRICS_AUDIT.md`).
