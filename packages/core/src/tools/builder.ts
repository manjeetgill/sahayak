import { z } from 'zod';
import { ClinicSettingsUpdate, violatesMedicalPolicy } from '@sahayak/shared';
import { defineTool, ToolError } from './registry';

const DOCTOR = ['staff:doctor'];
const STAFF = ['staff:doctor', 'staff:receptionist'];

export const getClinicSettings = defineTool({
  name: 'get_clinic_settings',
  description: 'Full clinic configuration for the agent builder screen.',
  module: 'core',
  input: z.object({}),
  allow: STAFF,
  async run({ db, ctx }) {
    const s = (await db.query('SELECT * FROM clinic_settings WHERE clinic_id=$1', [ctx.clinicId]))
      .rows[0];
    const phrases = (
      await db.query('SELECT id, phrase, language FROM red_flag_phrases ORDER BY phrase')
    ).rows;
    return {
      clinicName: (await db.query('SELECT name FROM clinics WHERE id=$1', [ctx.clinicId])).rows[0]
        .name,
      address: s.address,
      directions: s.directions,
      phone: s.phone,
      timings: s.timings,
      avgConsultMinutes: s.avg_consult_minutes,
      intakeQuestions: s.intake_questions,
      faqs: s.faqs,
      followupRules: s.followup_rules,
      retentionRules: s.retention_rules,
      brief: s.brief,
      aiFeatures: s.ai_features,
      myPhone:
        (
          await db.query('SELECT phone FROM staff_users WHERE id=$1', [
            ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
          ])
        ).rows[0]?.phone ?? null,
      agents: s.agents,
      modules: s.modules,
      whatsappNumber: s.whatsapp_number,
      redFlagPhrases: phrases,
      doctorWhatsappNumber:
        (
          await db.query('SELECT whatsapp_number FROM doctors WHERE id=$1', [
            ctx.actor.kind === 'staff' ? ctx.actor.doctorId : null,
          ])
        ).rows[0]?.whatsapp_number ?? null,
    };
  },
});

const COLUMN: Record<string, string> = {
  address: 'address',
  directions: 'directions',
  phone: 'phone',
  timings: 'timings',
  avgConsultMinutes: 'avg_consult_minutes',
  intakeQuestions: 'intake_questions',
  faqs: 'faqs',
  followupRules: 'followup_rules',
  retentionRules: 'retention_rules',
  brief: 'brief',
  aiFeatures: 'ai_features',
  agents: 'agents',
  modules: 'modules',
};

export const updateClinicSettings = defineTool({
  name: 'update_clinic_settings',
  description:
    'Doctor changes how the agents behave: clinic info, intake questions, FAQs, follow-up timings, which agents are on.',
  module: 'core',
  input: ClinicSettingsUpdate,
  allow: DOCTOR,
  async run({ db, ctx }, patch) {
    const cur = (await db.query('SELECT * FROM clinic_settings WHERE clinic_id=$1', [ctx.clinicId]))
      .rows[0];
    // FAQ answers are patient-facing text written by a person: hold them to the same no-medical-advice policy as the LLM.
    for (const f of patch.faqs ?? []) {
      if (violatesMedicalPolicy(f.en) || violatesMedicalPolicy(f.hi))
        throw new ToolError(
          'medical_advice_not_allowed',
          `FAQ "${f.id}" reads like medical advice. Agents may only share clinic information.`,
        );
    }
    const changed: string[] = [];
    if (patch.clinicName) {
      await db.query('SELECT rename_clinic($1)', [patch.clinicName]);
      await db.query(
        'INSERT INTO settings_changes (clinic_id,changed_by,field,before,after) VALUES ($1,$2,$3,NULL,$4)',
        [
          ctx.clinicId,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
          'clinicName',
          JSON.stringify(patch.clinicName),
        ],
      );
      changed.push('clinicName');
    }
    for (const [key, value] of Object.entries(patch)) {
      const col = COLUMN[key];
      if (!col || value === undefined) continue;
      let next: unknown = value;
      if (key === 'agents') next = { ...cur.agents, ...(value as object) };
      if (key === 'modules') next = { ...cur.modules, ...(value as object) };
      if (key === 'timings') next = { ...cur.timings, ...(value as object) };
      if (key === 'timings')
        for (const k of Object.keys(next as object))
          if (/^closed$/i.test((next as any)[k])) (next as any)[k] = '';
      const jsonb = typeof next === 'object' && next !== null;
      await db.query(`UPDATE clinic_settings SET ${col}=$2, updated_at=now() WHERE clinic_id=$1`, [
        ctx.clinicId,
        jsonb ? JSON.stringify(next) : next,
      ]);
      await db.query(
        'INSERT INTO settings_changes (clinic_id,changed_by,field,before,after) VALUES ($1,$2,$3,$4,$5)',
        [
          ctx.clinicId,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
          key,
          JSON.stringify(cur[col] ?? null),
          JSON.stringify(next),
        ],
      );
      changed.push(key);
    }
    return { ok: true, changed };
  },
});

export const addRedFlagPhrase = defineTool({
  name: 'add_red_flag_phrase',
  description: 'Add a clinic-specific emergency phrase. The built-in list cannot be reduced.',
  module: 'core',
  input: z.object({ phrase: z.string().trim().min(3).max(80), language: z.enum(['en', 'hi']) }),
  allow: STAFF,
  async run({ db, ctx }, i) {
    await db.query(
      'INSERT INTO red_flag_phrases (clinic_id,phrase,language) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [ctx.clinicId, i.phrase.toLowerCase(), i.language],
    );
    return { ok: true };
  },
});

export const removeRedFlagPhrase = defineTool({
  name: 'remove_red_flag_phrase',
  description:
    'Remove a phrase this clinic added earlier. Built-in phrases live in code and are not affected.',
  module: 'core',
  input: z.object({ id: z.string().uuid() }),
  allow: DOCTOR,
  async run({ db }, { id }) {
    await db.query('DELETE FROM red_flag_phrases WHERE id=$1', [id]);
    return { ok: true };
  },
});

export const setDoctorWhatsappNumber = defineTool({
  name: 'set_doctor_whatsapp_number',
  description:
    'Link a WhatsApp business number to a doctor: patients who write to it book with that doctor. Empty clears it.',
  module: 'core',
  input: z.object({
    doctorId: z.string().uuid().optional(),
    number: z.string().regex(/^(\+\d{10,14})?$/, 'Use international format, e.g. +919876543210'),
  }),
  allow: DOCTOR,
  async run({ db, ctx }, i) {
    const a = ctx.actor;
    const doctorId = a.kind === 'staff' && a.doctorId ? a.doctorId : i.doctorId;
    if (!doctorId) throw new ToolError('doctor_required', 'doctorId is required');
    try {
      await db.query('UPDATE doctors SET whatsapp_number=$2 WHERE id=$1', [
        doctorId,
        i.number || null,
      ]);
    } catch (e: any) {
      if (e.code === '23505')
        throw new ToolError('number_in_use', 'That number is already linked to another doctor');
      throw e;
    }
    return { ok: true };
  },
});

export const builderTools = [
  setDoctorWhatsappNumber,
  getClinicSettings,
  updateClinicSettings,
  addRedFlagPhrase,
  removeRedFlagPhrase,
];
