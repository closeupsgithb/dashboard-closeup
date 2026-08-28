import { NextResponse } from "next/server";
import {
  GROWTH_STAGES,
  GROWTH_FIELDS,
  calendarIdForCloser,
  ASISTIO_REUNION_VALUES,
  PROXIMO_PASO_VALUES,
  updateOpportunityStage,
  updateOpportunityStatus,
  updateOpportunityAssignedTo,
  updateOpportunityCustomFields,
  upsertAppointment,
  fetchGrowthOpportunities,
  createContactTask,
  updateContactTask,
  MissingCredentialsError as GhlMissingCredentials,
} from "@/lib/growth/ghl";
import { syncSingleOpportunity } from "@/lib/growth/sync";
import { query, MissingCredentialsError as DbMissingCredentials } from "@/lib/growth/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Action =
  | { action: "asistio"; opportunityId: string; value: "Sí" | "No"; appointmentId?: string }
  | { action: "reagendar"; opportunityId: string; nuevaFechaIso?: string }
  | { action: "reunion2"; opportunityId: string; nuevaFechaIso: string }
  | { action: "closer"; opportunityId: string; closerId: string | null }
  | { action: "proximoPaso"; opportunityId: string; value: string }
  | { action: "pagado"; opportunityId: string }
  | { action: "perdido"; opportunityId: string }
  | { action: "abandonado"; opportunityId: string }
  | { action: "etapaManual"; opportunityId: string; stageId: string }
  | { action: "followUp"; opportunityId: string; dueIso: string; titulo: string; taskId?: string }
  | { action: "followUpComplete"; opportunityId: string; taskId: string };

const TERMINAL_STAGES = new Set<string>([GROWTH_STAGES.followUpCall2, GROWTH_STAGES.pagado]);

async function logAudit(opportunityId: string, field: string, oldValue: string | null, newValue: string, status: "ok" | "failed", error?: string) {
  await query`
    insert into growth_audit_log (opportunity_id, actor, field, old_value, new_value, sync_status, error_detail)
    values (${opportunityId}, 'dashboard', ${field}, ${oldValue}, ${newValue}, ${status}, ${error ?? null})
  `;
}

async function currentOpportunity(opportunityId: string) {
  const rows = await query<{ pipeline_stage_id: string; status: string; contact_id: string }>`
    select pipeline_stage_id, status, contact_id from growth_opportunities where opportunity_id = ${opportunityId}
  `;
  return rows[0] ?? null;
}

export async function POST(request: Request) {
  let body: Action & { opportunityId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  if (!body.opportunityId) {
    return NextResponse.json({ error: "INVALID_BODY", detail: "Falta opportunityId" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "asistio": {
        if (!ASISTIO_REUNION_VALUES.includes(body.value)) {
          return NextResponse.json({ error: "INVALID_VALUE" }, { status: 400 });
        }

        // Corregido 2026-08-28 (ver docs/MEETING_ARCHITECTURE.md): el
        // resultado se escribe PRIMERO en la fila de la reunión concreta
        // (growth_appointments.attendance, identificada por appointment_id)
        // — nunca en un campo de la oportunidad que una reunión posterior
        // pueda pisar. Si no llega appointmentId desde el panel (paneles
        // abiertos desde Follow-ups/Leads, que no tienen una cita concreta a
        // la vista), se usa la cita ACTIVA de la oportunidad como hoy.
        let targetAppointmentId = body.appointmentId ?? null;
        if (!targetAppointmentId) {
          const activeAppt = await query<{ appointment_id: string }>`
            select appointment_id from growth_appointments where opportunity_id = ${body.opportunityId} and is_active = true limit 1
          `;
          targetAppointmentId = activeAppt[0]?.appointment_id ?? null;
        }
        if (!targetAppointmentId) {
          return NextResponse.json(
            { error: "SIN_CITA", detail: "Esta oportunidad no tiene ninguna reunión registrada a la que asignarle un resultado." },
            { status: 400 }
          );
        }

        const attendanceValue = body.value === "Sí" ? "si" : "no";
        await query`
          update growth_appointments set attendance = ${attendanceValue}, updated_at = now()
          where appointment_id = ${targetAppointmentId}
        `;
        await logAudit(body.opportunityId, "appointment_attendance", null, `${targetAppointmentId}:${attendanceValue}`, "ok");

        // Efectos en GHL (campo visible + fase del pipeline): best-effort. Si
        // fallan, el resultado histórico YA quedó guardado arriba — nunca se
        // deshace por un fallo externo (Fase 36 del brief: "no perder datos
        // reales por error externo de GHL"). Se avisa al panel con un warning
        // en vez de marcar la acción entera como fallida.
        let ghlSyncWarning: string | null = null;
        try {
          await updateOpportunityCustomFields(body.opportunityId, [{ fieldId: GROWTH_FIELDS.asistioReunion, value: body.value }]);
          const current = await currentOpportunity(body.opportunityId);
          // No se retrocede una oportunidad que ya avanzó a una fase comercial
          // posterior (Follow-up/Call 2 o Pagado) — mismo criterio que ya usa
          // el pipeline FB Form Nativo para no borrar progreso comercial real.
          const yaAvanzada = current ? TERMINAL_STAGES.has(current.pipeline_stage_id) : false;
          if (!yaAvanzada) {
            const targetStage = body.value === "Sí" ? GROWTH_STAGES.reunionRealizada : GROWTH_STAGES.noShowRecuperacion;
            await updateOpportunityStage(body.opportunityId, targetStage);
          }
        } catch (err) {
          ghlSyncWarning = err instanceof Error ? err.message : String(err);
          await logAudit(body.opportunityId, "appointment_attendance_ghl_sync", null, ghlSyncWarning, "failed", ghlSyncWarning);
        }

        await syncSingleOpportunity(body.opportunityId).catch(() => {});
        await logAudit(body.opportunityId, body.action, null, JSON.stringify(body), "ok");
        return NextResponse.json({ ok: true, ghlSyncWarning });
      }

      case "reagendar": {
        if (!body.nuevaFechaIso) {
          // Solo marcar "solicita reagendar" sin fecha nueva todavía.
          await updateOpportunityStage(body.opportunityId, GROWTH_STAGES.solicitaReagendar);
          break;
        }
        const activeAppt = await query<{ appointment_id: string }>`
          select appointment_id from growth_appointments where opportunity_id = ${body.opportunityId} and is_active = true limit 1
        `;
        const [opp] = (await fetchGrowthOpportunities()).filter((o) => o.id === body.opportunityId);
        if (!opp) throw new Error("Oportunidad no encontrada en GHL");
        const start = new Date(body.nuevaFechaIso);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const closerRow = await query<{ closer_id: string | null }>`
          select closer_id from growth_opportunities where opportunity_id = ${body.opportunityId}
        `;
        const assignedUserId = closerRow[0]?.closer_id ?? opp.assignedTo ?? "";
        if (!assignedUserId) {
          return NextResponse.json(
            { error: "FALTA_CLOSER", detail: "Asigna un closer a este lead antes de reagendar — GHL necesita saber quién da la reunión." },
            { status: 400 }
          );
        }
        const calendarId = calendarIdForCloser(assignedUserId);
        if (!calendarId) {
          return NextResponse.json(
            { error: "CLOSER_SIN_CALENDARIO", detail: "Este closer no tiene un calendario de GHL conocido — revísalo en Gestión de closers." },
            { status: 400 }
          );
        }
        await upsertAppointment({
          appointmentId: activeAppt[0]?.appointment_id,
          contactId: opp.contactId,
          calendarId,
          assignedUserId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          title: opp.name,
        });
        await updateOpportunityStage(body.opportunityId, GROWTH_STAGES.agendadoConfirmado);
        break;
      }

      case "reunion2": {
        const [opp] = (await fetchGrowthOpportunities()).filter((o) => o.id === body.opportunityId);
        if (!opp) throw new Error("Oportunidad no encontrada en GHL");
        const start = new Date(body.nuevaFechaIso);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const closerRow = await query<{ closer_id: string | null }>`
          select closer_id from growth_opportunities where opportunity_id = ${body.opportunityId}
        `;
        const assignedUserId = closerRow[0]?.closer_id ?? opp.assignedTo ?? "";
        if (!assignedUserId) {
          return NextResponse.json(
            { error: "FALTA_CLOSER", detail: "Asigna un closer a este lead antes de crear la reunión 2 — GHL necesita saber quién da la reunión." },
            { status: 400 }
          );
        }
        const calendarId2 = calendarIdForCloser(assignedUserId);
        if (!calendarId2) {
          return NextResponse.json(
            { error: "CLOSER_SIN_CALENDARIO", detail: "Este closer no tiene un calendario de GHL conocido — revísalo en Gestión de closers." },
            { status: 400 }
          );
        }
        // Cita NUEVA (sin appointmentId) — no sustituye a la reunión 1, que
        // sigue en el historial con su propio meeting_number.
        await upsertAppointment({
          contactId: opp.contactId,
          calendarId: calendarId2,
          assignedUserId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          title: `${opp.name} (reunión 2)`,
        });
        await updateOpportunityStage(body.opportunityId, GROWTH_STAGES.followUpCall2);
        await updateOpportunityCustomFields(body.opportunityId, [{ fieldId: GROWTH_FIELDS.proximoPaso, value: "Call 2" }]);
        break;
      }

      case "closer": {
        await updateOpportunityAssignedTo(body.opportunityId, body.closerId);
        const activeAppt = await query<{ appointment_id: string; scheduled_at: string; opportunity_id: string }>`
          select appointment_id, scheduled_at from growth_appointments where opportunity_id = ${body.opportunityId} and is_active = true limit 1
        `;
        const newCalendarId = calendarIdForCloser(body.closerId);
        if (activeAppt[0] && body.closerId && newCalendarId) {
          const [opp] = (await fetchGrowthOpportunities()).filter((o) => o.id === body.opportunityId);
          if (opp) {
            const start = new Date(activeAppt[0].scheduled_at);
            // Cambiar de closer con una cita activa mueve esa cita al
            // calendario del nuevo closer (cada uno tiene el suyo — no se
            // puede dejar la cita en el calendario del closer anterior).
            await upsertAppointment({
              appointmentId: activeAppt[0].appointment_id,
              contactId: opp.contactId,
              calendarId: newCalendarId,
              assignedUserId: body.closerId,
              startTime: start.toISOString(),
              endTime: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
              title: opp.name,
            });
          }
        }
        break;
      }

      case "proximoPaso": {
        if (!PROXIMO_PASO_VALUES.includes(body.value as (typeof PROXIMO_PASO_VALUES)[number])) {
          return NextResponse.json({ error: "INVALID_VALUE" }, { status: 400 });
        }
        await updateOpportunityCustomFields(body.opportunityId, [{ fieldId: GROWTH_FIELDS.proximoPaso, value: body.value }]);
        break;
      }

      case "pagado": {
        // Fuente canónica de una venta = fase "Pagado" (regla de Daniel,
        // 2026-08-21), no el estado "Ganado" — la idempotencia se comprueba
        // contra la fase real, no contra un campo que podría estar
        // desincronizado. Si ya está en Pagado, no se vuelve a escribir ni a
        // auditar (evita duplicar la venta si se pulsa dos veces o si el
        // webhook de confirmación llega después de este mismo clic).
        const current = await currentOpportunity(body.opportunityId);
        if (current?.pipeline_stage_id === GROWTH_STAGES.pagado) {
          return NextResponse.json({ ok: true, alreadyWon: true });
        }
        await updateOpportunityStage(body.opportunityId, GROWTH_STAGES.pagado);
        await updateOpportunityStatus(body.opportunityId, "won");
        break;
      }

      case "perdido":
        await updateOpportunityStatus(body.opportunityId, "lost");
        break;

      case "abandonado":
        await updateOpportunityStatus(body.opportunityId, "abandoned");
        break;

      case "etapaManual": {
        // Override manual de etapa desde el panel de revisión — solo se
        // acepta un ID real del pipeline GROWTH, nunca un string libre, para
        // no dejar la oportunidad en una etapa que no existe.
        if (!Object.values(GROWTH_STAGES).includes(body.stageId as (typeof GROWTH_STAGES)[keyof typeof GROWTH_STAGES])) {
          return NextResponse.json({ error: "INVALID_VALUE", detail: "Etapa no reconocida" }, { status: 400 });
        }
        await updateOpportunityStage(body.opportunityId, body.stageId);
        break;
      }

      case "followUp": {
        if (!body.dueIso || !body.titulo?.trim()) {
          return NextResponse.json({ error: "INVALID_VALUE", detail: "Falta fecha/hora o acción concreta del follow-up" }, { status: 400 });
        }
        const current = await currentOpportunity(body.opportunityId);
        if (!current) throw new Error("Oportunidad no encontrada");
        // Si ya existe una tarea pendiente para este follow-up, se EDITA
        // (PUT) en vez de crear una nueva — evita acumular tareas duplicadas
        // sin completar (limitación conocida, ver DASHBOARD_CONTEXT.md §7).
        // Solo se crea una tarea nueva cuando no había ninguna todavía. En
        // ambos casos la tarea de GHL sigue siendo la fuente de verdad de
        // fecha+acción — no se guarda nada en Postgres aquí, el próximo
        // reconcile/sync ya la recoge vía fetchContactTasks.
        if (body.taskId) {
          await updateContactTask(current.contact_id, body.taskId, { title: body.titulo.trim(), dueDate: body.dueIso });
        } else {
          await createContactTask(current.contact_id, { title: body.titulo.trim(), dueDate: body.dueIso });
        }
        break;
      }

      case "followUpComplete": {
        if (!body.taskId) {
          return NextResponse.json({ error: "INVALID_VALUE", detail: "Falta el id de la tarea a completar" }, { status: 400 });
        }
        const current = await currentOpportunity(body.opportunityId);
        if (!current) throw new Error("Oportunidad no encontrada");
        await updateContactTask(current.contact_id, body.taskId, { completed: true });
        break;
      }

      default:
        return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
    }

    await syncSingleOpportunity(body.opportunityId);
    await logAudit(body.opportunityId, body.action, null, JSON.stringify(body), "ok");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GhlMissingCredentials || err instanceof DbMissingCredentials) {
      return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 503 });
    }
    const detail = err instanceof Error ? err.message : String(err);
    await logAudit(body.opportunityId, body.action, null, JSON.stringify(body), "failed", detail).catch(() => {});
    return NextResponse.json({ error: "UPSTREAM_ERROR", detail }, { status: 502 });
  }
}
