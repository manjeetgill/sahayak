import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withClinic } from '@sahayak/db';
import { callTool, MockWhatsAppChannel, ToolError, type ToolContext } from '@sahayak/core';
import { handleInbound } from '@sahayak/agents';
import type { AppDeps } from './app';

/** Local rehearsal only. Normal patient tools persist every transition.
 * Exact fictional clinic names, doctor ownership and absent live bindings are
 * checked on every request; this route can never operate on the connected clinic.
 */
export function installDemoJourney(
  app: FastifyInstance,
  deps: AppDeps,
  context: (req: FastifyRequest) => Promise<ToolContext>,
) {
  if (deps.simulator === false || process.env.NODE_ENV === 'production') return;
  const rt = { pool: deps.pool, bus: deps.bus, channel: new MockWhatsAppChannel() };
  const read = <T>(clinic: string, fn: (db: any) => Promise<T>) =>
    withClinic(deps.pool, clinic, fn);
  async function guard(req: FastifyRequest) {
    const ctx = await context(req);
    if (ctx.actor.kind !== 'staff' || ctx.actor.role !== 'doctor' || !ctx.actor.doctorId)
      throw new ToolError('forbidden', 'Use a fictional demo doctor.', 403);
    const clinic = await read(
      ctx.clinicId,
      async (db) =>
        (await db.query('SELECT slug,name FROM clinics WHERE id=$1', [ctx.clinicId])).rows[0],
    );
    const names: Record<string, string> = {
      'showcase-solo': 'DEMO · One Doctor Clinic',
      'showcase-hospital': 'DEMO · Community Hospital',
    };
    if (
      !clinic ||
      names[clinic.slug] !== clinic.name ||
      Object.values(deps.whatsappBridge ?? {}).some((b) => b.clinicId === ctx.clinicId) ||
      deps.razorpay?.clinics[ctx.clinicId]
    )
      throw new ToolError(
        'forbidden',
        'This rehearsal is available only in the disconnected fictional demo clinics.',
        403,
      );
    return { ctx, clinic, doctorId: ctx.actor.doctorId };
  }
  async function snapshot(ctx: ToolContext, patientId: string) {
    return read(ctx.clinicId, async (db) => {
      const patient = (
        await db.query('SELECT id,name,phone FROM patients WHERE id=$1 AND $2=ANY(tags)', [
          patientId,
          `journey:${ctx.actor.kind === 'staff' ? ctx.actor.doctorId : ''}`,
        ])
      ).rows[0];
      if (!patient) throw new ToolError('not_found', 'Demo patient not found.', 404);
      const first = async (sql: string) => (await db.query(sql, [patientId])).rows[0] ?? null;
      return {
        patient,
        appointment: await first(
          'SELECT id,starts_at,status FROM appointments WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1',
        ),
        arrival: await first(
          'SELECT id,status,amount_paise,waiting_answer FROM qr_arrivals WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1',
        ),
        queue: await first(
          'SELECT id,token_number,status FROM queue_entries WHERE patient_id=$1 ORDER BY checked_in_at DESC LIMIT 1',
        ),
        note: await first(
          'SELECT id,status,note FROM visit_notes WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1',
        ),
        instructions: await first(
          'SELECT id,status,body FROM patient_instructions WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1',
        ),
        feedback: await first(
          'SELECT id,status,work_status,scheduled_at FROM patient_checkins WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1',
        ),
        response: await first(
          'SELECT r.recovery,r.experience,r.suggestion FROM patient_feedback_responses r JOIN patient_checkins c ON c.id=r.checkin_id WHERE c.patient_id=$1 ORDER BY r.created_at DESC LIMIT 1',
        ),
      };
    });
  }
  app.post('/staff/demo/journey', async (req) => {
    const { ctx, clinic, doctorId } = await guard(req);
    z.object({ confirmed: z.literal(true) }).parse(req.body);
    const patient = await read(ctx.clinicId, async (db) => {
      // Extended fictional hours keep an evening rehearsal on today's visit date.
      const timings = Object.fromEntries(
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '00:00-23:59']),
      );
      await db.query('UPDATE clinic_settings SET timings=$2 WHERE clinic_id=$1', [
        ctx.clinicId,
        JSON.stringify(timings),
      ]);
      return (
        await db.query(
          "INSERT INTO patients(clinic_id,name,phone,language,tags,source) VALUES($1,'Demo Journey Patient',$2,'en',$3,'walk_in') RETURNING id,name,phone",
          [ctx.clinicId, '+910000' + randomInt(100000, 1000000), ['DEMO', `journey:${doctorId}`]],
        )
      ).rows[0];
    });
    await callTool(rt, ctx, 'save_feedback_preferences', {
      enabled: true,
      delayDays: 1,
      sendTime: '18:00',
      assignedTo: ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
      reminder: false,
      waitingQuestion: true,
      eveningEnabled: false,
    });
    return { slug: clinic.slug, doctorId, ...(await snapshot(ctx, patient.id)) };
  });
  app.get('/staff/demo/journey/:id', async (req) => {
    const { ctx, clinic, doctorId } = await guard(req);
    return {
      slug: clinic.slug,
      doctorId,
      ...(await snapshot(ctx, z.object({ id: z.string().uuid() }).parse(req.params).id)),
    };
  });
  app.post('/staff/demo/journey/:id/:step', async (req) => {
    const { ctx, clinic, doctorId } = await guard(req);
    const { id, step } = z
      .object({
        id: z.string().uuid(),
        step: z.enum([
          'late-propose',
          'late-confirm',
          'book',
          'chat',
          'arrive',
          'payment',
          'call',
          'note',
          'sign',
          'instructions',
          'finish',
          'feedback-link',
          'handoff',
        ]),
      })
      .parse(req.params);
    const b = z
      .object({
        confirmed: z.literal(true),
        accessToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        note: z.string().max(4000).optional(),
        text: z.string().trim().min(1).max(500).optional(),
      })
      .parse(req.body);
    const s = await snapshot(ctx, id);
    const tool = (name: string, input: unknown) => callTool(rt, ctx, name, input);
    let extra: Record<string, unknown> = {};
    if (step === 'late-propose') {
      if (!s.appointment || s.queue)
        throw new ToolError('booking_required', 'Book before demonstrating a delay.');
      extra = {
        shift: await tool('propose_schedule_shift', {
          doctorId,
          minutes: 15,
          requestedText: 'DEMO: running 15 minutes late',
        }),
      };
    } else if (step === 'late-confirm') {
      const proposal = await read(
        ctx.clinicId,
        async (db) =>
          (
            await db.query(
              "SELECT id FROM schedule_proposals WHERE doctor_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1",
              [doctorId],
            )
          ).rows[0],
      );
      if (!proposal || !s.appointment || s.queue)
        throw new ToolError('proposal_required', 'Prepare the practice delay first.');
      await tool('confirm_schedule_shift', { proposalId: proposal.id });
      extra = { shift: await tool('get_shift_summary', { proposalId: proposal.id }) };
    } else if (step === 'chat') {
      if (!b.text || s.queue)
        throw new ToolError('chat_unavailable', 'Use this conversation before starting the visit.');
      const reply = await handleInbound(
        { rt, gate: deps.gate },
        { clinicId: ctx.clinicId, from: s.patient.phone, text: b.text, doctorId },
      );
      extra = {
        transcript: [{ sent: b.text, reply: reply.replies.join('\n') }],
        needsStaff: reply.handledBy === 'human',
      };
    } else if (step === 'book') {
      if (s.appointment)
        throw new ToolError('already_booked', 'This patient already has an appointment.');
      const transcript = [];
      for (const text of ['Hello', '1', '1', 'earliest', '1', 'yes', 'yes']) {
        const reply = await handleInbound(
          { rt, gate: deps.gate },
          { clinicId: ctx.clinicId, from: s.patient.phone, text, doctorId },
        );
        transcript.push({ sent: text, reply: reply.replies.join('\n') });
        if (reply.handledBy === 'human')
          throw new ToolError('handoff', 'The assistant requested staff review. Open the inbox.');
      }
      extra = { transcript };
    } else if (step === 'arrive') {
      if (!s.appointment || !b.accessToken)
        throw new ToolError('book_first', 'Book a visit before QR arrival.');
      await callTool(
        rt,
        { clinicId: ctx.clinicId, actor: { kind: 'patient' } },
        'submit_qr_arrival',
        {
          name: s.patient.name,
          phone: s.patient.phone,
          doctorId,
          language: 'en',
          accessToken: b.accessToken,
          consent: { visit_data: true, whatsapp_messaging: true, reminders_followups: true },
        },
      );
      extra = { arrivalPath: `/c/${clinic.slug}/arrival#${b.accessToken}` };
    } else if (step === 'payment') {
      if (!s.arrival) throw new ToolError('arrive_first', 'Submit the patient QR form first.');
      let paymentCtx = ctx;
      if (clinic.slug === 'showcase-hospital') {
        const desk = await read(
          ctx.clinicId,
          async (db) =>
            (
              await db.query(
                "SELECT id FROM staff_users WHERE role='receptionist' AND email='desk@hospital.demo.test'",
              )
            ).rows[0],
        );
        if (!desk)
          throw new ToolError('demo_setup', 'The fictional receptionist login is missing.');
        paymentCtx = {
          clinicId: ctx.clinicId,
          actor: { kind: 'staff', role: 'receptionist', userId: desk.id },
        };
      }
      await callTool(rt, paymentCtx, 'confirm_qr_payment', {
        id: s.arrival.id,
        method: 'cash',
        confirmed: true,
      });
    } else if (step === 'call') {
      if (!s.queue || s.queue.status !== 'waiting')
        throw new ToolError('queue_first', 'Confirm the practice payment first.');
      const others = await read(
        ctx.clinicId,
        async (db) =>
          (
            await db.query(
              "SELECT id,status FROM queue_entries WHERE doctor_id=$1 AND queue_date=(now() AT TIME ZONE 'Asia/Kolkata')::date AND id<>$2 AND status IN ('waiting','called','in_consultation')",
              [doctorId, s.queue.id],
            )
          ).rows,
      );
      if (others.some((r: any) => r.status === 'in_consultation'))
        throw new ToolError(
          'room_busy',
          'Finish the active practice consultation before starting this one.',
        );
      for (const row of others) await tool('hold_patient', { queueEntryId: row.id });
      const called = await tool('call_next_patient', { doctorId });
      if (called.patient?.patientId !== id)
        throw new ToolError('queue_changed', 'The queue changed. Review the doctor screen.');
      await tool('start_consultation', { queueEntryId: s.queue.id });
      extra = { brief: await tool('get_previsit_brief', { patientId: id }) };
    } else if (step === 'note') {
      if (s.queue?.status !== 'in_consultation' || s.note)
        throw new ToolError(
          'visit_required',
          'Start this visit; a new draft must not replace an existing note.',
        );
      const text = b.note?.trim();
      if (!text) throw new ToolError('note_required', 'Review the practice note text first.');
      await tool('save_visit_note_draft', {
        patientId: id,
        queueEntryId: s.queue.id,
        transcript: text,
        source: 'typed',
        note: {
          history: text,
          instructions: 'DEMO: Contact the clinic if you need clarification.',
          follow_up: 'DEMO: The clinic will request feedback after this visit.',
        },
        flags: [],
      });
    } else if (step === 'sign') {
      if (!s.note) throw new ToolError('note_required', 'Prepare and review the note first.');
      await tool('sign_visit_note', { noteId: s.note.id });
    } else if (step === 'instructions') {
      if (s.note?.status !== 'signed')
        throw new ToolError('note_required', 'Sign the reviewed note first.');
      if (!s.instructions)
        await tool('draft_patient_instructions', {
          patientId: id,
          noteId: s.note.id,
          language: 'en',
        });
      const draft = (await snapshot(ctx, id)).instructions;
      if (draft.status !== 'approved')
        await tool('save_patient_instructions', { id: draft.id, body: draft.body, approve: true });
    } else if (step === 'finish') {
      if (!s.queue || s.note?.status !== 'signed' || s.instructions?.status !== 'approved')
        throw new ToolError('review_required', 'Sign the note and approve the instructions first.');
      await tool('finish_visit', { queueEntryId: s.queue.id });
    } else if (step === 'feedback-link') {
      if (!s.feedback)
        throw new ToolError('finish_first', 'Finish the visit to schedule feedback.');
      extra = await tool('prepare_feedback_link', { id: s.feedback.id, purpose: 'response' });
    } else if (step === 'handoff') {
      if (!s.response || !s.feedback)
        throw new ToolError('response_required', 'Submit the patient feedback form first.');
      await tool('update_feedback_case', {
        id: s.feedback.id,
        action: 'assign',
        assignedTo: ctx.actor.kind === 'staff' ? ctx.actor.userId : undefined,
        note: 'DEMO: Doctor will contact this patient to discuss the visit feedback.',
      });
    }
    return { slug: clinic.slug, doctorId, ...(await snapshot(ctx, id)), ...extra };
  });
}
