// Migración única (Fase 30 del brief de reconciliación de Daniel, 2026-08-28,
// ver docs/MEETING_ARCHITECTURE.md): reconstruye growth_appointments.attendance
// para las citas ya existentes, a partir de la ÚNICA señal disponible antes de
// esta corrección (growth_opportunities.asistio_reunion + pipeline_stage_id —
// el campo mutable por oportunidad que este mismo proyecto está sustituyendo).
//
// Por qué no es trivial: ese campo describe SOLO el resultado de la reunión
// MÁS RECIENTE ya marcada por el closer, pero la cita "activa" (is_active=true)
// de la oportunidad puede ya ser una Call 2 FUTURA agendada después — en ese
// caso el resultado real pertenece a la cita anterior (ya pasada), no a la
// activa. Regla de atribución:
//   1. Si la cita activa NO es futura -> el resultado es suyo.
//   2. Si la cita activa SÍ es futura -> el resultado pertenece a la cita más
//      reciente que ya haya pasado (si existe).
//   3. Si no hay ninguna cita (activa o pasada) para esa oportunidad -> NO se
//      inventa nada (Fase 21: "NO inventar contactos o citas falsas"). Se
//      lista al final para decidir si hace falta un ajuste manual en
//      growth_metric_adjustments.
//
// Solo hace UPDATE de la columna attendance sobre filas que hoy siguen en
// 'pendiente' — nunca toca una fila que el dashboard ya haya escrito
// explícitamente (idempotente: correrlo dos veces no cambia nada la segunda
// vez). No borra ni crea ninguna fila.
//
// Uso: node scripts/backfill-meeting-attendance.js           (dry-run, no escribe)
//      node scripts/backfill-meeting-attendance.js --apply   (aplica los UPDATE)

const fs = require("fs");
const { neon } = require("@neondatabase/serverless");

const envContent = fs.readFileSync(".env.local", "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const sql = neon(env.DATABASE_URL);

// Mismos IDs reales que lib/growth/ghl.ts (GROWTH_STAGES) — duplicados aquí
// porque este es un script node plano, no puede importar TS directamente.
const STAGES = {
  noShowRecuperacion: "a180c129-b51c-4543-b275-de7934342d1f",
  reunionRealizada: "b5e8900d-65b1-4174-9f10-ce0a68fa896c",
  followUpCall2: "32634bf6-7aee-44f2-a9e7-196ee9e3f1d2",
  pagado: "4082dbca-df89-4ff0-9dd9-52b3986ee360",
};
const MEETING_HAPPENED = new Set([STAGES.reunionRealizada, STAGES.followUpCall2, STAGES.pagado]);

// Réplica exacta de la resolveAttendance() legacy que este backfill sustituye.
function legacyResolveAttendance(asistioReunion, stageId) {
  if (asistioReunion === "Sí" || MEETING_HAPPENED.has(stageId)) return "si";
  if (asistioReunion === "No" || stageId === STAGES.noShowRecuperacion) return "no";
  return "pendiente";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const now = Date.now();

  const opps = await sql`select opportunity_id, contact_name, asistio_reunion, pipeline_stage_id from growth_opportunities`;
  const appts = await sql`select opportunity_id, appointment_id, meeting_number, scheduled_at, is_active, attendance from growth_appointments order by opportunity_id, scheduled_at asc`;

  const apptsByOpp = new Map();
  for (const a of appts) {
    const list = apptsByOpp.get(a.opportunity_id) ?? [];
    list.push(a);
    apptsByOpp.set(a.opportunity_id, list);
  }

  const updates = [];
  const sinCita = [];

  for (const o of opps) {
    const legacy = legacyResolveAttendance(o.asistio_reunion, o.pipeline_stage_id);
    if (legacy === "pendiente") continue; // nada que reconstruir, ya está bien como 'pendiente'

    const list = apptsByOpp.get(o.opportunity_id) ?? [];
    if (list.length === 0) {
      sinCita.push({ contact: o.contact_name, opportunityId: o.opportunity_id, legacy });
      continue;
    }

    const activa = list.find((a) => a.is_active) ?? list[list.length - 1];
    const activaEsFutura = new Date(activa.scheduled_at).getTime() > now;

    let target = activa;
    if (activaEsFutura) {
      const pasadas = list.filter((a) => new Date(a.scheduled_at).getTime() <= now);
      target = pasadas[pasadas.length - 1] ?? null;
    }
    if (!target) {
      sinCita.push({ contact: o.contact_name, opportunityId: o.opportunity_id, legacy, motivo: "solo tiene citas futuras" });
      continue;
    }
    if (target.attendance !== "pendiente") continue; // ya escrito explícitamente, no se toca

    updates.push({ contact: o.contact_name, appointmentId: target.appointment_id, meetingNumber: target.meeting_number, value: legacy });
  }

  console.log(`${apply ? "APLICANDO" : "DRY-RUN (usa --apply para escribir)"} — ${updates.length} citas a actualizar:`);
  for (const u of updates) {
    console.log(`  ${(u.contact || "").padEnd(30)} meeting#${u.meetingNumber} -> attendance='${u.value}'`);
  }
  console.log(`\n${sinCita.length} oportunidad(es) con resultado conocido pero SIN cita a la que atribuirlo (revisar manualmente / growth_metric_adjustments):`);
  for (const s of sinCita) {
    console.log(`  ${(s.contact || "").padEnd(30)} ${s.opportunityId} -> legacy='${s.legacy}'${s.motivo ? " (" + s.motivo + ")" : ""}`);
  }

  if (apply) {
    for (const u of updates) {
      await sql`update growth_appointments set attendance = ${u.value}, updated_at = now() where appointment_id = ${u.appointmentId}`;
      await sql`
        insert into growth_audit_log (appointment_id, actor, field, old_value, new_value, sync_status)
        values (${u.appointmentId}, 'backfill_migration', 'attendance', 'pendiente', ${u.value}, 'ok')
      `;
    }
    console.log(`\n${updates.length} filas actualizadas.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
