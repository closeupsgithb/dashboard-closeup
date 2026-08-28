import { query } from "@/lib/growth/db";
import { GROWTH_STAGE_NAMES } from "@/lib/growth/ghl";
import type { GrowthOpportunityView, Attendance } from "@/lib/growth/metrics";
import { listClosers, type Closer } from "@/lib/growth/closers";

type OpportunityRow = {
  opportunity_id: string;
  contact_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  pipeline_stage_id: string;
  status: string;
  closer_id: string | null;
  entry_month: string;
  entry_at: string | null;
  asistio_reunion: string | null;
  proximo_paso: string | null;
  follow_up_due_at: string | null;
  follow_up_title: string | null;
  follow_up_task_id: string | null;
  pagado_confirmado_at: string | null;
  first_contact_at: string | null;
  appt_count: string;
  active_scheduled_at: string | null;
  active_appointment_id: string | null;
  active_meeting_number: number | null;
  active_attendance: string | null;
};

export type AppointmentRow = {
  opportunityId: string;
  appointmentId: string;
  meetingNumber: number;
  scheduledAt: string;
  ghlStatus: string | null;
  attendance: string;
  isActive: boolean;
  closerId: string | null;
};

export type GrowthOpportunityFull = GrowthOpportunityView & {
  contactName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  stageName: string;
  followUpDueAt: string | null;
  followUpTitle: string | null;
  followUpTaskId: string | null;
  pagadoConfirmadoAt: string | null;
  firstContactAt: string | null;
  activeAppointmentId: string | null;
  activeMeetingNumber: number | null;
};

function toAttendance(raw: string | null): Attendance {
  if (raw === "si") return "asistio";
  if (raw === "no") return "no_show";
  return "pendiente";
}

export async function loadGrowthView(): Promise<{
  opportunities: GrowthOpportunityFull[];
  appointmentsByOpportunity: Map<string, AppointmentRow[]>;
  closers: Closer[];
}> {
  const [rows, apptRows, closers] = await Promise.all([
    query<OpportunityRow>`
      select
        o.opportunity_id, o.contact_name, o.company_name, o.phone, o.email,
        o.pipeline_stage_id, o.status, o.closer_id, o.entry_month, o.entry_at,
        o.asistio_reunion, o.proximo_paso, o.follow_up_due_at, o.follow_up_title, o.follow_up_task_id,
        o.pagado_confirmado_at, o.first_contact_at,
        coalesce(ca.appt_count, 0) as appt_count,
        act.scheduled_at as active_scheduled_at,
        act.appointment_id as active_appointment_id,
        act.meeting_number as active_meeting_number,
        act.attendance as active_attendance
      from growth_opportunities o
      left join (select opportunity_id, count(*) as appt_count from growth_appointments group by opportunity_id) ca
        on ca.opportunity_id = o.opportunity_id
      left join growth_appointments act
        on act.opportunity_id = o.opportunity_id and act.is_active = true
    `,
    query<{
      opportunity_id: string;
      appointment_id: string;
      meeting_number: number;
      scheduled_at: string;
      ghl_status: string | null;
      attendance: string;
      is_active: boolean;
      closer_id: string | null;
    }>`
      select opportunity_id, appointment_id, meeting_number, scheduled_at, ghl_status, attendance, is_active, closer_id
      from growth_appointments
      order by scheduled_at asc
    `,
    listClosers(),
  ]);

  const appointmentsByOpportunity = new Map<string, AppointmentRow[]>();
  for (const a of apptRows) {
    const list = appointmentsByOpportunity.get(a.opportunity_id) ?? [];
    list.push({
      opportunityId: a.opportunity_id,
      appointmentId: a.appointment_id,
      meetingNumber: a.meeting_number,
      scheduledAt: a.scheduled_at,
      ghlStatus: a.ghl_status,
      attendance: a.attendance,
      isActive: a.is_active,
      closerId: a.closer_id,
    });
    appointmentsByOpportunity.set(a.opportunity_id, list);
  }

  const opportunities = rows.map((r) => ({
    opportunityId: r.opportunity_id,
    contactName: r.contact_name,
    companyName: r.company_name,
    phone: r.phone,
    email: r.email,
    pipelineStageId: r.pipeline_stage_id,
    stageName: GROWTH_STAGE_NAMES[r.pipeline_stage_id] ?? r.pipeline_stage_id,
    status: r.status,
    closerId: r.closer_id,
    entryMonth: r.entry_month,
    entryAt: r.entry_at ?? r.entry_month + "-01",
    asistioReunion: r.asistio_reunion,
    proximoPaso: r.proximo_paso,
    followUpDueAt: r.follow_up_due_at,
    followUpTitle: r.follow_up_title,
    followUpTaskId: r.follow_up_task_id,
    pagadoConfirmadoAt: r.pagado_confirmado_at,
    firstContactAt: r.first_contact_at,
    activeAppointmentAt: r.active_scheduled_at,
    activeAppointmentId: r.active_appointment_id,
    activeMeetingNumber: r.active_meeting_number,
    activeAttendance: toAttendance(r.active_attendance),
    hasAnyAppointment: Number(r.appt_count) > 0,
  }));

  return { opportunities, appointmentsByOpportunity, closers };
}
