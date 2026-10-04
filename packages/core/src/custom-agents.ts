import { z } from 'zod';
import { normalise, violatesMedicalPolicy } from '@sahayak/shared';
import type { Db } from '@sahayak/db';
import { METRICS } from './tools/ask';

export const EVENT_TRIGGERS = [
  'visit.finished',
  'appointment.booked',
  'appointment.cancelled',
  'patient.checked_in',
] as const;
const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const Tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9 _-]{0,29}$/);

export const TriggerSchema = z.union([
  z.object({ type: z.literal('schedule'), every: z.literal('day'), at: HM }),
  z.object({
    type: z.literal('schedule'),
    every: z.literal('week'),
    weekday: z.number().int().min(0).max(6),
    at: HM,
  }),
  z.object({
    type: z.literal('schedule'),
    every: z.literal('month'),
    dayOfMonth: z.number().int().min(1).max(28),
    at: HM,
  }),
  z.object({
    type: z.literal('event'),
    event: z.enum(EVENT_TRIGGERS),
    delayHours: z.number().int().min(0).max(168).default(0),
  }),
]);
export const AudienceSchema = z.object({
  tags: z.array(Tag).max(5).optional(),
  lastVisitOlderThanDays: z.number().int().min(7).max(1095).optional(),
  lastVisitWithinDays: z.number().int().min(1).max(365).optional(),
  hasUpcomingAppointment: z.boolean().optional(),
});
const Text = z.object({
  en: z.string().trim().min(3).max(400),
  hi: z.string().trim().max(400).optional(),
});
export const ActionSchema = z.union([
  z.object({ type: z.literal('message_patients'), text: Text }),
  z.object({
    type: z.literal('notify_staff'),
    to: z.enum(['doctor', 'receptionist', 'both']),
    text: Text,
  }),
  z.object({ type: z.literal('summary'), metrics: z.array(z.enum(METRICS)).min(1).max(6) }),
]);
export const SpecSchema = z.object({
  trigger: TriggerSchema,
  audience: AudienceSchema.default({}),
  action: ActionSchema,
});
export type AgentSpec = z.infer<typeof SpecSchema>;

const URL_RE = /https?:\/\/|www\.|\b[\w-]+\.(com|in|org|net|co|io|app|ly|me)\b/i;
const ALLOWED_PLACEHOLDERS = new Set(['name', 'clinic', 'count', 'names']);

/** Text a doctor writes for patients: plain, no links, no medical advice, only known placeholders. Returns a problem or null. */
export function checkText(text: string): string | null {
  if (URL_RE.test(text)) return 'Messages from custom agents cannot contain links.';
  for (const m of text.matchAll(/\{(\w+)\}/g))
    if (!ALLOWED_PLACEHOLDERS.has(m[1]))
      return `Unknown placeholder {${m[1]}}. You can use {name} and {clinic}.`;
  if (violatesMedicalPolicy(text))
    return 'This reads like medical advice (a dose, a medicine to take, a diagnosis or reassurance). Agents may only send reminders and clinic information.';
  return null;
}

export interface SpecProblem {
  field: string;
  message: string;
}

/** Everything the schema cannot express: the rules that keep a custom agent from becoming a spam or advice machine. */
export function checkSpec(spec: AgentSpec): SpecProblem[] {
  const out: SpecProblem[] = [];
  const a = spec.action;
  if (a.type === 'message_patients' || a.type === 'notify_staff') {
    for (const lang of ['en', 'hi'] as const) {
      const txt = a.text[lang];
      const p = txt ? checkText(txt) : null;
      if (p) out.push({ field: `text.${lang}`, message: p });
    }
  }
  if (a.type === 'message_patients') {
    const au = spec.audience;
    const filtered = !!(
      au.tags?.length ||
      au.lastVisitOlderThanDays ||
      au.lastVisitWithinDays ||
      au.hasUpcomingAppointment !== undefined
    );
    if (spec.trigger.type === 'schedule') {
      if (!filtered)
        out.push({
          field: 'audience',
          message:
            'Choose who should get this: a label, or how long since their last visit. A scheduled message cannot go to every patient.',
        });
      if (spec.trigger.at < '08:00' || spec.trigger.at > '20:59')
        out.push({
          field: 'trigger.at',
          message: 'Patient messages can only be sent between 08:00 and 20:59.',
        });
    }
  }
  if (a.type === 'summary' && spec.trigger.type !== 'schedule')
    out.push({
      field: 'trigger',
      message: 'A summary needs a schedule (for example every evening at 20:00).',
    });
  return out;
}

export function validateSpec(
  raw: unknown,
): { ok: true; spec: AgentSpec; problems: SpecProblem[] } | { ok: false; problems: SpecProblem[] } {
  const p = SpecSchema.safeParse(raw);
  if (!p.success)
    return {
      ok: false,
      problems: p.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    };
  const problems = checkSpec(p.data);
  return problems.length ? { ok: false, problems } : { ok: true, spec: p.data, problems: [] };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hmLabel = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`;
};

/** Plain-language description of what an agent will do. This, not the doctor's original wording, is what they approve. */
export function explainSpec(spec: AgentSpec): string[] {
  const t = spec.trigger;
  const when =
    t.type === 'event'
      ? `${({ 'visit.finished': 'After each visit finishes', 'appointment.booked': 'When an appointment is booked', 'appointment.cancelled': 'When an appointment is cancelled', 'patient.checked_in': 'When a patient checks in' } as const)[t.event]}${t.delayHours ? `, ${t.delayHours} hour(s) later` : ''}`
      : t.every === 'day'
        ? `Every day at ${hmLabel(t.at)}`
        : t.every === 'week'
          ? `Every ${WEEKDAYS[t.weekday]} at ${hmLabel(t.at)}`
          : `On day ${t.dayOfMonth} of every month at ${hmLabel(t.at)}`;
  const au = spec.audience;
  const who: string[] = [];
  if (au.tags?.length) who.push(`patients labelled ${au.tags.map((x) => `"${x}"`).join(' or ')}`);
  if (au.lastVisitOlderThanDays)
    who.push(`whose last visit was more than ${au.lastVisitOlderThanDays} days ago`);
  if (au.lastVisitWithinDays) who.push(`who visited in the last ${au.lastVisitWithinDays} days`);
  if (au.hasUpcomingAppointment === true) who.push('who have an upcoming appointment');
  if (au.hasUpcomingAppointment === false) who.push('who have no upcoming appointment');
  const a = spec.action;
  const lines = [when + ':'];
  if (a.type === 'message_patients') {
    lines.push(
      `Send a WhatsApp message to ${t.type === 'event' ? 'that patient' : who.length ? who.join(' ') : 'patients'}${t.type === 'event' && who.length ? ` (only if they are ${who.join(' ')})` : ''}:`,
    );
    lines.push(`"${a.text.en}"`);
    lines.push(
      'Only to patients who agreed to messages and reminders. Never more than one custom-agent message per patient per week. Never at night. Each message says who it is from and how to stop (reply STOP).',
    );
  } else if (a.type === 'notify_staff') {
    lines.push(
      `Tell the ${a.to === 'both' ? 'doctor and receptionist' : a.to}: "${a.text.en}" (shown on the console, and on WhatsApp if they added their number).`,
    );
  } else {
    lines.push(
      `Send the doctor a WhatsApp summary of today's: ${a.metrics.join(', ').replace(/_/g, ' ')}.`,
    );
  }
  return lines;
}

// ---------- plain words -> proposed spec (deterministic) ----------

const WD: [number, RegExp][] = [
  [1, /monday|somvar/],
  [2, /tuesday|mangalvar/],
  [3, /wednesday|budhvar/],
  [4, /thursday|guruvar|veervar/],
  [5, /friday|shukravar/],
  [6, /saturday|shanivar/],
  [0, /sunday|ravivar/],
];

function parseAt(text: string): string | undefined {
  const m =
    text.match(/\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i) ??
    text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return undefined;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 6) h += 12; // "at 8" in a clinic context
  if (h > 23) return undefined;
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

export interface Interpretation {
  understood: boolean;
  name?: string;
  spec?: unknown;
  notes: string[];
  help?: string;
}
const HELP =
  'Try: "remind my diabetic patients every month", "message patients who have not visited in 90 days", "send me the number of no-shows every evening at 7pm", "tell the receptionist when someone cancels", or "after every visit send a thank-you message".';

/** Turn a sentence into a PROPOSED spec. Nothing runs from this: the doctor reviews the plain-language explanation and activates. */
export function interpretAgentRequest(textIn: string): Interpretation {
  const text = normalise(textIn);
  const notes: string[] = [];
  const quoted = textIn.match(/["“]([^"”]{3,400})["”]/)?.[1]?.trim();
  const at = parseAt(text);
  const cadence = /\b(every|each)\s+(day|evening|morning|night)\b|\bdaily\b/.test(text)
    ? 'day'
    : /\b(every|each)\s+(week)\b|\bweekly\b/.test(text) ||
        WD.some(([, re]) => new RegExp(`every\\s+(${re.source})`).test(text))
      ? 'week'
      : /\b(every|each)\s+month\b|\bmonthly\b/.test(text)
        ? 'month'
        : undefined;
  const weekday = WD.find(([, re]) => re.test(text))?.[0] ?? 1;
  const timing = (defaultAt: string) =>
    cadence === 'week'
      ? { type: 'schedule', every: 'week', weekday, at: at ?? defaultAt }
      : cadence === 'month'
        ? { type: 'schedule', every: 'month', dayOfMonth: 1, at: at ?? defaultAt }
        : { type: 'schedule', every: 'day', at: at ?? defaultAt };
  const eveningDefault = /evening|shaam/.test(text)
    ? '19:00'
    : /morning|subah/.test(text)
      ? '09:00'
      : '20:00';

  // 1. a summary for me
  if (
    /\b(send|give|message) me\b.*\b(summary|number|count|report|update|how many)\b|\bsummary\b.*\bevery\b|\bdaily summary\b/.test(
      text,
    )
  ) {
    const metrics = [
      ...new Set(
        METRICS.filter((m) =>
          (
            ({
              seen: /patients?|seen|visits?/,
              no_shows: /no[- ]?shows?|did not (come|show)|absent/,
              appointments: /appointments?|bookings?/,
              cancellations: /cancel/,
              new_patients: /new patients?/,
              wait: /wait/,
              ratings: /rating|feedback/,
              consult: /consult/,
              busiest: /busiest|peak/,
              upcoming: /tomorrow|upcoming/,
              flags: /alerts?/,
              messages: /messages?|chats?/,
            }) as Record<string, RegExp>
          )[m]?.test(text),
        ),
      ),
    ];
    const chosen = metrics.length ? metrics : (['seen', 'no_shows', 'cancellations'] as const);
    if (!metrics.length)
      notes.push(
        'No specific numbers were mentioned, so I chose patients seen, no-shows and cancellations. You can change this.',
      );
    return {
      understood: true,
      name: 'My summary',
      spec: {
        trigger: timing(eveningDefault),
        audience: {},
        action: { type: 'summary', metrics: chosen },
      },
      notes,
    };
  }
  // 2. tell the staff when something happens
  if (
    /\b(tell|notify|alert|inform|let)\b.*\b(receptionist|doctor|me|staff)\b.*\b(when|if|whenever)\b|\bwhen\b.*\b(cancels?|cancelled|books?|booked|checks? in)\b.*\b(tell|notify|alert)\b/.test(
      text,
    )
  ) {
    const event = /cancel/.test(text)
      ? 'appointment.cancelled'
      : /book/.test(text)
        ? 'appointment.booked'
        : /check/.test(text)
          ? 'patient.checked_in'
          : /finish|visit/.test(text)
            ? 'visit.finished'
            : undefined;
    if (event) {
      const to = /receptionist|staff/.test(text)
        ? /doctor|\bme\b/.test(text)
          ? 'both'
          : 'receptionist'
        : 'doctor';
      const label = {
        'appointment.cancelled': 'cancelled an appointment',
        'appointment.booked': 'booked an appointment',
        'patient.checked_in': 'checked in',
        'visit.finished': 'finished their visit',
      }[event];
      return {
        understood: true,
        name: `Tell ${to === 'both' ? 'team' : to} about ${event.split('.')[1].replace('_', ' ')}`,
        spec: {
          trigger: { type: 'event', event, delayHours: 0 },
          audience: {},
          action: { type: 'notify_staff', to, text: { en: `{name} has ${label}.` } },
        },
        notes,
      };
    }
  }
  // 3. message patients after every visit
  if (
    /\b(after|when)\b.*\b(every|each|a)\b.*\bvisit\b|\bafter (every|each) (visit|appointment)\b/.test(
      text,
    )
  ) {
    const msg =
      quoted ?? 'Hello {name}, thank you for visiting {clinic}. We hope you are doing well.';
    if (!quoted)
      notes.push('You did not write the message, so I used a friendly thank-you. Edit it below.');
    const delay = Number(text.match(/\b(\d{1,2})\s*hours?\s*(later|after)\b/)?.[1] ?? 2);
    return {
      understood: true,
      name: 'Thank patients after a visit',
      spec: {
        trigger: { type: 'event', event: 'visit.finished', delayHours: delay },
        audience: {},
        action: { type: 'message_patients', text: { en: msg } },
      },
      notes,
    };
  }
  // 4. remind / message a group of patients
  const group = text.match(
    /\b(?:remind|message|text|whatsapp|send|nudge)\b.*?\b(?:my |our |all |the )?([a-z][a-z ]{2,28}?) patients?\b/,
  );
  const inactive = text.match(
    /\b(?:haven'?t|have not|has not|not|no)\b.*?\b(?:visited|come|been|seen)\b.*?\b(\d{1,4})\s*(days?|weeks?|months?)\b|\b(?:last visit|more than)\b.*?\b(\d{1,4})\s*(days?|weeks?|months?)\b/,
  );
  if (group || inactive) {
    const audience: Record<string, unknown> = {};
    if (inactive) {
      const n = Number(inactive[1] ?? inactive[3]);
      const unit = (inactive[2] ?? inactive[4]) as string;
      audience.lastVisitOlderThanDays = unit.startsWith('week')
        ? n * 7
        : unit.startsWith('month')
          ? n * 30
          : n;
    }
    const word = group?.[1]?.trim().split(' ').pop();
    if (
      word &&
      ![
        'the',
        'all',
        'my',
        'our',
        'some',
        'those',
        'these',
        'every',
        'who',
        'that',
        'new',
        'old',
      ].includes(word) &&
      !inactive
    ) {
      audience.tags = [word];
      notes.push(
        `Patients are chosen by the label "${word}". Label patients on their record; the preview shows how many match.`,
      );
    }
    if (!audience.tags && !audience.lastVisitOlderThanDays)
      return { understood: false, notes, help: HELP };
    const msg =
      quoted ??
      (audience.lastVisitOlderThanDays
        ? 'Hello {name}, it has been a while since your last visit to {clinic}. Reply BOOK if you would like to book a check-up.'
        : 'Hello {name}, this is a reminder from {clinic} to book your regular check-up if it is due. Reply BOOK to book.');
    if (!quoted)
      notes.push(
        'You did not write the message, so I used a simple reminder. Edit it below. Messages cannot contain medical advice.',
      );
    return {
      understood: true,
      name: audience.lastVisitOlderThanDays
        ? 'Bring back patients not seen for a while'
        : `Remind ${(audience.tags as string[])[0]} patients`,
      spec: {
        trigger: timing('10:00'),
        audience,
        action: { type: 'message_patients', text: { en: msg } },
      },
      notes: cadence
        ? notes
        : [
            ...notes,
            'No schedule was mentioned, so it runs every month on the 1st at 10:00. You can change this.',
          ],
    };
  }
  return { understood: false, notes, help: HELP };
}

// ---------- when does a scheduled agent run next ----------

export async function computeNextRun(
  db: Db,
  tz: string,
  trigger: z.infer<typeof TriggerSchema>,
  after = new Date(),
): Promise<Date | null> {
  if (trigger.type !== 'schedule') return null;
  for (let i = 0; i < 70; i++) {
    const c = (
      await db.query(
        `SELECT to_char((now() AT TIME ZONE $1)::date + $2::int, 'YYYY-MM-DD') AS d, extract(dow FROM (now() AT TIME ZONE $1)::date + $2::int)::int AS dow,
              extract(day FROM (now() AT TIME ZONE $1)::date + $2::int)::int AS dom`,
        [tz, i],
      )
    ).rows[0];
    const match =
      trigger.every === 'day' ||
      (trigger.every === 'week' && c.dow === trigger.weekday) ||
      (trigger.every === 'month' && c.dom === trigger.dayOfMonth);
    if (!match) continue;
    const at = (
      await db.query('SELECT (($1::date + $2::time) AT TIME ZONE $3) AS ts', [c.d, trigger.at, tz])
    ).rows[0].ts as Date;
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** Called from emitWebhook: queue a run for every active agent listening to this event. */
export async function enqueueAgentEvents(
  db: Db,
  clinicId: string,
  type: string,
  data: Record<string, unknown>,
) {
  if (!(EVENT_TRIGGERS as readonly string[]).includes(type)) return;
  const agents = (
    await db.query(
      "SELECT id, spec FROM custom_agents WHERE status='active' AND spec->'trigger'->>'type'='event' AND spec->'trigger'->>'event'=$1",
      [type],
    )
  ).rows;
  for (const a of agents) {
    const delay = Number(a.spec.trigger.delayHours ?? 0);
    await db.query(
      'INSERT INTO agent_runs (clinic_id,agent_id,run_at,patient_id,event_data) VALUES ($1,$2, now() + make_interval(hours => $3), $4, $5)',
      [clinicId, a.id, delay, (data.patientId as string) ?? null, JSON.stringify({ type })],
    );
  }
}
