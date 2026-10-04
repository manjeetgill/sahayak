import { z } from 'zod';
import { normalise, t, type Lang, type MessageKey } from '@sahayak/shared';
import type { Db } from '@sahayak/db';
import { defineTool, ToolError, type ToolRun } from './registry';
import { clinicToday, deliver, ensureConversation, getSettings, storeMessage } from './common';

const STAFF = ['staff:doctor', 'staff:receptionist'];

export const METRICS = [
  'seen',
  'no_shows',
  'appointments',
  'cancellations',
  'new_patients',
  'wait',
  'consult',
  'busiest',
  'upcoming',
  'flags',
  'messages',
] as const;
export type Metric = (typeof METRICS)[number];
export interface Range {
  from: string;
  to: string;
  label: MessageKey;
  vars?: Record<string, string | number>;
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const mondayOf = (iso: string) => addDays(iso, -((dow(iso) + 6) % 7));
const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;

/** What day or period is the question about? `future` metrics default to tomorrow, the others to today. */
export function parseRange(text: string, today: string, future = false): Range {
  const n = normalise(text);
  if (/\b(day before yesterday|parso)\b|परसों/.test(n) && !future)
    return {
      from: addDays(today, -2),
      to: addDays(today, -2),
      label: 'label.on_date',
      vars: { date: addDays(today, -2) },
    };
  const last = n.match(
    /\b(?:last|past|pichle|pichhle)\s+(\d{1,3})\s+(?:days?|din)\b|पिछले\s+(\d{1,3})\s+दिन/,
  );
  if (last) {
    const d = Number(last[1] ?? last[2]);
    return {
      from: addDays(today, -(d - 1)),
      to: today,
      label: 'label.last_n_days',
      vars: { n: d },
    };
  }
  if (
    /\b(last week|previous week|pichle hafte|pichhle hafte)\b|पिछले हफ़्?ते|पिछले सप्ताह/.test(n)
  ) {
    const m = addDays(mondayOf(today), -7);
    return { from: m, to: addDays(m, 6), label: 'label.last_week' };
  }
  if (/\b(this week|is hafte|iss hafte)\b|इस हफ़्?ते|इस सप्ताह/.test(n))
    return {
      from: mondayOf(today),
      to: future ? addDays(mondayOf(today), 6) : today,
      label: 'label.this_week',
    };
  if (/\b(last month|pichle mahine)\b|पिछले महीने/.test(n)) {
    const first = monthStart(addDays(monthStart(today), -1));
    return { from: first, to: addDays(monthStart(today), -1), label: 'label.last_month' };
  }
  if (/\b(this month|is mahine|iss mahine)\b|इस महीने/.test(n))
    return { from: monthStart(today), to: today, label: 'label.this_month' };
  if (/\byesterday\b/.test(n) || (!future && /\bkal\b|कल/.test(n)))
    return { from: addDays(today, -1), to: addDays(today, -1), label: 'label.yesterday' };
  if (/\btomorrow\b/.test(n) || (future && /\bkal\b|कल/.test(n)))
    return { from: addDays(today, 1), to: addDays(today, 1), label: 'label.tomorrow' };
  if (/\b(today|aaj)\b|आज/.test(n)) return { from: today, to: today, label: 'label.today' };
  return future
    ? { from: addDays(today, 1), to: addDays(today, 1), label: 'label.tomorrow' }
    : { from: today, to: today, label: 'label.today' };
}

const KEYWORDS: [Metric, RegExp][] = [
  [
    'no_shows',
    /no[- ]?shows?|didn'?t show|did not (show|come|turn)|not show|absent|missed (their )?(appointment|visit)|nahi aaye|nahi aae|नहीं आए|नहीं आये|नो[- ]?शो|गैरहाज़िर/,
  ],
  ['cancellations', /cancel|रद्द|कैंसल/],
  ['new_patients', /new patients?|naye (patient|mareez|marij)|first[- ]time|नए मरीज़|नये मरीज़/],
  ['wait', /\bwait(ing)?\b|इंतज़ार|इंतजार|intezaar|intezar/],
  [
    'consult',
    /consult(ation)? (time|duration)|how long (per|each|for each)|per patient time|average (consult|visit) time|परामर्श समय/,
  ],
  ['busiest', /busiest|peak|rush|busy hours|vyast|व्यस्त|भीड़/],
  ['flags', /alerts?|emergenc|flags?|pending (issues|items)|attention|अलर्ट|आपातकाल/],
  ['messages', /messages?|chats?|whatsapp|संदेश|मैसेज/],
  [
    'upcoming',
    /upcoming|next (few )?(days?|week)|scheduled|(appointments?|bookings?|schedule).*(tomorrow|kal|कल)|(tomorrow|kal|कल).*(appointments?|bookings?|schedule)|अपॉइंटमेंट.*(कल|आज)|कल के अपॉइंटमेंट/,
  ],
  ['appointments', /appointments?|bookings?|booked|schedule|अपॉइंटमेंट|बुकिंग/],
  [
    'seen',
    /how many (patients?|people|visits)|patients? (seen|treated|came|visited)|footfall|kitne (patient|mareez|marij|log)|कितने (मरीज़|मरीज|लोग)|मरीज़ देखे|visits?\b/,
  ],
];

/** Understand a question about the clinic. Deterministic: works with no AI. Returns null if it is not a question we know. */
export function parseClinicQuestion(
  text: string,
  today: string,
): { metric: Metric; range: Range } | null {
  const n = normalise(text);
  const hit = KEYWORDS.find(([, re]) => re.test(n));
  if (!hit) return null;
  const metric = hit[0];
  return { metric, range: parseRange(text, today, metric === 'upcoming') };
}

type MetricResult = Record<string, any>;

export async function runMetric(
  db: Db,
  clinicId: string,
  metric: Metric,
  from: string,
  to: string,
  doctorId: string | null,
): Promise<MetricResult> {
  const { tz } = await clinicToday(db, clinicId);
  // Each query uses some of ($1 from, $2 to, $3 doctor, $4 timezone). Renumber to just the ones it mentions.
  const all = [from, to, doctorId, tz];
  const q = async (sql: string) => {
    const used = [...new Set([...sql.matchAll(/\$(\d)/g)].map((m) => Number(m[1])))].sort();
    const renumbered = sql.replace(/\$(\d)/g, (_, n) => `$${used.indexOf(Number(n)) + 1}`);
    return (
      await db.query(
        renumbered,
        used.map((n) => all[n - 1]),
      )
    ).rows;
  };
  switch (metric) {
    case 'seen':
      return {
        n: (
          await q(
            "SELECT count(*)::int n FROM queue_entries WHERE queue_date BETWEEN $1 AND $2 AND status='done' AND ($3::uuid IS NULL OR doctor_id=$3)",
          )
        )[0].n,
      };
    case 'no_shows': {
      const rows = await q(
        `SELECT DISTINCT p.name FROM (
           SELECT patient_id FROM appointments WHERE status='no_show' AND (starts_at AT TIME ZONE $4)::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR doctor_id=$3)
           UNION SELECT patient_id FROM queue_entries WHERE status='no_show' AND queue_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR doctor_id=$3)) x
         JOIN patients p ON p.id=x.patient_id LIMIT 30`,
      );
      return { n: rows.length, names: rows.map((r) => r.name as string) };
    }
    case 'appointments': {
      const r = (
        await q(
          `SELECT count(*)::int n, count(*) FILTER (WHERE status IN ('booked','checked_in'))::int booked, count(*) FILTER (WHERE status='completed')::int done,
                count(*) FILTER (WHERE status='cancelled')::int cancelled, count(*) FILTER (WHERE status='no_show')::int noshow
           FROM appointments WHERE (starts_at AT TIME ZONE $4)::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR doctor_id=$3)`,
        )
      )[0];
      return r;
    }
    case 'cancellations':
      return {
        n: (
          await q(
            "SELECT count(*)::int n FROM appointments WHERE status='cancelled' AND (starts_at AT TIME ZONE $4)::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR doctor_id=$3)",
          )
        )[0].n,
      };
    case 'new_patients':
      return {
        n: (
          await q(
            'SELECT count(*)::int n FROM patients WHERE (created_at AT TIME ZONE $4)::date BETWEEN $1 AND $2',
          )
        )[0].n,
      };
    case 'wait': {
      const r = (
        await q(
          'SELECT count(*)::int n, COALESCE(round(avg(extract(epoch FROM (called_at - checked_in_at))/60)::numeric),0)::int m FROM queue_entries WHERE queue_date BETWEEN $1 AND $2 AND called_at IS NOT NULL AND ($3::uuid IS NULL OR doctor_id=$3)',
        )
      )[0];
      return r;
    }
    case 'consult': {
      const r = (
        await q(
          'SELECT count(*)::int n, COALESCE(round(avg(extract(epoch FROM (finished_at - called_at))/60)::numeric),0)::int m FROM queue_entries WHERE queue_date BETWEEN $1 AND $2 AND finished_at IS NOT NULL AND called_at IS NOT NULL AND ($3::uuid IS NULL OR doctor_id=$3)',
        )
      )[0];
      return r;
    }
    case 'busiest': {
      const rows = await q(
        'SELECT extract(hour FROM checked_in_at AT TIME ZONE $4)::int h, count(*)::int c FROM queue_entries WHERE queue_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR doctor_id=$3) GROUP BY 1 ORDER BY c DESC, h LIMIT 3',
      );
      return { hours: rows.map((r) => ({ hour: r.h as number, count: r.c as number })) };
    }
    case 'upcoming': {
      const rows = await q(
        `SELECT p.name FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id
          WHERE a.status IN ('booked','checked_in') AND (a.starts_at AT TIME ZONE $4)::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR a.doctor_id=$3) ORDER BY a.starts_at LIMIT 15`,
      );
      const n = (
        await q(
          "SELECT count(*)::int n FROM appointments WHERE status IN ('booked','checked_in') AND (starts_at AT TIME ZONE $4)::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR doctor_id=$3)",
        )
      )[0].n;
      return { n, names: rows.map((r) => (r.name ?? 'Walk-in') as string) };
    }
    case 'flags': {
      const r = (
        await q(
          "SELECT count(*)::int open, count(*) FILTER (WHERE severity='urgent')::int urgent FROM flags WHERE status='open'",
        )
      )[0];
      return r;
    }
    case 'messages': {
      const r = (
        await q(
          `SELECT count(*)::int n, count(DISTINCT m.conversation_id) FILTER (WHERE c.handled_by='human')::int human FROM messages m JOIN conversations c ON c.id=m.conversation_id
          WHERE m.direction='in' AND (m.created_at AT TIME ZONE $4)::date BETWEEN $1 AND $2`,
        )
      )[0];
      return r;
    }
  }
}

const hh = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
const label = (lang: Lang, r: Range) => t(lang, r.label, r.vars ?? {});
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatMetric(lang: Lang, metric: Metric, r: Range, d: MetricResult): string {
  const l = label(lang, r);
  const names = (list: string[]) => (list.length ? `: ${list.join(', ')}` : '');
  switch (metric) {
    case 'seen':
      return t(lang, 'ask.seen', { n: d.n, label: l });
    case 'no_shows':
      return d.n
        ? t(lang, 'ask.no_shows', { n: d.n, label: l, names: d.names.join(', ') })
        : t(lang, 'ask.no_shows_none', { label: l });
    case 'appointments':
      return t(lang, 'ask.appointments', { ...d, label: l });
    case 'cancellations':
      return t(lang, 'ask.cancellations', { n: d.n, label: l });
    case 'new_patients':
      return t(lang, 'ask.new_patients', { n: d.n, label: l });
    case 'wait':
      return d.n ? t(lang, 'ask.wait', { ...d, label: l }) : t(lang, 'ask.no_data', { label: l });
    case 'consult':
      return d.n
        ? t(lang, 'ask.consult', { ...d, label: l })
        : t(lang, 'ask.no_data', { label: l });
    case 'busiest':
      return d.hours.length
        ? t(lang, 'ask.busiest', {
            label: l,
            hours: d.hours.map((x: any) => `${hh(x.hour)} (${x.count})`).join(', '),
          })
        : t(lang, 'ask.no_data', { label: l });
    case 'upcoming':
      return t(lang, 'ask.upcoming', { n: d.n, label: l, names: names(d.names) });
    case 'flags':
      return t(lang, 'ask.flags', d as any);
    case 'messages':
      return t(lang, 'ask.messages', { ...d, label: l });
  }
}

/** Doctors see their own patients unless they say "clinic" / "all doctors"; the receptionist sees the whole clinic. */
function scopeDoctor(r: ToolRun, question: string): string | null {
  const a = r.ctx.actor;
  if (
    a.kind === 'staff' &&
    a.role === 'doctor' &&
    a.doctorId &&
    !/\b(clinic|everyone|all doctors|overall|total)\b|पूरे क्लिनिक|सभी डॉक्टर/i.test(question)
  )
    return a.doctorId;
  return null;
}

export const clinicMetric = defineTool({
  name: 'clinic_metric',
  description:
    'A numeric fact about the clinic over a date range (patients seen, no-shows, waits...).',
  module: 'core',
  scope: 'read',
  input: z.object({
    metric: z.enum(METRICS),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    doctorId: z.string().uuid().optional(),
  }),
  allow: STAFF,
  async run({ db, ctx }, i) {
    return runMetric(db, ctx.clinicId, i.metric, i.from, i.to, i.doctorId ?? null);
  },
});

export const askClinic = defineTool({
  name: 'ask_clinic',
  description:
    "Answer a question about how the clinic is doing, from the clinic's own data. Read-only.",
  module: 'core',
  input: z.object({
    question: z.string().trim().min(2).max(300),
    lang: z.enum(['en', 'hi']).optional(),
    metric: z.enum(METRICS).optional(),
  }),
  allow: STAFF,
  auditInput: (i) => ({ question: i.question.slice(0, 120) }),
  async run(r, i) {
    const { db, ctx } = r;
    const s = await getSettings(db, ctx.clinicId);
    const { date: today } = await clinicToday(db, ctx.clinicId);
    const lang: Lang = i.lang ?? (/[ऀ-ॿ]/.test(i.question) ? 'hi' : 'en');
    const parsed =
      parseClinicQuestion(i.question, today) ??
      (i.metric
        ? { metric: i.metric, range: parseRange(i.question, today, i.metric === 'upcoming') }
        : null);
    if (!parsed) return { understood: false, answer: t(lang, 'ask.help'), lang };
    if (i.metric && i.metric !== parsed.metric) {
      parsed.metric = i.metric;
      parsed.range = parseRange(i.question, today, i.metric === 'upcoming');
    }
    const data = await runMetric(
      db,
      ctx.clinicId,
      parsed.metric,
      parsed.range.from,
      parsed.range.to,
      scopeDoctor(r, i.question),
    );
    void s;
    return {
      understood: true,
      metric: parsed.metric,
      from: parsed.range.from,
      to: parsed.range.to,
      data,
      answer: formatMetric(lang, parsed.metric, parsed.range, data),
      lang,
    };
  },
});

/** The end-of-day numbers for one day (optionally one doctor), as data and as text. */
export async function composeBrief(
  db: Db,
  clinicId: string,
  date: string,
  doctorId: string | null,
  lang: Lang,
) {
  const s = await getSettings(db, clinicId);
  const m = (metric: Metric, from = date, to = date) =>
    runMetric(db, clinicId, metric, from, to, doctorId);
  const tomorrow = addDays(date, 1);
  const [seen, no, canc, newp, wait, up, flags, msgs] = await Promise.all([
    m('seen'),
    m('no_shows'),
    m('cancellations'),
    m('new_patients'),
    m('wait'),
    m('upcoming', tomorrow, tomorrow),
    m('flags'),
    m('messages'),
  ]);
  const redFlagsToday = (
    await db.query(
      "SELECT count(*)::int n FROM flags WHERE kind='red_flag' AND (created_at AT TIME ZONE $2)::date = $1::date",
      [date, s.timezone],
    )
  ).rows[0].n as number;
  const lines = [
    t(lang, 'brief.title', { clinic: s.clinic_name, date }),
    t(lang, 'brief.seen', { n: seen.n }),
  ];
  if (no.n) lines.push(t(lang, 'brief.no_shows', { n: no.n, names: `: ${no.names.join(', ')}` }));
  if (canc.n) lines.push(t(lang, 'brief.cancellations', { n: canc.n }));
  if (newp.n) lines.push(t(lang, 'brief.new', { n: newp.n }));
  if (wait.n) lines.push(t(lang, 'brief.wait', { m: wait.m }));
  lines.push(t(lang, 'brief.tomorrow', { n: up.n }));
  if (redFlagsToday || flags.open)
    lines.push(t(lang, 'brief.alerts', { n: redFlagsToday, open: flags.open }));
  if (msgs.n) lines.push(t(lang, 'brief.messages', { n: msgs.n, human: msgs.human }));
  if (!seen.n && !no.n && !canc.n && !redFlagsToday && !flags.open && !msgs.n)
    lines.push(t(lang, 'brief.quiet'));
  return {
    text: lines.join('\n'),
    data: {
      date,
      seen: seen.n,
      noShows: no.names,
      cancellations: canc.n,
      newPatients: newp.n,
      avgWaitMinutes: wait.m,
      tomorrow: up.n,
      openFlags: flags.open,
      redFlagsToday,
      messages: msgs.n,
    },
  };
}

export const buildDailyBrief = defineTool({
  name: 'build_daily_brief',
  description: "The day's summary for the doctor or the clinic (does not send anything).",
  module: 'core',
  scope: 'read',
  input: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    lang: z.enum(['en', 'hi']).optional(),
  }),
  allow: STAFF,
  async run(r, i) {
    const { db, ctx } = r;
    const s = await getSettings(db, ctx.clinicId);
    const date = i.date ?? (await clinicToday(db, ctx.clinicId)).date;
    return composeBrief(db, ctx.clinicId, date, scopeDoctor(r, ''), i.lang ?? s.default_language);
  },
});

export const setMyPhone = defineTool({
  name: 'set_my_phone',
  description:
    'Set the WhatsApp number where I receive the daily brief and can ask questions. Empty clears it.',
  module: 'core',
  input: z.object({
    phone: z.string().regex(/^(\+\d{10,14})?$/, 'Use international format, e.g. +919876543210'),
  }),
  allow: STAFF,
  async run({ db, ctx }, { phone }) {
    if (ctx.actor.kind !== 'staff') throw new ToolError('forbidden', 'Staff only', 403);
    try {
      await db.query('UPDATE staff_users SET phone=$2 WHERE id=$1', [
        ctx.actor.userId,
        phone || null,
      ]);
    } catch (e: any) {
      throw e;
    }
    return { ok: true };
  },
});

/** Used when a WhatsApp message arrives: is the sender one of our staff? */
export const identifyStaffPhone = defineTool({
  name: 'identify_staff_phone',
  description: "Is this phone number a staff member's registered WhatsApp number?",
  module: 'core',
  input: z.object({ phone: z.string() }),
  allow: ['patient', 'system'],
  async run({ db }, { phone }) {
    const u = (
      await db.query('SELECT id, role, doctor_id, name FROM staff_users WHERE phone=$1 LIMIT 1', [
        phone,
      ])
    ).rows[0];
    return u
      ? {
          staff: true,
          userId: u.id as string,
          role: u.role as 'doctor' | 'receptionist',
          doctorId: (u.doctor_id ?? null) as string | null,
          name: u.name as string,
        }
      : { staff: false };
  },
});

/** Send each opted-in doctor their summary once a day after the clinic's brief time. Called by the job. */
export const sendDailyBriefs = defineTool({
  name: 'send_daily_briefs',
  description:
    "Compose and send today's brief to staff who have a WhatsApp number, once per day, after the configured time.",
  module: 'core',
  input: z.object({ force: z.boolean().default(false) }),
  allow: ['system'],
  async run(r, { force }) {
    const { db, ctx } = r;
    const s = (await getSettings(db, ctx.clinicId)) as any;
    const cfg = s.brief ?? {};
    if (!cfg.enabled && !force) return { sent: 0 };
    const nowLocal = (
      await db.query(
        "SELECT to_char(now() AT TIME ZONE $1,'HH24:MI') AS hm, to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS d",
        [s.timezone],
      )
    ).rows[0];
    if (!force && nowLocal.hm < (cfg.time ?? '20:00')) return { sent: 0 };
    let sent = 0;
    const users = (
      await db.query(
        'SELECT id, name, role, doctor_id, phone FROM staff_users WHERE phone IS NOT NULL',
      )
    ).rows;
    for (const u of users) {
      const exists = await db.query(
        'SELECT 1 FROM daily_briefs WHERE brief_date=$1 AND staff_user_id=$2',
        [nowLocal.d, u.id],
      );
      if (exists.rowCount) continue;
      const brief = await composeBrief(
        db,
        ctx.clinicId,
        nowLocal.d,
        u.role === 'doctor' ? u.doctor_id : null,
        s.default_language,
      );
      const conv = await ensureConversation(db, ctx.clinicId, u.phone, null, s.default_language);
      await storeMessage(db, ctx.clinicId, conv.id, 'out', 'agent:brief', brief.text);
      await deliver(r, { to: u.phone, text: brief.text, lang: s.default_language });
      await db.query(
        'INSERT INTO daily_briefs (clinic_id,brief_date,staff_user_id,text,data,delivered) VALUES ($1,$2,$3,$4,$5,true)',
        [ctx.clinicId, nowLocal.d, u.id, brief.text, JSON.stringify(brief.data)],
      );
      sent++;
    }
    return { sent };
  },
});

void cap;
export const askTools = [
  clinicMetric,
  askClinic,
  buildDailyBrief,
  setMyPhone,
  identifyStaffPhone,
  sendDailyBriefs,
];
