import { z } from 'zod';

export const LangSchema = z.enum(['en', 'hi']);
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,13}$/, 'invalid phone')
  .transform((p) => {
    const d = p.replace(/^\+/, '');
    return d.length === 10 ? `+91${d}` : `+${d}`;
  });
export const RoleSchema = z.enum(['admin', 'doctor', 'receptionist']);
export const QueueStatusSchema = z.enum([
  'waiting',
  'called',
  'in_consultation',
  'done',
  'skipped',
  'on_hold',
  'no_show',
  'cancelled',
]);

export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1) });

export const CheckinInput = z.object({
  name: z.string().trim().min(1).max(100).optional(), // required only for new patients
  phone: PhoneSchema,
  doctorId: z.string().uuid(),
  language: LangSchema.default('en'),
  /** Which link the patient used (from ?src=). Anything that is not a short plain word is dropped. */
  source: z
    .string()
    .regex(/^[a-z0-9_-]{1,30}$/)
    .optional()
    .catch(undefined),
  consent: z
    .object({
      visit_data: z.boolean().default(false), // mandatory for new patients
      whatsapp_messaging: z.boolean().default(false),
      reminders_followups: z.boolean().default(false),
    })
    .default({}),
});
export type CheckinInput = z.infer<typeof CheckinInput>;

export const InboundMessageInput = z.object({
  from: PhoneSchema,
  text: z.string().min(1).max(2000),
  /** Simulator only: pretend the patient wrote to this doctor's own WhatsApp number. */
  doctorId: z.string().uuid().optional(),
});

export const ShiftScheduleInput = z.object({
  doctorId: z.string().uuid(),
  minutes: z.number().int().min(5).max(240),
});

/** Messages the server pushes to screens over WebSocket. */
export type LiveEvent =
  | { type: 'queue_changed'; doctorId?: string }
  | { type: 'flag_raised'; flagId: string; severity: 'normal' | 'urgent' }
  | { type: 'flag_resolved'; flagId: string }
  | { type: 'conversation_updated'; conversationId: string }
  | { type: 'schedule_proposal'; proposalId: string }
  | { type: 'llm_status'; ok: boolean };

// ---- Agent builder: what a doctor may configure ----
const Window = z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
const TimingsValue = z
  .string()
  .max(60)
  .refine(
    (v) =>
      v === '' ||
      /^closed$/i.test(v) ||
      v.split(',').every((w) => Window.safeParse(w.trim()).success),
    'Use HH:MM-HH:MM, comma separated, or Closed',
  );
export const AGENT_NAMES = [
  'checkin',
  'queue',
  'intake',
  'front_desk',
  'schedule',
  'followup',
  'leads',
  'records',
] as const;
export const ClinicSettingsUpdate = z
  .object({
    clinicName: z.string().trim().min(2).max(80),
    reputation: z.object({
      enabled: z.boolean(),
      review_url: z.union([
        z.literal(''),
        z
          .string()
          .url()
          .max(300)
          .refine((u) => u.startsWith('https://'), 'Use an https link'),
      ]),
      delay_hours: z.number().int().min(1).max(72),
      show_rating: z.boolean(),
    }),
    publicPage: z.object({ about: z.string().max(600) }),
    aiFeatures: z.object({ scribe: z.boolean() }),
    brief: z.object({ enabled: z.boolean(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
    address: z.string().max(300),
    directions: z.string().max(500),
    phone: z.string().max(20),
    timings: z.record(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), TimingsValue),
    avgConsultMinutes: z.number().int().min(1).max(120),
    intakeQuestions: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_]{1,30}$/),
          en: z.string().min(1).max(200),
          hi: z.string().min(1).max(200),
        }),
      )
      .max(10),
    faqs: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_]{1,30}$/),
          keywords: z.array(z.string().min(2).max(40)).min(1).max(8),
          en: z.string().min(1).max(400),
          hi: z.string().min(1).max(400),
        }),
      )
      .max(50),
    followupRules: z.object({
      reminder_hours_before: z.number().int().min(1).max(168),
      post_visit_hours: z.number().int().min(1).max(168),
      recall_days: z.number().int().min(14).max(730),
    }),
    retentionRules: z.object({
      messages_days: z.number().int().min(30).max(3650),
      intake_days: z.number().int().min(30).max(3650),
      audit_days: z.number().int().min(365).max(3650),
      inactive_patient_days: z.number().int().min(365).max(3650),
      clinical_years: z.number().int().min(3).max(30).optional(),
    }),
    agents: z
      .object(
        Object.fromEntries(AGENT_NAMES.map((a) => [a, z.boolean()])) as Record<
          (typeof AGENT_NAMES)[number],
          z.ZodBoolean
        >,
      )
      .partial(),
    modules: z.record(
      z.enum(['checkin', 'queue', 'appointments', 'followups', 'leads']),
      z.boolean(),
    ),
  })
  .partial();
export type ClinicSettingsUpdate = z.infer<typeof ClinicSettingsUpdate>;
