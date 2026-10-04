import { t, type Lang, type MessageKey } from '@sahayak/shared';
import type { Db } from '@sahayak/db';
import { MockWhatsAppChannel } from '../channels';
import { ToolError, type ToolRun } from './registry';

const mock = new MockWhatsAppChannel();

export async function clinicToday(db: Db, clinicId: string): Promise<{ date: string; tz: string }> {
  const r = await db.query(
    "SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS d, timezone FROM clinics WHERE id=$1",
    [clinicId],
  );
  return { date: r.rows[0].d, tz: r.rows[0].timezone };
}

export async function getSettings(db: Db, clinicId: string) {
  const r = await db.query(
    `SELECT s.*, c.name AS clinic_name, c.timezone, c.default_language FROM clinic_settings s JOIN clinics c ON c.id=s.clinic_id WHERE s.clinic_id=$1`,
    [clinicId],
  );
  return r.rows[0] as {
    address: string | null;
    directions: string | null;
    phone: string | null;
    timings: Record<string, string>;
    avg_consult_minutes: number;
    intake_questions: { id: string; en: string; hi: string }[];
    clinic_name: string;
    timezone: string;
    default_language: Lang;
    modules: Record<string, boolean>;
  };
}

export async function hasConsent(db: Db, patientId: string, purpose: string): Promise<boolean> {
  const r = await db.query(
    'SELECT 1 FROM consents WHERE patient_id=$1 AND purpose=$2 AND withdrawn_at IS NULL',
    [patientId, purpose],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function ensureConversation(
  db: Db,
  clinicId: string,
  contact: string,
  patientId: string | null,
  lang: Lang,
  channel = 'whatsapp',
) {
  const r = await db.query(
    `INSERT INTO conversations (clinic_id,patient_id,channel,contact,language) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (clinic_id,channel,contact) DO UPDATE SET patient_id=COALESCE(conversations.patient_id,EXCLUDED.patient_id), updated_at=now()
     RETURNING id, handled_by`,
    [clinicId, patientId, channel, contact, lang],
  );
  return r.rows[0] as { id: string; handled_by: string };
}

export async function storeMessage(
  db: Db,
  clinicId: string,
  conversationId: string,
  direction: 'in' | 'out',
  sender: string,
  body: string,
) {
  await db.query(
    'INSERT INTO messages (clinic_id,conversation_id,direction,sender,body) VALUES ($1,$2,$3,$4,$5)',
    [clinicId, conversationId, direction, sender, body],
  );
  await db.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [conversationId]);
}

/**
 * Send a templated message to a patient. Proactive messages (anything the patient did not just ask for)
 * require WhatsApp-messaging consent; without it the message is skipped and false is returned.
 */
export async function notifyPatient(
  r: ToolRun,
  patient: { id: string; phone: string; language: Lang },
  key: MessageKey,
  vars: Record<string, string | number>,
  opts: { proactive?: boolean; sender?: string } = {},
): Promise<boolean> {
  const { db, ctx, rt } = r;
  if (opts.proactive !== false && !(await hasConsent(db, patient.id, 'whatsapp_messaging')))
    return false;
  const text = t(patient.language, key, vars);
  const conv = await ensureConversation(
    db,
    ctx.clinicId,
    patient.phone,
    patient.id,
    patient.language,
  );
  await storeMessage(
    db,
    ctx.clinicId,
    conv.id,
    'out',
    opts.sender ?? (ctx.actor.kind === 'agent' ? `agent:${ctx.actor.agent}` : 'system'),
    text,
  );
  await deliver(r, { to: patient.phone, text, lang: patient.language });
  r.emit({ type: 'conversation_updated', conversationId: conv.id });
  return true;
}

export function fmtTime(d: Date | string, tz = 'Asia/Kolkata', lang: Lang = 'en'): string {
  return new Date(d).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export interface QueueRow {
  id: string;
  doctor_id: string;
  patient_id: string;
  token_number: number;
  status: string;
  position_key: string;
  patient_name: string;
  checked_in_at: string;
  called_at: string | null;
  appointment_id: string | null;
  wait_minutes: number;
}

/** Today's queue for the clinic (optionally one doctor) with an estimated wait per waiting entry. */
export async function queueSnapshot(
  db: Db,
  clinicId: string,
  doctorId?: string,
): Promise<QueueRow[]> {
  const { date } = await clinicToday(db, clinicId);
  const s = await getSettings(db, clinicId);
  const r = await db.query(
    `SELECT q.id,q.doctor_id,q.patient_id,q.token_number,q.status,q.position_key::text,p.name AS patient_name,
            q.checked_in_at,q.called_at,q.appointment_id
       FROM queue_entries q JOIN patients p ON p.id=q.patient_id
      WHERE q.queue_date=$1 AND ($2::uuid IS NULL OR q.doctor_id=$2)
      ORDER BY q.position_key`,
    [date, doctorId ?? null],
  );
  // Wait = patients ahead (waiting before you, plus the one in the room) x average consult time.
  const ahead = new Map<string, number>();
  for (const row of r.rows)
    if (row.status === 'called' || row.status === 'in_consultation')
      ahead.set(row.doctor_id, (ahead.get(row.doctor_id) ?? 0) + 1);
  return r.rows.map((row) => {
    let wait = 0;
    if (row.status === 'waiting') {
      const n = ahead.get(row.doctor_id) ?? 0;
      wait = n * s.avg_consult_minutes;
      ahead.set(row.doctor_id, n + 1);
    }
    return { ...row, wait_minutes: wait };
  });
}

/** Agents and patients may only touch the patient they are currently talking to. */
export function assertOwn(
  ctx: { actor: { kind: string }; patientId?: string | null },
  patientId: string,
) {
  if (ctx.actor.kind === 'staff' || ctx.actor.kind === 'system') return;
  if (ctx.patientId !== patientId)
    throw new ToolError('forbidden', "You may only access the current patient's own data", 403);
}

/**
 * Hand an outbound message to the channel. The mock channel delivers instantly (the stored message is the delivery).
 * A real vendor channel goes through the `outbox` table so a slow or failing vendor never holds a DB transaction
 * or loses a message: the outbox job sends it with retries.
 */
export async function deliver(
  r: ToolRun,
  m: { to: string; text: string; lang: Lang; channel?: string },
) {
  if (m.channel && m.channel !== 'whatsapp') return; // voice/web replies go back to the caller directly, never out as WhatsApp
  const ch = r.rt.channel ?? mock;
  if (!ch.queued) return ch.send({ clinicId: r.ctx.clinicId, ...m });
  await r.db.query(
    'INSERT INTO outbox (clinic_id,channel,to_contact,body,language) VALUES ($1,$2,$3,$4,$5)',
    [r.ctx.clinicId, ch.name, m.to, m.text, m.lang],
  );
}
