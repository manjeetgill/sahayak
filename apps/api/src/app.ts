import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z, ZodError } from 'zod';
import {
  llmInterpret,
  answerStaffQuestion,
  handleInbound,
  handleInboundMedia,
  structureNote,
  parseLateRequest,
  startIntakeFor,
  type AgentEnv,
  type LlmGate,
} from '@sahayak/agents';
import {
  callTool,
  hashKey,
  WEBHOOK_EVENTS,
  MockSpeechToText,
  MockTextToSpeech,
  type ChannelPlugin,
  type SpeechToText,
  type TextToSpeech,
  queueSnapshot,
  registerAllTools,
  ToolError,
  type Actor,
  type EventBus,
  type ToolContext,
} from '@sahayak/core';
import { hashPassword, verifyPassword, withClinic } from '@sahayak/db';
import { openApiSpec } from './openapi';
import {
  BUILTIN_RED_FLAGS,
  CheckinInput,
  InboundMessageInput,
  LoginInput,
  PhoneSchema,
  type LiveEvent,
} from '@sahayak/shared';

export interface AppDeps {
  /** Real WhatsApp channel + inbound adapter (omit for the mock simulator). */
  whatsapp?: ChannelPlugin;
  stt?: SpeechToText;
  tts?: TextToSpeech;
  pool: pg.Pool;
  bus: EventBus;
  gate: LlmGate;
  jwtSecret: string;
  simulator?: boolean;
}
/** Clinics with a staff screen connected: LLM health changes are pushed to these. */
export const activeClinics = new Set<string>();
type Claims = {
  uid: string;
  clinicId: string;
  role: 'doctor' | 'receptionist';
  doctorId: string | null;
  name: string;
};

export async function buildApp(deps: AppDeps) {
  registerAllTools();
  const { pool, bus, gate } = deps;
  const rt = { pool, bus, channel: deps.whatsapp?.messaging };
  const stt = deps.stt ?? new MockSpeechToText();
  const tts = deps.tts ?? new MockTextToSpeech();
  const env: AgentEnv = { rt, gate };
  const app = Fastify({
    bodyLimit: 12_000_000, // photo/PDF uploads (8 MB file as base64)
    logger:
      process.env.NODE_ENV !== 'test'
        ? { level: 'info', redact: ['req.headers.authorization'] }
        : false,
  });
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: deps.jwtSecret });
  await app.register(websocket);
  // Keep the raw JSON body: webhook signatures are computed over the exact bytes the vendor sent.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  app.addContentTypeParser(
    /^audio\//,
    { parseAs: 'buffer', bodyLimit: 10_000_000 },
    (_req, body, done) => done(null, body),
  );

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ToolError)
      return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError)
      return reply.status(400).send({
        error: 'invalid_input',
        message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    if (err.statusCode && err.statusCode < 500)
      return reply
        .status(err.statusCode)
        .send({ error: err.code ?? 'bad_request', message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  // ---- helpers ----
  const claims = async (req: FastifyRequest, roles?: Claims['role'][]): Promise<Claims> => {
    try {
      await req.jwtVerify();
    } catch {
      throw new ToolError('unauthorized', 'Sign in required', 401);
    }
    const c = req.user as Claims;
    if (roles && !roles.includes(c.role))
      throw new ToolError('forbidden', 'Not allowed for your role', 403);
    return c;
  };
  const staffCtx = (c: Claims): ToolContext => ({
    clinicId: c.clinicId,
    actor: { kind: 'staff', role: c.role, userId: c.uid, doctorId: c.doctorId } as Actor,
  });
  const clinicBySlug = async (slug: string) => {
    const r = await pool.query('SELECT id, name, default_language FROM clinics WHERE slug=$1', [
      slug,
    ]);
    if (!r.rowCount) throw new ToolError('not_found', 'Clinic not found', 404);
    return r.rows[0] as { id: string; name: string; default_language: 'en' | 'hi' };
  };
  const read = <T>(clinicId: string, fn: (db: pg.PoolClient) => Promise<T>) =>
    withClinic(pool, clinicId, fn);
  const idParam = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;
  const sendSocket = (socket: any, clinicId: string, filter: (e: LiveEvent) => boolean) => {
    const off = bus.subscribe(clinicId, (e) => {
      if (filter(e) && socket.readyState === 1) socket.send(JSON.stringify(e));
    });
    socket.on('close', off);
    socket.on('error', off);
  };

  app.get('/health', async () => ({ ok: true }));

  // ---- auth ----
  app.post('/auth/login', async (req) => {
    const i = LoginInput.parse(req.body);
    const r = await pool.query('SELECT * FROM auth_lookup_staff($1)', [i.email]);
    const u = r.rows[0];
    if (!u || !(await verifyPassword(i.password, u.password_hash)))
      throw new ToolError('invalid_credentials', 'Wrong email or password', 401);
    const c: Claims = {
      uid: u.id,
      clinicId: u.clinic_id,
      role: u.role,
      doctorId: u.doctor_id,
      name: u.name,
    };
    return { token: app.jwt.sign(c, { expiresIn: '12h' }), user: c };
  });
  app.get('/me', async (req) => claims(req));

  // ---- public: patient check-in page, TV board ----
  app.get('/public/:slug', async (req) => {
    const c = await clinicBySlug((req.params as any).slug);
    return read(c.id, async (db) => ({
      clinic: c.name,
      defaultLanguage: c.default_language,
      doctors: (
        await db.query('SELECT id, name, speciality FROM doctors WHERE active ORDER BY name')
      ).rows,
    }));
  });
  app.get('/public/:slug/profile', async (req) => {
    limitPublic(req.ip);
    const r = (
      await pool.query('SELECT public_clinic_profile($1) AS p', [(req.params as any).slug])
    ).rows[0].p;
    if (!r) throw new ToolError('not_found', 'Clinic not found', 404);
    return r;
  });
  app.post('/public/:slug/lookup', async (req) => {
    const c = await clinicBySlug((req.params as any).slug);
    const phone = z.object({ phone: PhoneSchema }).parse(req.body).phone;
    const out = await callTool(
      rt,
      { clinicId: c.id, actor: { kind: 'patient' } },
      'lookup_patient_by_phone',
      { phone },
    );
    return { returning: out.returning }; // no name or id is revealed to an anonymous caller
  });
  app.post('/public/:slug/checkin', async (req) => {
    const c = await clinicBySlug((req.params as any).slug);
    const input = CheckinInput.parse(req.body);
    const out = await callTool(
      rt,
      { clinicId: c.id, actor: { kind: 'patient' } },
      'check_in_patient',
      input,
    );
    if (out.messaged)
      startIntakeFor(env, { clinicId: c.id, patientId: out.patientId, phone: input.phone }).catch(
        (e) => app.log.warn(e, 'intake start failed'),
      );
    return {
      token: out.token,
      waitMinutes: out.waitMinutes,
      returning: out.returning,
      name: out.returning ? out.name.split(' ')[0] : undefined,
      language: out.language,
    };
  });
  app.get('/public/:slug/board', async (req) => {
    const c = await clinicBySlug((req.params as any).slug);
    return read(c.id, async (db) => {
      const docs = (await db.query('SELECT id, name FROM doctors WHERE active ORDER BY name')).rows;
      const snap = await queueSnapshot(db, c.id);
      return {
        clinic: c.name,
        doctors: docs.map((d) => {
          const mine = snap.filter((e) => e.doctor_id === d.id);
          const waiting = mine.filter((e) => e.status === 'waiting');
          return {
            id: d.id,
            name: d.name,
            nowServing:
              mine.find((e) => e.status === 'called' || e.status === 'in_consultation')
                ?.token_number ?? null,
            next: waiting.slice(0, 3).map((e) => e.token_number),
            waitingCount: waiting.length,
            estimatedWaitMinutes: waiting.length ? waiting[waiting.length - 1].wait_minutes : 0,
          }; // wait for the last in line; first in line has the least
        }),
      };
    });
  });
  app.get('/ws/public/:slug', { websocket: true }, async (socket, req) => {
    const c = await clinicBySlug((req.params as any).slug).catch(() => null);
    if (!c) return socket.close();
    // Public screens (TV, simulator) only learn that something changed, never what.
    sendSocket(
      socket,
      c.id,
      (e) => e.type === 'queue_changed' || e.type === 'conversation_updated',
    );
  });

  // ---- staff ----
  app.get('/ws', { websocket: true }, async (socket, req) => {
    let c: Claims;
    try {
      c = app.jwt.verify<Claims>(String((req.query as any).token));
    } catch {
      return socket.close(1008, 'unauthorized');
    }
    activeClinics.add(c.clinicId);
    sendSocket(socket, c.clinicId, () => true);
    socket.send(
      JSON.stringify({ type: 'llm_status', ok: gate.status().ok || !gate.status().configured }),
    );
  });
  app.get('/staff/status', async (req) => {
    await claims(req);
    return { llm: gate.status() };
  });
  app.get('/staff/doctors', async (req) => {
    const c = await claims(req);
    return read(
      c.clinicId,
      async (db) =>
        (await db.query('SELECT id, name, speciality FROM doctors WHERE active ORDER BY name'))
          .rows,
    );
  });
  app.get('/staff/queue', async (req) => {
    const c = await claims(req);
    return read(c.clinicId, async (db) => {
      const rows = await queueSnapshot(
        db,
        c.clinicId,
        c.role === 'doctor' ? (c.doctorId ?? undefined) : undefined,
      );
      const ph = new Map(
        (await db.query('SELECT id, phone, year_of_birth FROM patients')).rows.map((p) => [
          p.id,
          p,
        ]),
      );
      const intake = new Map(
        (
          await db.query(
            'SELECT queue_entry_id, summary FROM intake_summaries WHERE queue_entry_id IS NOT NULL',
          )
        ).rows.map((i) => [i.queue_entry_id, i.summary]),
      );
      return rows.map((r) => ({
        ...r,
        phone: c.role === 'receptionist' ? ph.get(r.patient_id)?.phone : undefined,
        age: ph.get(r.patient_id)?.year_of_birth
          ? new Date().getFullYear() - ph.get(r.patient_id).year_of_birth
          : null,
        intake_summary: intake.get(r.id) ?? null,
      }));
    });
  });
  app.get('/staff/today', async (req) => {
    const c = await claims(req);
    return read(
      c.clinicId,
      async (db) =>
        (
          await db.query(
            `SELECT a.id, a.starts_at, a.status, a.reason, d.name AS doctor, d.id AS doctor_id, p.name AS patient
       FROM appointments a JOIN doctors d ON d.id=a.doctor_id LEFT JOIN patients p ON p.id=a.patient_id
      WHERE (a.starts_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$1))::date = (now() AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$1))::date
        AND ($2::uuid IS NULL OR a.doctor_id=$2) ORDER BY a.starts_at`,
            [c.clinicId, c.role === 'doctor' ? c.doctorId : null],
          )
        ).rows,
    );
  });
  app.post('/staff/queue/call-next', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'call_next_patient', {
      doctorId: (req.body as any)?.doctorId,
    });
  });
  for (const [path, tool] of [
    ['skip', 'skip_patient'],
    ['hold', 'hold_patient'],
    ['resume', 'resume_patient'],
    ['finish', 'finish_visit'],
    ['start', 'start_consultation'],
    ['no-show', 'mark_no_show'],
  ] as const) {
    app.post(`/staff/queue/:id/${path}`, async (req) => {
      const c = await claims(req);
      return callTool(rt, staffCtx(c), tool, { queueEntryId: idParam(req) });
    });
  }
  // Running late: doctor says it (text, or a voice note transcribed upstream) -> impact -> ONE tap confirms -> patients notified.
  app.post('/staff/schedule/propose', async (req) => {
    const c = await claims(req, ['doctor']);
    const b = z
      .object({ text: z.string().max(300).optional(), minutes: z.number().int().optional() })
      .parse(req.body);
    const minutes = b.minutes ?? (b.text ? await parseLateRequest(gate, b.text) : null);
    if (!minutes)
      throw new ToolError(
        'not_understood',
        'Say how late you are running, e.g. "running 30 minutes late"',
      );
    return callTool(rt, staffCtx(c), 'propose_schedule_shift', { minutes, requestedText: b.text });
  });
  app.post('/staff/schedule/:id/confirm', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'confirm_schedule_shift', { proposalId: idParam(req) });
  });
  app.post('/staff/schedule/:id/cancel', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'cancel_schedule_shift', { proposalId: idParam(req) });
  });
  app.get('/staff/schedule/summary', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'get_shift_summary', {});
  });

  app.post('/staff/checkin', async (req) => {
    const c = await claims(req, ['receptionist']);
    const input = CheckinInput.parse(req.body);
    const out = await callTool(rt, staffCtx(c), 'check_in_patient', input);
    if (out.messaged)
      startIntakeFor(env, {
        clinicId: c.clinicId,
        patientId: out.patientId,
        phone: input.phone,
      }).catch(() => {});
    return out;
  });
  app.get('/staff/flags', async (req) => {
    const c = await claims(req);
    const status = (req.query as any).status === 'resolved' ? 'resolved' : 'open';
    return read(
      c.clinicId,
      async (db) =>
        (
          await db.query(
            `SELECT f.*, p.name AS patient_name FROM flags f LEFT JOIN patients p ON p.id=f.patient_id WHERE f.status=$1 ORDER BY (f.severity='urgent') DESC, f.created_at DESC LIMIT 100`,
            [status],
          )
        ).rows,
    );
  });
  app.post('/staff/flags/:id/resolve', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'resolve_flag', { flagId: idParam(req) });
  });
  app.get('/staff/conversations', async (req) => {
    const c = await claims(req, ['receptionist']);
    return read(
      c.clinicId,
      async (db) =>
        (
          await db.query(
            `SELECT c.id, c.contact, c.handled_by, c.language, c.updated_at, p.name AS patient_name,
            (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM conversations c LEFT JOIN patients p ON p.id=c.patient_id ORDER BY c.updated_at DESC LIMIT 50`,
          )
        ).rows,
    );
  });
  app.get('/staff/conversations/:id/messages', async (req) => {
    const c = await claims(req, ['receptionist']);
    return read(
      c.clinicId,
      async (db) =>
        (
          await db.query(
            'SELECT id, direction, sender, body, created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at',
            [idParam(req)],
          )
        ).rows,
    );
  });
  app.post('/staff/conversations/:id/takeover', async (req) => {
    const c = await claims(req, ['receptionist']);
    return callTool(rt, staffCtx(c), 'take_over_conversation', {
      conversationId: idParam(req),
      to: z.object({ to: z.enum(['human', 'agent']) }).parse(req.body).to,
    });
  });
  app.post('/staff/conversations/:id/reply', async (req) => {
    const c = await claims(req, ['receptionist']);
    return callTool(rt, staffCtx(c), 'send_message', {
      conversationId: idParam(req),
      text: z.object({ text: z.string().min(1).max(2000) }).parse(req.body).text,
    });
  });

  // ---- ask your clinic + daily brief ----
  app.post('/staff/ask', async (req) => {
    const c = await claims(req);
    const { question } = z.object({ question: z.string().trim().min(2).max(300) }).parse(req.body);
    return { answer: await answerStaffQuestion(env, staffCtx(c), question) };
  });
  app.get('/staff/brief', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'build_daily_brief', {});
  });
  app.put('/staff/phone', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'set_my_phone', req.body);
  });

  // ---- patient records: search, record view, visit notes (scribe), documents ----
  app.get('/staff/patients/search', async (req) => {
    const c = await claims(req);
    const q = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query).q;
    return (await callTool(rt, staffCtx(c), 'search_patients', { q })).patients;
  });
  app.get('/staff/patients/:id/record', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'get_patient_record', { patientId: idParam(req) });
  });
  app.put('/staff/patients/:id/tags', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'set_patient_tags', {
      patientId: idParam(req),
      tags: z.object({ tags: z.array(z.string()) }).parse(req.body).tags,
    });
  });
  app.post('/staff/notes/draft', async (req) => {
    const c = await claims(req, ['doctor']);
    const b = z
      .object({
        patientId: z.string().uuid(),
        transcript: z.string().trim().min(1).max(12000),
        source: z.enum(['typed', 'dictated']).default('typed'),
        queueEntryId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const aiOn =
      (
        await read(
          c.clinicId,
          async (db) =>
            (
              await db.query('SELECT ai_features FROM clinic_settings WHERE clinic_id=$1', [
                c.clinicId,
              ])
            ).rows[0],
        )
      )?.ai_features?.scribe === true;
    const s = await structureNote(gate, b.transcript, aiOn);
    const out = await callTool(rt, staffCtx(c), 'save_visit_note_draft', {
      ...b,
      note: s.note,
      flags: s.flags,
    });
    return { noteId: out.noteId, note: s.note, flags: s.flags, usedAi: s.usedAi };
  });
  app.patch('/staff/notes/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'update_visit_note', {
      noteId: idParam(req),
      note: (req.body as any)?.note,
    });
  });
  app.post('/staff/notes/:id/sign', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'sign_visit_note', { noteId: idParam(req) });
  });
  app.post('/staff/notes/:id/amend', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'amend_visit_note', {
      noteId: idParam(req),
      reason: (req.body as any)?.reason,
    });
  });
  app.delete('/staff/notes/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'delete_visit_note_draft', { noteId: idParam(req) });
  });
  app.post('/staff/patients/:id/documents', async (req) => {
    const c = await claims(req);
    const b = z
      .object({
        filename: z.string(),
        base64: z.string(),
        caption: z.string().optional(),
        kind: z.enum(['report', 'photo', 'xray', 'other']).optional(),
      })
      .parse(req.body);
    return callTool(rt, staffCtx(c), 'store_patient_document', { patientId: idParam(req), ...b });
  });
  app.get('/staff/documents/:id', async (req, reply) => {
    const c = await claims(req, ['doctor']);
    const d = await callTool(rt, staffCtx(c), 'get_patient_document', { documentId: idParam(req) });
    // Served as a download of a sniffed type, never rendered by the browser as a page.
    return reply
      .header('content-type', d.mime)
      .header('content-disposition', `inline; filename="${encodeURIComponent(d.filename)}"`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(d.data);
  });

  // ---- certificates and prescriptions (doctor drafts with the assistant, signs with password re-entry) ----
  app.get('/staff/patients/:id/issued', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'list_issued_documents', { patientId: idParam(req) });
  });
  app.post('/staff/patients/:id/certificates', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'draft_certificate', {
      ...(req.body as object),
      patientId: idParam(req),
    });
  });
  app.post('/staff/patients/:id/prescriptions', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'draft_prescription', {
      ...(req.body as object),
      patientId: idParam(req),
    });
  });
  app.patch('/staff/issued/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'update_issued_document', {
      ...(req.body as object),
      documentId: idParam(req),
    });
  });
  app.delete('/staff/issued/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'delete_issued_draft', { documentId: idParam(req) });
  });
  app.post('/staff/issued/:id/sign', async (req) => {
    const c = await claims(req, ['doctor']);
    const b = z
      .object({ password: z.string().min(1), acknowledgeWarnings: z.boolean().optional() })
      .parse(req.body);
    // Signing is a deliberate act: the doctor confirms with their password again.
    const row = await read(
      c.clinicId,
      async (db) =>
        (await db.query('SELECT password_hash FROM staff_users WHERE id=$1', [c.uid])).rows[0],
    );
    if (!row || !(await verifyPassword(b.password, row.password_hash)))
      throw new ToolError('wrong_password', 'That password is not correct', 403);
    return callTool(rt, staffCtx(c), 'sign_issued_document', {
      documentId: idParam(req),
      acknowledgeWarnings: b.acknowledgeWarnings ?? false,
    });
  });
  app.post('/staff/issued/:id/void', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'void_issued_document', {
      documentId: idParam(req),
      reason: (req.body as any)?.reason,
    });
  });
  app.post('/staff/issued/:id/send', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'send_issued_document', { documentId: idParam(req) });
  });
  app.get('/staff/issued/:id/pdf', async (req, reply) => {
    const c = await claims(req);
    const d = await callTool(rt, staffCtx(c), 'get_issued_document_pdf', {
      documentId: idParam(req),
    });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${d.number}.pdf"`)
      .header('x-content-type-options', 'nosniff')
      .send(d.pdf);
  });

  // ---- public: private download links and document verification ----
  const hits = new Map<string, { n: number; reset: number }>();
  const limitPublic = (ip: string) => {
    const now = Date.now(),
      b = hits.get(ip);
    if (!b || b.reset < now) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++b.n > 30)
      throw new ToolError('rate_limited', 'Too many requests. Please wait a minute.', 429);
  };
  app.get('/d/:token', async (req, reply) => {
    limitPublic(req.ip);
    const token = String((req.params as any).token ?? '');
    const r = await pool.query('SELECT * FROM fetch_document_link($1)', [
      createHash('sha256').update(token).digest('hex'),
    ]);
    if (!r.rowCount || !r.rows[0].pdf)
      throw new ToolError(
        'not_found',
        'This link has expired or is not valid. Ask the clinic to send it again.',
        404,
      );
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${r.rows[0].doc_number}.pdf"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(r.rows[0].pdf);
  });
  app.get('/public/verify/:code', async (req) => {
    limitPublic(req.ip);
    const code = String((req.params as any).code ?? '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(code)) return { valid: false };
    const r = (await pool.query('SELECT * FROM verify_document($1)', [code])).rows[0];
    if (!r) return { valid: false };
    return {
      valid: r.status === 'signed',
      status: r.status,
      kind: r.kind,
      subtype: r.subtype,
      number: r.doc_number,
      issuedOn: r.issued_on,
      doctor: r.doctor_name,
      registrationNo: r.registration_no,
      clinic: r.clinic_name,
      patientInitials: r.patient_initials,
    };
  });

  // ---- custom agents: describe in plain words, review, approve ----
  app.get('/staff/agents', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'list_custom_agents', {});
  });
  app.post('/staff/agents/interpret', async (req) => {
    const c = await claims(req, ['doctor']);
    const { text } = z.object({ text: z.string().trim().min(5).max(500) }).parse(req.body);
    const out = await callTool(rt, staffCtx(c), 'interpret_agent_request', { text });
    if (out.understood) return out;
    return (await llmInterpret(gate, text)) ?? out;
  });
  app.post('/staff/agents/preview', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'preview_custom_agent', { spec: (req.body as any)?.spec });
  });
  app.post('/staff/agents', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'create_custom_agent', req.body);
  });
  app.patch('/staff/agents/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'update_custom_agent', {
      ...(req.body as object),
      agentId: idParam(req),
    });
  });
  app.post('/staff/agents/:id/activate', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'activate_custom_agent', { agentId: idParam(req) });
  });
  app.post('/staff/agents/:id/pause', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'pause_custom_agent', { agentId: idParam(req) });
  });
  app.post('/staff/agents/:id/resume', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'resume_custom_agent', { agentId: idParam(req) });
  });
  app.delete('/staff/agents/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'delete_custom_agent', { agentId: idParam(req) });
  });

  // ---- guided setup: signup (invite only), checklist, doctors, team ----
  const signups = new Map<string, { n: number; reset: number }>();
  app.post('/signup', async (req) => {
    const code = process.env.SIGNUP_INVITE_CODE;
    if (!code) throw new ToolError('not_found', 'Signup is not enabled on this server', 404);
    const ip = req.ip;
    const now = Date.now(),
      b0 = signups.get(ip);
    if (!b0 || b0.reset < now) signups.set(ip, { n: 1, reset: now + 3_600_000 });
    else if (++b0.n > Number(process.env.SIGNUP_RATE_LIMIT ?? 5))
      throw new ToolError('rate_limited', 'Too many attempts. Try again later.', 429);
    const b = z
      .object({
        inviteCode: z.string(),
        clinicName: z.string().trim().min(2).max(80),
        slug: z.string().trim().toLowerCase().optional(),
        doctorName: z.string().trim().min(2).max(80),
        email: z.string().email().max(120),
        password: z.string().min(10, 'Password must be at least 10 characters').max(100),
      })
      .parse(req.body);
    const a = Buffer.from(b.inviteCode),
      c = Buffer.from(code);
    if (a.length !== c.length || !timingSafeEqual(a, c))
      throw new ToolError('invalid_invite', 'That invite code is not valid', 403);
    const slug =
      b.slug ||
      b.clinicName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    try {
      const r = await pool.query('SELECT create_clinic($1,$2,$3,$4,$5) AS id', [
        slug,
        b.clinicName,
        b.doctorName,
        b.email,
        await hashPassword(b.password),
      ]);
      const u = (await pool.query('SELECT * FROM auth_lookup_staff($1)', [b.email])).rows[0];
      const claimsOut: Claims = {
        uid: u.id,
        clinicId: r.rows[0].id,
        role: 'doctor',
        doctorId: u.doctor_id,
        name: u.name,
      };
      return { token: app.jwt.sign(claimsOut, { expiresIn: '12h' }), user: claimsOut, slug };
    } catch (e: any) {
      const m = String(e.message);
      if (m.includes('slug_taken'))
        throw new ToolError('slug_taken', 'That clinic web name is taken. Choose another.', 409);
      if (m.includes('invalid_slug'))
        throw new ToolError(
          'invalid_slug',
          'Use 3-40 letters, numbers or dashes for the clinic web name',
          400,
        );
      if (m.includes('email_in_use'))
        throw new ToolError('email_in_use', 'That email already has an account', 409);
      throw e;
    }
  });
  app.get('/staff/setup', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'get_setup_status', {});
  });
  app.post('/staff/setup/complete', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'complete_setup', {});
  });
  app.get('/staff/doctors/all', async (req) => {
    const c = await claims(req);
    return read(
      c.clinicId,
      async (db) =>
        (
          await db.query(
            'SELECT id, name, speciality, slot_minutes, active, whatsapp_number, registration_no, qualifications FROM doctors ORDER BY name',
          )
        ).rows,
    );
  });
  app.post('/staff/doctors', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'add_doctor', req.body);
  });
  app.patch('/staff/doctors/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'update_doctor', {
      ...(req.body as object),
      doctorId: idParam(req),
    });
  });
  app.get('/staff/team', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'list_staff', {});
  });
  app.post('/staff/team', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'add_staff', req.body);
  });
  app.delete('/staff/team/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'remove_staff', { id: idParam(req) });
  });

  // ---- integrations (doctor): API keys and webhooks ----
  app.get('/staff/integrations', async (req) => {
    const c = await claims(req, ['doctor']);
    const [keys, hooks] = await Promise.all([
      callTool(rt, staffCtx(c), 'list_api_keys', {}),
      callTool(rt, staffCtx(c), 'list_webhooks', {}),
    ]);
    return { ...keys, ...hooks, events: WEBHOOK_EVENTS };
  });
  app.post('/staff/integrations/keys', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'create_api_key', req.body);
  });
  app.delete('/staff/integrations/keys/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'revoke_api_key', { id: idParam(req) });
  });
  app.post('/staff/integrations/webhooks', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'create_webhook', req.body);
  });
  app.patch('/staff/integrations/webhooks/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'update_webhook', {
      ...(req.body as object),
      id: idParam(req),
    });
  });
  app.delete('/staff/integrations/webhooks/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'delete_webhook', { id: idParam(req) });
  });
  app.get('/staff/integrations/webhooks/:id/deliveries', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'list_webhook_deliveries', { webhookId: idParam(req) });
  });
  app.post('/staff/integrations/test', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'test_webhook', {});
  });

  // ---- public API v1 (API key in "Authorization: Bearer shy_..."). Everything goes through the same tools as the agents. ----
  const buckets = new Map<string, { n: number; reset: number }>();
  const apiCtx = async (req: FastifyRequest): Promise<ToolContext> => {
    const m = String(req.headers.authorization ?? '').match(
      /^Bearer (shy_([0-9a-f]{8})_[0-9a-f]{32})$/,
    );
    if (!m)
      throw new ToolError(
        'unauthorized',
        'Send your API key as "Authorization: Bearer shy_..."',
        401,
      );
    const row = (await pool.query('SELECT * FROM auth_lookup_api_key($1)', [m[2]])).rows[0];
    const given = Buffer.from(hashKey(m[1]));
    const want = Buffer.from(row?.key_hash ?? '0'.repeat(64));
    if (!row || given.length !== want.length || !timingSafeEqual(given, want))
      throw new ToolError('unauthorized', 'Invalid or revoked API key', 401);
    const now = Date.now();
    const b = buckets.get(row.id);
    if (!b || b.reset < now) buckets.set(row.id, { n: 1, reset: now + 60_000 });
    else if (++b.n > 120)
      throw new ToolError(
        'rate_limited',
        'Too many requests: limit is 120 per minute per key',
        429,
      );
    if (!b || b.n === 1)
      withClinic(pool, row.clinic_id, (db) =>
        db.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [row.id]),
      ).catch(() => {});
    return { clinicId: row.clinic_id, actor: { kind: 'api', keyId: row.id, scopes: row.scopes } };
  };
  const v1 =
    <T>(fn: (ctx: ToolContext, req: FastifyRequest) => Promise<T>) =>
    async (req: FastifyRequest) =>
      fn(await apiCtx(req), req);

  app.get(
    '/v1/doctors',
    v1(async (ctx) => (await callTool(rt, ctx, 'get_clinic_info', {})).doctors),
  );
  app.get(
    '/v1/slots',
    v1(async (ctx, req) => {
      const q = z
        .object({
          doctorId: z.string().uuid(),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          from: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          to: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          count: z.coerce.number().int().min(1).max(20).default(5),
        })
        .parse(req.query);
      return callTool(rt, ctx, 'list_free_slots', q);
    }),
  );
  app.get(
    '/v1/appointments',
    v1(async (ctx, req) =>
      callTool(
        rt,
        ctx,
        'list_appointments',
        z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            doctorId: z.string().uuid().optional(),
          })
          .parse(req.query),
      ),
    ),
  );
  app.post(
    '/v1/appointments',
    v1(async (ctx, req) => {
      const b = z
        .object({
          doctorId: z.string().uuid(),
          startsAt: z.string().datetime(),
          reason: z.string().max(200).optional(),
          patient: z.object({
            phone: PhoneSchema,
            name: z.string().trim().min(1).max(100).optional(),
            language: z.enum(['en', 'hi']).default('en'),
          }),
          consentVisitData: z.boolean().optional(),
        })
        .parse(req.body);
      const found = await callTool(rt, ctx, 'lookup_patient_by_phone', { phone: b.patient.phone });
      let patientId: string = found.patientId;
      if (!found.returning) {
        if (!b.patient.name)
          throw new ToolError('name_required', 'patient.name is required for a new patient', 400);
        if (b.consentVisitData !== true)
          throw new ToolError(
            'consent_required',
            'Set consentVisitData: true only if the patient agreed to the clinic storing their details',
            400,
          );
        patientId = (
          await callTool(rt, ctx, 'create_patient', {
            name: b.patient.name,
            phone: b.patient.phone,
            language: b.patient.language,
            consentVisitData: true,
          })
        ).patientId;
      }
      return callTool(rt, ctx, 'book_appointment', {
        doctorId: b.doctorId,
        patientId,
        startsAt: b.startsAt,
        reason: b.reason,
        source: 'api',
      }).then((r) => ({ ...r, patientId }));
    }),
  );
  app.post(
    '/v1/appointments/:id/cancel',
    v1(async (ctx, req) =>
      callTool(rt, ctx, 'cancel_appointment', { appointmentId: idParam(req) }),
    ),
  );
  app.post(
    '/v1/appointments/:id/reschedule',
    v1(async (ctx, req) =>
      callTool(rt, ctx, 'reschedule_appointment', {
        appointmentId: idParam(req),
        newStartsAt: z.object({ newStartsAt: z.string().datetime() }).parse(req.body).newStartsAt,
      }),
    ),
  );
  app.get(
    '/v1/queue',
    v1(async (ctx) => callTool(rt, ctx, 'get_queue_overview', {})),
  );
  app.post(
    '/v1/messages',
    v1(async (ctx, req) => {
      const b = z
        .object({ phone: PhoneSchema, text: z.string().trim().min(1).max(1000) })
        .parse(req.body);
      const found = await callTool(rt, ctx, 'lookup_patient_by_phone', { phone: b.phone });
      if (!found.returning)
        throw new ToolError('not_found', 'No patient with that phone number', 404);
      return callTool(rt, ctx, 'message_patient', { patientId: found.patientId, text: b.text });
    }),
  );
  app.post(
    '/v1/webhooks',
    v1(async (ctx, req) => callTool(rt, ctx, 'create_webhook', req.body)),
  );
  app.delete(
    '/v1/webhooks/:id',
    v1(async (ctx, req) => callTool(rt, ctx, 'delete_webhook', { id: idParam(req) })),
  );
  app.get('/v1/openapi.json', async () => openApiSpec());

  // ---- safety report: live checks, activity, latest eval, audit log ----
  const evalFile = () => {
    for (const f of [
      process.env.EVAL_RESULTS_PATH,
      join(process.cwd(), '../../eval-results/latest.json'),
      join(process.cwd(), 'eval-results/latest.json'),
    ]) {
      try {
        if (f && existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
      } catch {
        /* unreadable: treated as no run */
      }
    }
    return null;
  };
  app.get('/staff/safety-report', async (req) => {
    const c = await claims(req);
    return read(c.clinicId, async (db) => {
      const one = async (sql: string, params: unknown[] = []) =>
        (await db.query(sql, params)).rows[0];
      const rls = await one(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity)::int AS protected
           FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='clinic_id' AND NOT a.attisdropped
           JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r'`,
      );
      const priv = await one(
        `SELECT has_table_privilege(current_user,'agent_actions','UPDATE') AS upd, has_table_privilege(current_user,'agent_actions','DELETE') AS del`,
      );
      const clinicPhrases = (await one('SELECT count(*)::int AS n FROM red_flag_phrases')).n;
      const act = await one(
        `SELECT
           (SELECT count(*)::int FROM messages WHERE direction='in' AND created_at > now() - interval '30 days') AS messages_in,
           (SELECT count(*)::int FROM flags WHERE kind='red_flag' AND created_at > now() - interval '30 days') AS red_flags,
           (SELECT count(*)::int FROM flags WHERE kind='red_flag' AND status='open' AND created_at < now() - interval '15 minutes') AS red_flags_unhandled,
           (SELECT COALESCE(round(avg(extract(epoch FROM (resolved_at - created_at))/60)::numeric,1),0)::float FROM flags WHERE kind='red_flag' AND resolved_at IS NOT NULL AND created_at > now() - interval '30 days') AS red_flag_minutes_to_resolve,
           (SELECT count(*)::int FROM flags WHERE kind='medical_question' AND created_at > now() - interval '30 days') AS medical_questions,
           (SELECT count(*)::int FROM flags WHERE kind IN ('human_requested','upset') AND created_at > now() - interval '30 days') AS handoffs,
           (SELECT count(*)::int FROM agent_actions WHERE ok=false AND output->>'error'='permission_denied' AND created_at > now() - interval '30 days') AS permission_denied,
           (SELECT count(*)::int FROM agent_actions WHERE kind='error' AND created_at > now() - interval '30 days') AS agent_errors,
           (SELECT count(*)::int FROM agent_actions WHERE created_at > now() - interval '30 days') AS audit_entries,
           (SELECT count(*)::int FROM data_requests WHERE created_at > now() - interval '30 days') AS privacy_requests,
           (SELECT count(*)::int FROM outbox WHERE status='failed') AS undelivered_messages`,
      );
      const ev = evalFile();
      return {
        generatedAt: new Date().toISOString(),
        controls: [
          {
            id: 'rls',
            ok: rls.total > 0 && rls.protected === rls.total,
            label: 'Each clinic can only see its own data (database-enforced)',
            detail: `${rls.protected} of ${rls.total} data tables protected`,
          },
          {
            id: 'audit',
            ok: !priv.upd && !priv.del,
            label: 'Audit log cannot be edited or deleted by the application',
            detail:
              'Only a vetted privacy function can strip personal content, never remove entries',
          },
          {
            id: 'redflags',
            ok: true,
            label: 'Emergency phrases checked on every patient message',
            detail: `${BUILTIN_RED_FLAGS.reduce((n, g) => n + g.phrases.length, 0)} built-in phrases (cannot be removed) + ${clinicPhrases} added by this clinic, plus the AI check when enabled`,
          },
          {
            id: 'consent',
            ok: true,
            label: "No proactive message without the patient's consent",
            detail: 'Enforced in the message tool; STOP withdraws consent at once',
          },
          {
            id: 'medical',
            ok: true,
            label: 'Agents never give medical advice',
            detail: 'Fixed reply for medical questions; every AI draft passes an output filter',
          },
          {
            id: 'llm',
            ok: !gate.configured || gate.status().ok,
            label: 'If the AI service is down, check-in and queue keep working',
            detail: gate.configured
              ? gate.status().ok
                ? 'AI service healthy'
                : 'AI service currently unavailable: running on built-in rules'
              : 'AI service not configured: running on built-in rules',
          },
        ],
        activity: act,
        eval: ev,
      };
    });
  });
  const auditQuery = (q: any, limit: number) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('$#', `$${params.length}`));
    };
    if (q.kind) add('a.kind = $#', String(q.kind));
    if (q.agent) add('a.agent LIKE $#', `${String(q.agent)}%`);
    if (q.ok === 'false') where.push('a.ok = false');
    if (q.before) add('a.id < $#', Number(q.before));
    if (q.days)
      add('a.created_at > now() - make_interval(days => $#)', Math.min(Number(q.days) || 30, 365));
    params.push(limit);
    return {
      sql: `SELECT a.id, a.created_at, a.agent, a.kind, a.tool, a.ok, a.input, a.output, p.name AS patient
              FROM agent_actions a LEFT JOIN patients p ON p.id = a.patient_id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT $${params.length}`,
      params,
    };
  };
  app.get('/staff/audit', async (req) => {
    const c = await claims(req);
    const { sql, params } = auditQuery(req.query, 50);
    return read(c.clinicId, async (db) =>
      (await db.query(sql, params)).rows.map((r) => ({
        id: Number(r.id),
        at: r.created_at,
        agent: r.agent,
        kind: r.kind,
        tool: r.tool,
        ok: r.ok,
        patient: r.patient,
        redacted: r.input?.redacted === true,
        detail: r.input?.redacted
          ? 'Personal content removed'
          : JSON.stringify(r.input ?? r.output ?? '').slice(0, 220),
      })),
    );
  });
  app.get('/staff/audit.csv', async (req, reply) => {
    const c = await claims(req);
    const { sql, params } = auditQuery(
      { ...(req.query as object), days: (req.query as any).days ?? 30 },
      5000,
    );
    const rows = await read(c.clinicId, async (db) => (await db.query(sql, params)).rows);
    const esc = (v: unknown) => {
      const t = String(v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [
      'id,time,agent,kind,tool,ok,patient,detail',
      ...rows.map((r) =>
        [
          r.id,
          new Date(r.created_at).toISOString(),
          r.agent,
          r.kind,
          r.tool,
          r.ok,
          r.patient,
          r.input?.redacted ? 'redacted' : JSON.stringify(r.input ?? '').slice(0, 300),
        ]
          .map(esc)
          .join(','),
      ),
    ].join('\n');
    return reply
      .header('content-type', 'text/csv')
      .header('content-disposition', 'attachment; filename="audit-log.csv"')
      .send(csv);
  });

  // ---- privacy requests handled at the desk (patient asks in person) ----
  app.get('/staff/patients', async (req) => {
    const c = await claims(req);
    const phone = PhoneSchema.safeParse((req.query as any).phone);
    if (!phone.success) throw new ToolError('invalid_input', 'Enter a valid phone number', 400);
    return read(
      c.clinicId,
      async (db) =>
        (
          await db.query('SELECT id, name, phone, language FROM patients WHERE phone=$1', [
            phone.data,
          ])
        ).rows,
    );
  });
  app.get('/staff/patients/:id/export', async (req, reply) => {
    const c = await claims(req);
    const out = await callTool(rt, staffCtx(c), 'export_patient_data', { patientId: idParam(req) });
    return reply
      .header('content-disposition', 'attachment; filename="patient-data.json"')
      .send(out);
  });
  app.post('/staff/patients/:id/erase', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'erase_patient_data', { patientId: idParam(req) });
  });

  // ---- agent builder: doctor-configurable behaviour ----
  app.get('/staff/settings', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'get_clinic_settings', {});
  });
  app.put('/staff/settings', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'update_clinic_settings', req.body);
  });
  app.put('/staff/settings/whatsapp', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'set_doctor_whatsapp_number', req.body);
  });
  app.post('/staff/settings/phrases', async (req) => {
    const c = await claims(req);
    return callTool(rt, staffCtx(c), 'add_red_flag_phrase', req.body);
  });
  app.delete('/staff/settings/phrases/:id', async (req) => {
    const c = await claims(req, ['doctor']);
    return callTool(rt, staffCtx(c), 'remove_red_flag_phrase', { id: idParam(req) });
  });

  // ---- real WhatsApp: webhook in (signature-checked), outbox out ----
  if (deps.whatsapp) {
    const { inbound } = deps.whatsapp;
    app.get('/webhooks/whatsapp', async (req, reply) => {
      const out = inbound.handshake?.(req.query as Record<string, string>) ?? null;
      return out === null
        ? reply.status(403).send('forbidden')
        : reply.type('text/plain').send(out);
    });
    app.post('/webhooks/whatsapp', async (req, reply) => {
      const raw = (req as any).rawBody as string | undefined;
      if (!raw || !inbound.verify(req.headers as Record<string, string | undefined>, raw))
        return reply.status(401).send({ error: 'bad_signature' });
      const results = [];
      for (const m of inbound.parse(req.body)) {
        const clinic = await pool.query('SELECT * FROM clinic_for_whatsapp_number($1)', [
          m.businessNumber,
        ]);
        const clinicId = clinic.rows[0]?.clinic_id;
        const doctorId = clinic.rows[0]?.doctor_id ?? undefined;
        if (!clinicId) {
          app.log.warn('webhook for unknown business number');
          continue;
        } // never log message content
        const from = PhoneSchema.safeParse(m.from);
        if (!from.success) continue;
        results.push(
          await (
            m.media
              ? handleInboundMedia(env, {
                  clinicId,
                  from: from.data,
                  filename: m.media.filename,
                  base64: m.media.base64,
                  caption: m.text || undefined,
                })
              : handleInbound(env, { clinicId, from: from.data, text: m.text, doctorId })
          ).then(
            () => 'ok',
            (e) => {
              app.log.error(e, 'inbound failed');
              return 'error';
            },
          ),
        );
      }
      return { processed: results.length };
    });
  }

  // ---- voice: speech in, agent, speech out (telephony vendor drives these endpoints) ----
  // Doctor voice note for "running late": audio -> transcript -> the same proposal flow (still needs one-tap confirmation).
  app.post('/staff/schedule/propose-voice', async (req) => {
    const c = await claims(req, ['doctor']);
    if (!Buffer.isBuffer(req.body))
      throw new ToolError('bad_request', 'Send the voice note as audio/* in the request body', 415);
    const { text } = await stt.transcribe(req.body, {
      mimeType: String(req.headers['content-type']),
    });
    const minutes = await parseLateRequest(gate, text);
    if (!minutes)
      throw new ToolError(
        'not_understood',
        `I heard: "${text.slice(0, 120)}". Say how late you are running, e.g. "30 minutes late".`,
      );
    return {
      transcript: text,
      ...(await callTool(rt, staffCtx(c), 'propose_schedule_shift', {
        minutes,
        requestedText: text,
      })),
    };
  });
  // One conversational turn of a phone call. Audio (base64) or text; the reply comes back as text and speech.
  app.post('/voice/:slug/turn', async (req) => {
    if (deps.simulator === false && !deps.whatsapp)
      throw new ToolError('forbidden', 'Voice is not enabled', 403);
    const clinic = await clinicBySlug((req.params as any).slug);
    const b = z
      .object({
        from: PhoneSchema,
        text: z.string().max(2000).optional(),
        audio: z.string().optional(),
        mimeType: z.string().default('audio/wav'),
      })
      .parse(req.body);
    let text = b.text,
      language: 'en' | 'hi' | undefined;
    if (!text && b.audio) {
      const r = await stt.transcribe(Buffer.from(b.audio, 'base64'), { mimeType: b.mimeType });
      text = r.text;
      language = r.language;
    }
    if (!text?.trim()) throw new ToolError('no_speech', 'Nothing was heard', 400);
    const r = await handleInbound(env, {
      clinicId: clinic.id,
      from: b.from,
      text,
      channel: 'voice',
      language,
    });
    const spoken = r.handledBy === 'human' && !r.replies.length ? [] : r.replies;
    const lang = language ?? (/[\u0900-\u097F]/.test(text) ? 'hi' : 'en');
    const audio = spoken.length ? await tts.synthesize(spoken.join(' '), lang) : null;
    return {
      transcript: text,
      replies: spoken,
      handledBy: r.handledBy,
      redFlag: r.redFlag,
      transferToHuman: r.handledBy === 'human',
      audio: audio ? { base64: audio.audio.toString('base64'), mimeType: audio.mimeType } : null,
    };
  });

  // ---- WhatsApp simulator (mock channel; real vendors plug in behind MessagingChannel) ----
  if (deps.simulator !== false) {
    app.post('/sim/:slug/message', async (req) => {
      const c = await clinicBySlug((req.params as any).slug);
      const i = InboundMessageInput.parse(req.body);
      return handleInbound(env, {
        clinicId: c.id,
        from: i.from,
        text: i.text,
        doctorId: i.doctorId,
      });
    });
    app.post('/sim/:slug/media', async (req) => {
      const c = await clinicBySlug((req.params as any).slug);
      const b = z
        .object({
          from: PhoneSchema,
          filename: z.string().max(120),
          base64: z.string(),
          caption: z.string().max(200).optional(),
        })
        .parse(req.body);
      return handleInboundMedia(env, {
        clinicId: c.id,
        from: b.from,
        filename: b.filename,
        base64: b.base64,
        caption: b.caption,
      });
    });
    app.get('/sim/:slug/messages', async (req) => {
      const c = await clinicBySlug((req.params as any).slug);
      const phone = PhoneSchema.parse((req.query as any).phone);
      return read(
        c.id,
        async (db) =>
          (
            await db.query(
              `SELECT m.direction, m.sender, m.body, m.created_at FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE cv.contact=$1 ORDER BY m.created_at`,
              [phone],
            )
          ).rows,
      );
    });
  }
  return app;
}
