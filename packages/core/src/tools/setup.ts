import { z } from 'zod';
import { hashPassword } from '@sahayak/db';
import { defineTool, ToolError } from './registry';

const DOCTOR = ['staff:doctor'];
const STAFF = ['staff:doctor', 'staff:receptionist'];
const NUM = /^(\+\d{10,14})?$/;

export const addDoctor = defineTool({
  name: 'add_doctor',
  description: 'Add a doctor to the clinic.',
  module: 'core',
  input: z.object({
    name: z.string().trim().min(2).max(80),
    speciality: z.string().trim().max(80).optional(),
    slotMinutes: z.number().int().min(5).max(120).default(15),
    whatsappNumber: z.string().regex(NUM).optional(),
  }),
  allow: DOCTOR,
  async run({ db, ctx }, i) {
    try {
      const r = await db.query(
        'INSERT INTO doctors (clinic_id,name,speciality,slot_minutes,whatsapp_number) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [ctx.clinicId, i.name, i.speciality ?? null, i.slotMinutes, i.whatsappNumber || null],
      );
      return { doctorId: r.rows[0].id as string };
    } catch (e: any) {
      if (e.code === '23505')
        throw new ToolError(
          'number_in_use',
          'That WhatsApp number is already linked to another doctor',
        );
      throw e;
    }
  },
});

export const updateDoctor = defineTool({
  name: 'update_doctor',
  description:
    "Change a doctor's details, or deactivate them (the clinic must keep at least one active doctor).",
  module: 'core',
  input: z.object({
    doctorId: z.string().uuid(),
    name: z.string().trim().min(2).max(80).optional(),
    speciality: z.string().trim().max(80).optional(),
    slotMinutes: z.number().int().min(5).max(120).optional(),
    active: z.boolean().optional(),
    whatsappNumber: z.string().regex(NUM).optional(),
  }),
  allow: DOCTOR,
  async run({ db }, i) {
    if (i.active === false) {
      const others = await db.query('SELECT count(*)::int n FROM doctors WHERE active AND id<>$1', [
        i.doctorId,
      ]);
      if (others.rows[0].n === 0)
        throw new ToolError('last_doctor', 'The clinic needs at least one active doctor');
    }
    try {
      const u = await db.query(
        `UPDATE doctors SET name=COALESCE($2,name), speciality=COALESCE($3,speciality), slot_minutes=COALESCE($4,slot_minutes), active=COALESCE($5,active),
           whatsapp_number = CASE WHEN $6::text IS NULL THEN whatsapp_number WHEN $6 = '' THEN NULL ELSE $6 END WHERE id=$1 RETURNING id`,
        [
          i.doctorId,
          i.name ?? null,
          i.speciality ?? null,
          i.slotMinutes ?? null,
          i.active ?? null,
          i.whatsappNumber ?? null,
        ],
      );
      if (!u.rowCount) throw new ToolError('not_found', 'Doctor not found', 404);
    } catch (e: any) {
      if (e.code === '23505')
        throw new ToolError(
          'number_in_use',
          'That WhatsApp number is already linked to another doctor',
        );
      throw e;
    }
    return { ok: true };
  },
});

export const addStaff = defineTool({
  name: 'add_staff',
  description:
    'Create a login for a receptionist or another doctor. The doctor shares the temporary password in person.',
  module: 'core',
  input: z.object({
    email: z
      .string()
      .email()
      .max(120)
      .transform((e) => e.toLowerCase()),
    name: z.string().trim().min(2).max(80),
    role: z.enum(['receptionist', 'doctor']),
    password: z.string().min(10, 'Password must be at least 10 characters').max(100),
    doctorId: z.string().uuid().optional(),
  }),
  allow: DOCTOR,
  auditOutput: (o: any) => ({ id: o.id }),
  async run({ db, ctx }, i) {
    if (i.role === 'doctor' && !i.doctorId)
      throw new ToolError('doctor_required', 'Link a doctor login to a doctor');
    try {
      const r = await db.query(
        'INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [
          ctx.clinicId,
          i.email,
          await hashPassword(i.password),
          i.name,
          i.role,
          i.role === 'doctor' ? i.doctorId : null,
        ],
      );
      return { id: r.rows[0].id as string };
    } catch (e: any) {
      if (e.code === '23505') throw new ToolError('email_in_use', 'That email already has a login');
      throw e;
    }
  },
});

export const listStaff = defineTool({
  name: 'list_staff',
  description: 'Logins for this clinic.',
  module: 'core',
  input: z.object({}),
  allow: STAFF,
  async run({ db }) {
    return {
      staff: (
        await db.query(
          'SELECT id, email, name, role, doctor_id FROM staff_users ORDER BY role, name',
        )
      ).rows,
    };
  },
});

export const removeStaff = defineTool({
  name: 'remove_staff',
  description: 'Delete a login (not your own, and not the last doctor login).',
  module: 'core',
  input: z.object({ id: z.string().uuid() }),
  allow: DOCTOR,
  async run({ db, ctx }, { id }) {
    if (ctx.actor.kind === 'staff' && ctx.actor.userId === id)
      throw new ToolError('self', 'You cannot remove your own login');
    const u = (await db.query('SELECT role FROM staff_users WHERE id=$1', [id])).rows[0];
    if (!u) throw new ToolError('not_found', 'Login not found', 404);
    if (
      u.role === 'doctor' &&
      (
        await db.query("SELECT count(*)::int n FROM staff_users WHERE role='doctor' AND id<>$1", [
          id,
        ])
      ).rows[0].n === 0
    )
      throw new ToolError('last_doctor', 'The clinic needs at least one doctor login');
    await db.query('DELETE FROM staff_users WHERE id=$1', [id]);
    return { ok: true };
  },
});

/** What still needs doing before the clinic goes live. */
export const getSetupStatus = defineTool({
  name: 'get_setup_status',
  description: 'Setup checklist for the guided onboarding.',
  module: 'core',
  input: z.object({}),
  allow: STAFF,
  async run({ db, ctx }) {
    const s = (
      await db.query(
        'SELECT s.*, c.name AS clinic_name, c.slug FROM clinic_settings s JOIN clinics c ON c.id=s.clinic_id WHERE s.clinic_id=$1',
        [ctx.clinicId],
      )
    ).rows[0];
    const count = async (sql: string) => (await db.query(sql)).rows[0].n as number;
    const openDays = Object.values(s.timings as Record<string, string>).filter(
      (v) => v && v.trim(),
    ).length;
    const items = [
      {
        id: 'info',
        required: true,
        ok: !!(s.address && s.phone),
        label: 'Clinic address and phone',
        hint: 'Patients ask for these most.',
      },
      {
        id: 'timings',
        required: true,
        ok: openDays > 0,
        label: 'Opening hours',
        hint: 'Used to offer appointment slots.',
      },
      {
        id: 'doctor',
        required: true,
        ok: (await count('SELECT count(*)::int n FROM doctors WHERE active')) > 0,
        label: 'At least one doctor',
        hint: '',
      },
      {
        id: 'receptionist',
        required: true,
        ok: (await count("SELECT count(*)::int n FROM staff_users WHERE role='receptionist'")) > 0,
        label: 'A receptionist login',
        hint: 'The person who supervises the assistant.',
      },
      {
        id: 'intake',
        required: true,
        ok: (s.intake_questions as unknown[]).length > 0,
        label: 'Intake questions',
        hint: 'Asked while the patient waits.',
      },
      {
        id: 'faq',
        required: false,
        ok: (s.faqs as unknown[]).length > 0,
        label: 'Answers to common questions',
        hint: 'Parking, insurance, languages spoken...',
      },
      {
        id: 'whatsapp',
        required: false,
        ok:
          !!s.whatsapp_number ||
          (await count('SELECT count(*)::int n FROM doctors WHERE whatsapp_number IS NOT NULL')) >
            0,
        label: 'WhatsApp number linked',
        hint: 'Until a real WhatsApp provider is connected, use the simulator.',
      },
      {
        id: 'tested',
        required: false,
        ok: (await count("SELECT count(*)::int n FROM messages WHERE direction='in'")) > 0,
        label: 'Tried a test chat',
        hint: 'Open the WhatsApp simulator and say hello.',
      },
    ];
    return {
      completed: s.setup?.completed === true,
      slug: s.slug,
      clinicName: s.clinic_name,
      items,
      readyToFinish: items.filter((i) => i.required).every((i) => i.ok),
    };
  },
});

export const completeSetup = defineTool({
  name: 'complete_setup',
  description: 'Mark onboarding finished (all required items must be done).',
  module: 'core',
  input: z.object({}),
  allow: DOCTOR,
  async run(r) {
    const st = await getSetupStatus.run(r, {});
    if (!st.readyToFinish)
      throw new ToolError(
        'setup_incomplete',
        `Still needed: ${st.items
          .filter((i: any) => i.required && !i.ok)
          .map((i: any) => i.label)
          .join(', ')}`,
      );
    await r.db.query(`UPDATE clinic_settings SET setup='{"completed": true}' WHERE clinic_id=$1`, [
      r.ctx.clinicId,
    ]);
    return { ok: true };
  },
});

export const setupTools = [
  addDoctor,
  updateDoctor,
  addStaff,
  listStaff,
  removeStaff,
  getSetupStatus,
  completeSetup,
];
