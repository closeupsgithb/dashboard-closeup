# Auditoría de métricas de reuniones — 2026-08-28

Encargo de Daniel: histórico de reuniones fiable, causa raíz de las
inconsistencias, corrección estructural (no un parche visual). Ver
`MEETING_ARCHITECTURE.md` para el diseño nuevo y `METRICS_DEFINITIONS.md`
para las fórmulas finales.

## 1. Cómo se calculaba ANTES de esta corrección

| Métrica | Fuente | Query/lógica anterior | Problema |
|---|---|---|---|
| Asistidas / No shows | `growth_opportunities.asistio_reunion` (custom field GHL) + `pipeline_stage_id` | `resolveAttendance(o)`: `asistio_reunion === "Sí"` OR fase ∈ {Reunión realizada, Follow-up/Call 2, Pagado} → asistió; `"No"` OR fase = No-show → no show | **Un único valor por OPORTUNIDAD, no por reunión.** Call 2 sobrescribía el resultado de Call 1 en cuanto se marcaba. Una oportunidad archivada (perdida/abandonada/borrada en GHL) podía perder su resultado si el campo se limpiaba. |
| Reuniones agendadas (periodo) | `growth_opportunities` filtradas por `activeAppointmentAt` (cita ACTIVA) en el rango | 1 oportunidad = máximo 1 "reunión" contada, aunque tuviera Call 1 + Call 2 | Una Call 1 ya resuelta en un mes anterior desaparecía del periodo si la cita activa (Call 2) caía en otro mes — o si la oportunidad se archivaba, dejaba de tener "cita activa" en absoluto. |
| Show rate (periodo) | `asistidas / celebrables`, `celebrables` = resueltas + pasadas sin marcar, todo a nivel de oportunidad | igual que arriba | Heredaba el mismo problema de origen (opportunity-level, no meeting-level) más una definición de denominador (incluía "pendientes de celebrar") distinta a la que pide Daniel ahora (`ATTENDED/(ATTENDED+NO_SHOW)`, ver más abajo). |
| `growth_appointments.attendance` | Columna del esquema desde el origen del proyecto | **Nunca se escribía ni se leía en ningún sitio del código.** | El modelo correcto (una fila por reunión) ya existía en el esquema, pero no se usaba — la causa raíz no era "falta de tabla", era "tabla sin conectar". |

## 2. Por qué el show rate mostrado no cuadraba matemáticamente

La captura que trajo Daniel mostraba una combinación de asistidas/no-shows
cuyo denominador no coincidía con `asistidas + no_shows`. Con el modelo
anterior esto es esperable, no un caso raro: el denominador ("celebrables")
podía incluir una reunión pasada que nadie había marcado todavía
(`pendiente` pero con fecha ya vencida) — sumaba al denominador sin sumar a
ningún numerador, así que el % mostrado nunca tenía por qué cuadrar con la
aritmética simple de dos números vistos en pantalla. No fue posible
reconstruir el snapshot exacto de esa captura concreta (el estado en Neon
sigue avanzando en tiempo real con cada sync de GHL), pero la causa
estructural es esta, no una cifra suelta mal sumada.

## 3. Reconciliación del histórico existente

Backfill ejecutado (`scripts/backfill-meeting-attendance.js`, ver ese
archivo para la regla de atribución exacta): para cada oportunidad con un
resultado ya conocido (vía el campo legacy `asistio_reunion` +
`pipeline_stage_id`), se atribuyó ese resultado a la reunión correcta —la
cita activa, o si esta ya es una Call 2 futura sin resolver, la cita anterior
ya pasada— y se escribió una sola vez en `growth_appointments.attendance`.
Únicamente se tocaron filas que seguían en `'pendiente'`; nada se sobrescribe
dos veces (idempotente).

Resultado del backfill (ejecutado 2026-08-28, `--apply`): **10 reuniones
reconstruidas** — 4 asistidas, 6 no-shows. Detalle en el log del propio
script. Show rate reconstruido a esa fecha: `4 / (4 + 6) = 40 %`.

**Diferencia con la cifra de referencia de Daniel (3 asistidas / 4 no-shows,
42,9 %)**: es real y se documenta en vez de forzarse. Dos causas, ninguna es
un error del backfill:

1. **El tiempo siguió avanzando.** Entre que Daniel dio esa cifra y que se
   ejecutó esta auditoría, al menos una reunión más (Nathaly CQ) pasó de
   "agendada" a "no show" en GHL en tiempo real — el pipeline sigue
   operando durante la propia corrección.
2. **La reconstrucción ahora es por reunión, no por oportunidad**: el
   recuento de Daniel, hecho mirando el dashboard ANTES de esta corrección,
   heredaba el mismo bug que se está corrigiendo (una oportunidad con
   Call 1 + Call 2 solo aportaba un resultado, no dos), así que es esperable
   que el número exacto se mueva al pasar a un recuento evento por evento.

## 4. Caso sin reconstruir (pendiente de decisión de Daniel)

**Ivan** (oportunidad `snnjtKY8rVIcnejlOGrO`, la actualmente abierta, no la
archivada) está en la fase "No-show | Recuperación" en GHL pero **no tiene
ninguna cita registrada en `growth_appointments`** — no hay una fila a la
que atribuirle ese resultado sin fabricarla. No se ha inventado una cita
para este caso (regla explícita: "no crear reuniones ficticias"). Dos
caminos, a elegir por Daniel:

- Revisar en GHL si esta oportunidad tuvo de verdad una cita que no se
  sincronizó (posible fallo puntual de sync a investigar), y si la hay,
  corregirla en origen para que el próximo `reconcileGrowth()` la recoja.
- Si se confirma que el no-show es real pero irrecuperable en detalle, usar
  `growth_metric_adjustments` (`POST /api/growth/metric-adjustments`,
  solo admin) para sumar `+1 no_show` al mes correspondiente, con motivo
  documentado.

No se ha creado ningún ajuste automáticamente — la tabla y el endpoint están
listos, pero cada fila requiere una decisión y un motivo explícitos.

## 5. Verificación tras el despliegue

Ver el final de `MEETING_QA_MATRIX.md` para los números verificados en
producción después de desplegar esta corrección.
