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
export const RoleSchema = z.enum(['doctor', 'receptionist']);
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
