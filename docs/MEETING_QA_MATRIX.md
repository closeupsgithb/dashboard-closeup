# QA — arquitectura de reuniones (2026-08-28)

Casos mínimos exigidos por el brief de Daniel. Verificados contra datos
REALES del pipeline GROWTH en producción (no se crean contactos de prueba
nuevos — el propio pipeline ya tenía casos naturales de Call 1 + Call 2 en
curso, y crear más contactos de prueba iría en contra de lo que Daniel pidió
limpiar). Resultados al final de este documento, con fecha y query exacta
usada para verificar cada uno.

| # | Caso | Cómo se verifica | Resultado esperado |
|---|---|---|---|
| 1 | Meeting scheduled → aparece en Agenda | `GET /api/growth/metrics?periodo=...` → `agenda[]` | Fila presente, `attendance: "pendiente"` |
| 2 | Meeting attended → Asistidas +1 | Marcar "Sí" desde el panel → releer métricas del periodo de esa fecha | `reunionesRealizadas` sube en 1, `showRate` recalculado |
| 3 | Meeting no show → No Shows +1 | Marcar "No" → releer métricas | `noShows` sube en 1 |
| 4 | Meeting cancelled → no afecta show rate | Cita con `ghl_status = 'cancelled'` | Excluida de `reunionesAgendadas`/`showRate` (filtro `!m.cancelled`) |
| 5 | Meeting future → no afecta show rate | Cita con `scheduled_at` > ahora, `attendance='pendiente'` | No suma a asistidas ni a no-shows (solo entra al numerador/denominador si está resuelta) |
| 6 | Meeting attended → opportunity lost → attended permanece | Marcar "Sí", luego "Marcar perdido" | `growth_appointments.attendance` no cambia; `reunionesRealizadas` del periodo de esa reunión no cambia |
| 7 | Meeting attended → opportunity eliminada en GHL → attended permanece | Contacto borrado en GHL → `reconcileGrowth()` marca `status='eliminado_en_ghl'` | La fila de `growth_appointments` no se toca (sin `on delete cascade`); sigue contando en el periodo de su fecha |
| 8 | Call 1 attended + Call 2 scheduled → meeting 1 sigue attended, meeting 2 scheduled | Ver caso real "Luis Carlos Ramirez Cruz" / "Miguel Méndez" abajo | 2 filas en `growth_appointments`, cada una con su propio `attendance` |
| 9 | Call 2 attended → asistidas totales +1 otra vez | Marcar "Sí" en la Call 2 de un caso del punto 8 | `reunionesRealizadas` del mes de Call 2 sube en 1, el de Call 1 no cambia |
| 10 | Contacto con 3 reuniones → 3 filas históricas | `select count(*) from growth_appointments where opportunity_id = ...` | `meeting_number` 1, 2, 3 — nunca se sustituyen entre sí |
| 11 | Sale after attended → attended permanece, sale +1 | Marcar "Pagado" tras una reunión asistida | `ventasPagadas` sube en el mes de `pagado_confirmado_at`; `reunionesRealizadas` no cambia |
| 12 | Reschedule → la reunión anterior no desaparece silenciosamente | `upsertAppointment` con `appointmentId` existente actualiza la MISMA fila (mismo `appointment_id`) — no crea una fila nueva ni borra la vieja | Una reprogramación real desde GHL con un `appointment_id` nuevo sí crea una fila nueva con `meeting_number` incremental — ambas quedan, nunca se pierde una |

## Verificación en producción — 2026-08-28

**Backfill aplicado**: `node scripts/backfill-meeting-attendance.js --apply`
→ 10 reuniones reconstruidas (4 asistidas, 6 no-shows). Detalle en
`MEETINGS_METRICS_AUDIT.md`.

**Caso 8/9 verificado con datos reales** (sin crear contactos de prueba):
- *Luis Carlos Ramirez Cruz* (`N0zSmjJsaqOKp5DsdBa8`): Call 1 (27 ago,
  `meeting_number=1`) → `attendance='si'` tras el backfill. Call 2 (2 oct,
  `meeting_number=2`, activa) → `attendance='pendiente'` (futura, sin
  resolver). Confirma el caso 8 con datos reales de producción.
- *Miguel Méndez* (`DR4F15nia04vpoKj21Ky`): mismo patrón — Call 1 (28 ago)
  `si`, Call 2 (31 ago, futura) `pendiente`.

**Caso 7 verificado**: *Francisco Pizarro* y *Guillermo Cc* (oportunidades
`eliminado_en_ghl`, ya no existen como oportunidad abierta en GHL) conservan
`attendance='si'` en `growth_appointments` tras el backfill — su asistencia
sigue contando en las métricas del periodo en el que ocurrió, pese a que la
oportunidad ya no es "activa". Esto es exactamente lo que reportó Daniel
como roto en su segundo mensaje de este mismo día, y queda corregido.

**Métricas del mes verificadas tras desplegar** (`GET
/api/growth/metrics?periodo=mes`): ver el mensaje final a Daniel para las
cifras exactas del momento del despliegue — seguirán moviéndose con el uso
normal del pipeline, como corresponde a un sistema en producción.
