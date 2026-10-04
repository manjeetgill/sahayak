import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z, ZodError } from 'zod';
import { handleInbound, parseLateRequest, startIntakeFor, type AgentEnv, type LlmGate } from '@sahayak/agents';
import { callTool, queueSnapshot, registerAllTools, ToolError, type Actor, type EventBus, type ToolContext } from '@sahayak/core';
import { verifyPassword, withClinic } from '@sahayak/db';
import { CheckinInput, InboundMessageInput, LoginInput, PhoneSchema, type LiveEvent } from '@sahayak/shared';

export interface AppDeps { pool: pg.Pool; bus: EventBus; gate: LlmGate; jwtSecret: string; simulator?: boolean }
/** Clinics with a staff screen connected: LLM health changes are pushed to these. */
export const activeClinics = new Set<string>();
type Claims = { uid: string; clinicId: string; role: 'doctor' | 'receptionist'; doctorId: string | null; name: string };

export async function buildApp(deps: AppDeps) {
  registerAllTools();
  const { pool, bus, gate } = deps;
  const rt = { pool, bus };
  const env: AgentEnv = { rt, gate };
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' ? { level: 'info', redact: ['req.headers.authorization'] } : false });
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: deps.jwtSecret });
  await app.register(websocket);

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ToolError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid_input', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  // ---- helpers ----
  const claims = async (req: FastifyRequest, roles?: Claims['role'][]): Promise<Claims> => {
    try { await req.jwtVerify(); } catch { throw new ToolError('unauthorized', 'Sign in required', 401); }
    const c = req.user as Claims;
    if (roles && !roles.includes(c.role)) throw new ToolError('forbidden', 'Not allowed for your role', 403);
    return c;
  };
  const staffCtx = (c: Claims): ToolContext => ({ clinicId: c.clinicId, actor: { kind: 'staff', role: c.role, userId: c.uid, doctorId: c.doctorId } as Actor });
  const clinicBySlug = async (slug: string) => {
    const r = await pool.query('SELECT id, name, default_language FROM clinics WHERE slug=$1', [slug]);
    if (!r.rowCount) throw new ToolError('not_found', 'Clinic not found', 404);
    return r.rows[0] as { id: string; name: string; default_language: 'en' | 'hi' };
  };
  const read = <T>(clinicId: string, fn: (db: pg.PoolClient) => Promise<T>) => withClinic(pool, clinicId, fn);
  const idParam = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;
  const sendSocket = (socket: any, clinicId: string, filter: (e: LiveEvent) => boolean) => {
    const off = bus.subscribe(clinicId, (e) => { if (filter(e) && socket.readyState === 1) socket.send(JSON.stringify(e)); });
    socket.on('close', off);
    socket.on('error', off);
  };

  app.get('/health', async () => ({ ok: true }));

  // ---- auth ----
  app.post('/auth/login', async (req) => {
    const i = LoginInput.parse(req.body);
    const r = await pool.query('SELECT * FROM auth_lookup_staff($1)', [i.email]);
    const u = r.rows[0];
    if (!u || !(await verifyPassword(i.password, u.password_hash))) throw new ToolError('invalid_credentials', 'Wrong email or password', 401);
    const c: Claims = { uid: u.id, clinicId: u.clinic_id, role: u.role, doctorId: u.doctor_id, name: u.name };
    return { token: app.jwt.sign(c, { expiresIn: '12h' }), user: c };
  });
  app.get('/me', async (req) => claims(req));

  // ---- public: patient check-in page, TV board ----
  app.get('/public/:slug', async (req) => {
    const c = await clinicBySlug((req.params as any).slug);
    return read(c.id, async (db) => ({
      clinic: c.name, defaultLanguage: c.default_language,
      doctors: (await db.query('SELECT id, name, speciality FROM doctors WHERE active ORDER BY name')).rows,
    }));
  });
  app.post('/public/:slug/lookup', async (req) => {
    const c = await clinicBySlug((req.params as any).slug);
    const phone = z.object({ phone: PhoneSchema }).parse(req.body).phone;
    const out = await callTool(rt, { clinicId: c.id, actor: { kind: 'patient' } }, 'lookup_patient_by_phone', { phone });
    return { returning: out.returning }; // no name or id is revealed to an anonymous caller
  });
  app.post('/public/:slug/checkin', async (req) => {
    const c = await clinicBySlug((req.params as any).slug);
    const input = CheckinInput.parse(req.body);
    const out = await callTool(rt, { clinicId: c.id, actor: { kind: 'patient' } }, 'check_in_patient', input);
    if (out.messaged) startIntakeFor(env, { clinicId: c.id, patientId: out.patientId, phone: input.phone }).catch((e) => app.log.warn(e, 'intake start failed'));
    return { token: out.token, waitMinutes: out.waitMinutes, returning: out.returning, name: out.returning ? out.name.split(' ')[0] : undefined, language: out.language };
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
          return { id: d.id, name: d.name,
            nowServing: mine.find((e) => e.status === 'called' || e.status === 'in_consultation')?.token_number ?? null,
            next: waiting.slice(0, 3).map((e) => e.token_number), waitingCount: waiting.length,
            estimatedWaitMinutes: waiting.length ? waiting[waiting.length - 1].wait_minutes : 0 }; // wait for the last in line; first in line has the least
        }),
      };
    });
  });
  app.get('/ws/public/:slug', { websocket: true }, async (socket, req) => {
    const c = await clinicBySlug((req.params as any).slug).catch(() => null);
    if (!c) return socket.close();
    // Public screens (TV, simulator) only learn that something changed, never what.
    sendSocket(socket, c.id, (e) => e.type === 'queue_changed' || e.type === 'conversation_updated');
  });

  // ---- staff ----
  app.get('/ws', { websocket: true }, async (socket, req) => {
    let c: Claims;
    try { c = app.jwt.verify<Claims>(String((req.query as any).token)); } catch { return socket.close(1008, 'unauthorized'); }
    activeClinics.add(c.clinicId);
    sendSocket(socket, c.clinicId, () => true);
    socket.send(JSON.stringify({ type: 'llm_status', ok: gate.status().ok || !gate.status().configured }));
  });
  app.get('/staff/status', async (req) => { await claims(req); return { llm: gate.status() }; });
  app.get('/staff/doctors', async (req) => { const c = await claims(req); return read(c.clinicId, async (db) => (await db.query('SELECT id, name, speciality FROM doctors WHERE active ORDER BY name')).rows); });
  app.get('/staff/queue', async (req) => { const c = await claims(req); return read(c.clinicId, async (db) => {
    const rows = await queueSnapshot(db, c.clinicId, c.role === 'doctor' ? c.doctorId ?? undefined : undefined);
    const ph = new Map((await db.query('SELECT id, phone, year_of_birth FROM patients')).rows.map((p) => [p.id, p]));
    const intake = new Map((await db.query('SELECT queue_entry_id, summary FROM intake_summaries WHERE queue_entry_id IS NOT NULL')).rows.map((i) => [i.queue_entry_id, i.summary]));
    return rows.map((r) => ({ ...r, phone: c.role === 'receptionist' ? ph.get(r.patient_id)?.phone : undefined,
      age: ph.get(r.patient_id)?.year_of_birth ? new Date().getFullYear() - ph.get(r.patient_id).year_of_birth : null, intake_summary: intake.get(r.id) ?? null }));
  }); });
  app.get('/staff/today', async (req) => { const c = await claims(req); return read(c.clinicId, async (db) => (await db.query(
    `SELECT a.id, a.starts_at, a.status, a.reason, d.name AS doctor, d.id AS doctor_id, p.name AS patient
       FROM appointments a JOIN doctors d ON d.id=a.doctor_id LEFT JOIN patients p ON p.id=a.patient_id
      WHERE (a.starts_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$1))::date = (now() AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$1))::date
        AND ($2::uuid IS NULL OR a.doctor_id=$2) ORDER BY a.starts_at`, [c.clinicId, c.role === 'doctor' ? c.doctorId : null])).rows); });
  app.post('/staff/queue/call-next', async (req) => { const c = await claims(req); return callTool(rt, staffCtx(c), 'call_next_patient', { doctorId: (req.body as any)?.doctorId }); });
  for (const [path, tool] of [['skip', 'skip_patient'], ['hold', 'hold_patient'], ['resume', 'resume_patient'], ['finish', 'finish_visit'], ['start', 'start_consultation'], ['no-show', 'mark_no_show']] as const) {
    app.post(`/staff/queue/:id/${path}`, async (req) => { const c = await claims(req); return callTool(rt, staffCtx(c), tool, { queueEntryId: idParam(req) }); });
  }
  // Running late: doctor says it (text, or a voice note transcribed upstream) -> impact -> ONE tap confirms -> patients notified.
  app.post('/staff/schedule/propose', async (req) => { const c = await claims(req, ['doctor']);
    const b = z.object({ text: z.string().max(300).optional(), minutes: z.number().int().optional() }).parse(req.body);
    const minutes = b.minutes ?? (b.text ? await parseLateRequest(gate, b.text) : null);
    if (!minutes) throw new ToolError('not_understood', 'Say how late you are running, e.g. "running 30 minutes late"');
    return callTool(rt, staffCtx(c), 'propose_schedule_shift', { minutes, requestedText: b.text }); });
  app.post('/staff/schedule/:id/confirm', async (req) => { const c = await claims(req, ['doctor']); return callTool(rt, staffCtx(c), 'confirm_schedule_shift', { proposalId: idParam(req) }); });
  app.post('/staff/schedule/:id/cancel', async (req) => { const c = await claims(req, ['doctor']); return callTool(rt, staffCtx(c), 'cancel_schedule_shift', { proposalId: idParam(req) }); });
  app.get('/staff/schedule/summary', async (req) => { const c = await claims(req); return callTool(rt, staffCtx(c), 'get_shift_summary', {}); });

  app.post('/staff/checkin', async (req) => { const c = await claims(req, ['receptionist']);
    const input = CheckinInput.parse(req.body);
    const out = await callTool(rt, staffCtx(c), 'check_in_patient', input);
    if (out.messaged) startIntakeFor(env, { clinicId: c.clinicId, patientId: out.patientId, phone: input.phone }).catch(() => {});
    return out; });
  app.get('/staff/flags', async (req) => { const c = await claims(req); const status = (req.query as any).status === 'resolved' ? 'resolved' : 'open';
    return read(c.clinicId, async (db) => (await db.query(
      `SELECT f.*, p.name AS patient_name FROM flags f LEFT JOIN patients p ON p.id=f.patient_id WHERE f.status=$1 ORDER BY (f.severity='urgent') DESC, f.created_at DESC LIMIT 100`, [status])).rows); });
  app.post('/staff/flags/:id/resolve', async (req) => { const c = await claims(req); return callTool(rt, staffCtx(c), 'resolve_flag', { flagId: idParam(req) }); });
  app.get('/staff/conversations', async (req) => { const c = await claims(req, ['receptionist']); return read(c.clinicId, async (db) => (await db.query(
    `SELECT c.id, c.contact, c.handled_by, c.language, c.updated_at, p.name AS patient_name,
            (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM conversations c LEFT JOIN patients p ON p.id=c.patient_id ORDER BY c.updated_at DESC LIMIT 50`)).rows); });
  app.get('/staff/conversations/:id/messages', async (req) => { const c = await claims(req, ['receptionist']); return read(c.clinicId, async (db) => (await db.query(
    'SELECT id, direction, sender, body, created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at', [idParam(req)])).rows); });
  app.post('/staff/conversations/:id/takeover', async (req) => { const c = await claims(req, ['receptionist']);
    return callTool(rt, staffCtx(c), 'take_over_conversation', { conversationId: idParam(req), to: z.object({ to: z.enum(['human', 'agent']) }).parse(req.body).to }); });
  app.post('/staff/conversations/:id/reply', async (req) => { const c = await claims(req, ['receptionist']);
    return callTool(rt, staffCtx(c), 'send_message', { conversationId: idParam(req), text: z.object({ text: z.string().min(1).max(2000) }).parse(req.body).text }); });

  // ---- WhatsApp simulator (mock channel; real vendors plug in behind MessagingChannel) ----
  if (deps.simulator !== false) {
    app.post('/sim/:slug/message', async (req) => {
      const c = await clinicBySlug((req.params as any).slug);
      const i = InboundMessageInput.parse(req.body);
      return handleInbound(env, { clinicId: c.id, from: i.from, text: i.text });
    });
    app.get('/sim/:slug/messages', async (req) => {
      const c = await clinicBySlug((req.params as any).slug);
      const phone = PhoneSchema.parse((req.query as any).phone);
      return read(c.id, async (db) => (await db.query(
        `SELECT m.direction, m.sender, m.body, m.created_at FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE cv.contact=$1 ORDER BY m.created_at`, [phone])).rows);
    });
  }
  return app;
}
