import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { EventBus, callTool, registerAllTools, type ToolContext } from '@sahayak/core';
import { LlmGate, handleInbound } from '../src';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
const env = { rt, gate: new LlmGate(null) };
let A: Awaited<ReturnType<typeof createTestClinic>>,
  B: Awaited<ReturnType<typeof createTestClinic>>;
let manager: ToolContext, managerB: ToolContext, doc: ToolContext, rec: ToolContext;
const ids: Record<string, string> = {};

const weekly = (
  tag: string,
  text = 'Hello {name}, please book your check-up at {clinic}.',
  hi?: string,
) => ({
  trigger: { type: 'schedule', every: 'week', weekday: 1, at: '10:00' },
  audience: { tags: [tag] },
  action: { type: 'message_patients', text: { en: text, hi } },
});
const create = async (spec: object, name = 'Test agent', ctx = manager) =>
  (await callTool(rt, ctx, 'create_custom_agent', { name, spec })).agentId as string;
const dueNow = (agentId: string) =>
  admin.query("UPDATE custom_agents SET next_run_at = now() - interval '1 minute' WHERE id=$1", [
    agentId,
  ]);
const run = (clinic = A) =>
  callTool(rt, { clinicId: clinic.clinicId, actor: { kind: 'system' } }, 'run_custom_agents', {});
const bodies = async (phone: string) =>
  (
    await admin.query(
      "SELECT body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.contact=$1 AND m.sender='agent:custom' ORDER BY m.created_at",
      [phone],
    )
  ).rows.map((r) => r.body as string);
const staffOf = async (clinic: typeof A, role: string, doctorId: string | null, phone?: string) => {
  const u = (
    await admin.query(
      "INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id,phone) VALUES ($1,$2,'x',$3,$4,$5,$6) RETURNING id",
      [
        clinic.clinicId,
        `${role}-${Math.random().toString(36).slice(2)}@t.in`,
        role,
        role,
        doctorId,
        phone ?? null,
      ],
    )
  ).rows[0].id;
  return {
    clinicId: clinic.clinicId,
    actor:
      role === 'admin'
        ? { kind: 'staff' as const, role: 'admin' as const, userId: u }
        : role === 'doctor'
          ? { kind: 'staff' as const, role: 'doctor' as const, userId: u, doctorId }
          : { kind: 'staff' as const, role: 'receptionist' as const, userId: u },
  } as ToolContext;
};
const tag = (id: string, tags: string[]) =>
  admin.query('UPDATE patients SET tags=$2 WHERE id=$1', [id, tags]);

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  A = await createTestClinic(admin, 'cag');
  B = await createTestClinic(admin, 'cagb');
  manager = await staffOf(A, 'admin', null);
  managerB = await staffOf(B, 'admin', null);
  doc = await staffOf(A, 'doctor', A.doctorIds[0], '+919810000001');
  rec = await staffOf(A, 'receptionist', null, '+919810000002');

  ids.ok = await addPatient(admin, A.clinicId, 'Asha Diab', '+919811000001');
  ids.hindi = await addPatient(admin, A.clinicId, 'Hindi Pt', '+919811000002', { lang: 'hi' });
  ids.noConsent = await addPatient(admin, A.clinicId, 'No Consent', '+919811000003', {
    whatsapp: false,
  });
  ids.other = await addPatient(admin, A.clinicId, 'Untagged', '+919811000004');
  ids.otherClinic = await addPatient(admin, B.clinicId, 'Other Clinic Diab', '+919811000005');
  await tag(ids.ok, ['diabetes']);
  await tag(ids.hindi, ['diabetes']);
  await tag(ids.noConsent, ['diabetes']);
  await tag(ids.otherClinic, ['diabetes']);
});
afterAll(async () => {
  await dropTestClinic(admin, A.clinicId);
  await dropTestClinic(admin, B.clinicId);
  await admin.end();
  await pool.end();
});

describe('lifecycle and approval', () => {
  it('a new agent is a draft and does nothing; only an admin can activate', async () => {
    const id = await create(weekly('diabetes'), 'Diabetes reminder');
    expect(
      (await admin.query('SELECT status, next_run_at FROM custom_agents WHERE id=$1', [id]))
        .rows[0],
    ).toEqual({ status: 'draft', next_run_at: null });
    await expect(callTool(rt, rec, 'activate_custom_agent', { agentId: id })).rejects.toThrow(
      /may not call/,
    );
    await expect(
      callTool(rt, rec, 'create_custom_agent', { name: 'x y z', spec: weekly('a') }),
    ).rejects.toThrow(/may not call/);
    const act = await callTool(rt, manager, 'activate_custom_agent', { agentId: id });
    expect(new Date(act.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(act.nextRunAt).getUTCDay()).toBeDefined();
  });
  it('invalid specs cannot even be saved', async () => {
    await expect(
      callTool(rt, manager, 'create_custom_agent', {
        name: 'Bad one',
        spec: weekly('x', 'Take paracetamol 500 mg'),
      }),
    ).rejects.toThrow(/medical advice/);
    await expect(
      callTool(rt, manager, 'create_custom_agent', {
        name: 'Bad two',
        spec: { ...weekly('x'), audience: {} },
      }),
    ).rejects.toThrow(/cannot go to every patient/);
  });
  it('editing sets it back to draft and cancels pending runs; the receptionist can pause but not resume', async () => {
    const id = await create(weekly('diabetes'), 'Edit me');
    await callTool(rt, manager, 'activate_custom_agent', { agentId: id });
    await callTool(rt, rec, 'pause_custom_agent', { agentId: id });
    await expect(callTool(rt, rec, 'resume_custom_agent', { agentId: id })).rejects.toThrow(
      /may not call/,
    );
    await callTool(rt, manager, 'resume_custom_agent', { agentId: id });
    const u = await callTool(rt, manager, 'update_custom_agent', {
      agentId: id,
      spec: weekly('bp'),
    });
    expect(u.status).toBe('draft');
    expect(
      (await admin.query('SELECT status FROM custom_agents WHERE id=$1', [id])).rows[0].status,
    ).toBe('draft');
  });
  it('at most five agents can be active', async () => {
    await admin.query('DELETE FROM custom_agents WHERE clinic_id=$1', [A.clinicId]);
    const made: string[] = [];
    for (let i = 0; i < 6; i++) made.push(await create(weekly(`tag${i}`), `Agent number ${i}`));
    for (let i = 0; i < 5; i++)
      await callTool(rt, manager, 'activate_custom_agent', { agentId: made[i] });
    await expect(
      callTool(rt, manager, 'activate_custom_agent', { agentId: made[5] }),
    ).rejects.toThrow(/At most 5/);
    await admin.query('DELETE FROM custom_agents WHERE clinic_id=$1', [A.clinicId]);
  });
});

describe('preview shows what would happen, and sends nothing', () => {
  it('counts only patients who may be messaged', async () => {
    const p = await callTool(rt, manager, 'preview_custom_agent', { spec: weekly('diabetes') });
    expect(p.valid).toBe(true);
    expect(p.audience.count).toBe(2); // Asha and the Hindi patient: no-consent and other-clinic patients are excluded
    expect(p.audience.sample.sort()).toEqual(['Asha', 'Hindi']);
    expect(p.example).toMatch(/^Clinic cag-.*: Hello Asha, please book your check-up/);
    expect(
      (await admin.query("SELECT count(*)::int n FROM messages WHERE sender='agent:custom'"))
        .rows[0].n,
    ).toBe(0);
  });
  it('explains a problem instead of previewing an invalid agent', async () => {
    const p = await callTool(rt, manager, 'preview_custom_agent', {
      spec: weekly('x', 'visit https://evil.test'),
    });
    expect(p.valid).toBe(false);
    expect(JSON.stringify(p.problems)).toMatch(/links/);
  });
});

describe('running under the fixed rules', () => {
  let agentId = '';
  it('messages only patients with BOTH consents, in their language, from the clinic, with a way to stop', async () => {
    agentId = await create(
      weekly(
        'diabetes',
        'Hello {name}, please book your check-up at {clinic}.',
        'नमस्ते {name}, कृपया {clinic} में अपना चेक-अप बुक करें।',
      ),
      'Weekly diabetes reminder',
    );
    await callTool(rt, manager, 'activate_custom_agent', { agentId });
    await dueNow(agentId);
    const out = await run();
    expect(out.started).toBe(1);
    const en = await bodies('+919811000001'),
      hi = await bodies('+919811000002');
    expect(en).toHaveLength(1);
    expect(en[0]).toMatch(/Hello Asha, please book your check-up at Clinic cag-/);
    expect(en[0]).toMatch(/Reply STOP to stop these messages\.$/);
    expect(hi[0]).toMatch(/नमस्ते Hindi, कृपया/);
    expect(hi[0]).toMatch(/STOP लिखें।$/);
    expect(await bodies('+919811000003')).toEqual([]); // tagged, but never agreed to messages
    expect(await bodies('+919811000004')).toEqual([]); // not tagged
    expect(await bodies('+919811000005')).toEqual([]); // other clinic
  });
  it('never more than one custom-agent message per patient per week, even across agents', async () => {
    const second = await create(
      weekly('diabetes', 'Another note from {clinic}, {name}.'),
      'Second agent',
    );
    await callTool(rt, manager, 'activate_custom_agent', { agentId: second });
    await dueNow(second);
    await dueNow(agentId);
    await run();
    expect(await bodies('+919811000001')).toHaveLength(1);
  });
  it('records the run, advances the schedule, and writes an audit entry per message', async () => {
    const a = (
      await admin.query(
        'SELECT run_count, last_run_at IS NOT NULL AS ran, next_run_at > now() AS future FROM custom_agents WHERE id=$1',
        [agentId],
      )
    ).rows[0];
    expect(a.future).toBe(true);
    const r = (
      await admin.query(
        'SELECT status, result FROM agent_runs WHERE agent_id=$1 ORDER BY created_at LIMIT 1',
        [agentId],
      )
    ).rows[0];
    expect(r).toMatchObject({ status: 'done', result: { sent: 2 } });
    const audit = (
      await admin.query(
        "SELECT count(*)::int n FROM agent_actions WHERE kind='message' AND agent LIKE 'custom:%'",
      )
    ).rows[0].n;
    expect(audit).toBeGreaterThanOrEqual(2);
  });
  it('STOP from a patient ends it: no later message', async () => {
    await admin.query('DELETE FROM custom_agent_sends');
    await handleInbound(env, { clinicId: A.clinicId, from: '+919811000001', text: 'STOP' });
    await dueNow(agentId);
    await run();
    expect(await bodies('+919811000001')).toHaveLength(1);
  });
  it('a paused or deleted agent sends nothing, and pending runs are cancelled', async () => {
    await callTool(rt, rec, 'pause_custom_agent', { agentId });
    await admin.query('INSERT INTO agent_runs (clinic_id,agent_id) VALUES ($1,$2)', [
      A.clinicId,
      agentId,
    ]);
    await run();
    expect(
      (
        await admin.query(
          'SELECT status FROM agent_runs WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 1',
          [agentId],
        )
      ).rows[0].status,
    ).toBe('skipped');
    await callTool(rt, manager, 'delete_custom_agent', { agentId });
    expect((await admin.query('SELECT 1 FROM custom_agents WHERE id=$1', [agentId])).rowCount).toBe(
      0,
    );
  });
  it("a clinic's agents never touch another clinic", async () => {
    const hindiBefore = (await bodies('+919811000002')).length;
    const idB = await create(weekly('diabetes'), 'Clinic B agent', managerB);
    await callTool(rt, managerB, 'activate_custom_agent', { agentId: idB });
    await dueNow(idB);
    await run(B);
    expect(await bodies('+919811000005')).toHaveLength(1);
    expect(await bodies('+919811000002')).toHaveLength(hindiBefore); // clinic A patient got nothing from clinic B's agent
    await expect(callTool(rt, manager, 'delete_custom_agent', { agentId: idB })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('quiet hours', () => {
  it('patients are not messaged at night: the run waits until 08:00 local time', async () => {
    const night = (
      await admin.query(
        "SELECT name FROM pg_timezone_names WHERE name LIKE '%/%' AND extract(hour FROM now() AT TIME ZONE name) = 2 LIMIT 1",
      )
    ).rows[0].name;
    await admin.query('UPDATE clinics SET timezone=$2 WHERE id=$1', [A.clinicId, night]);
    await admin.query('DELETE FROM custom_agent_sends');
    await tag(ids.other, ['quiet']);
    const id = await create(weekly('quiet'), 'Quiet hours agent');
    await callTool(rt, manager, 'activate_custom_agent', { agentId: id });
    await dueNow(id);
    const out = await run();
    expect(out.deferred).toBe(1);
    expect(await bodies('+919811000004')).toEqual([]);
    const later = (
      await admin.query(
        "SELECT run_at > now() AS later, to_char(run_at AT TIME ZONE $2,'HH24:MI') AS hm FROM agent_runs WHERE agent_id=$1",
        [id, night],
      )
    ).rows[0];
    expect(later).toEqual({ later: true, hm: '08:00' });
    await admin.query("UPDATE clinics SET timezone='Asia/Kolkata' WHERE id=$1", [A.clinicId]);
  });
});

describe('event-triggered and staff agents', () => {
  it('"after every visit": messages that patient only, a few hours later, if they match and consented', async () => {
    await admin.query('DELETE FROM custom_agent_sends');
    await admin.query('DELETE FROM custom_agents WHERE clinic_id=$1', [A.clinicId]);
    const id = await create(
      {
        trigger: { type: 'event', event: 'visit.finished', delayHours: 2 },
        audience: {},
        action: { type: 'message_patients', text: { en: 'Thank you for visiting, {name}.' } },
      },
      'Thank after visit',
    );
    await callTool(rt, manager, 'activate_custom_agent', { agentId: id });
    for (const [pid, phone] of [
      [ids.ok, '+919811000001'],
      [ids.noConsent, '+919811000003'],
    ] as const) {
      await callTool(rt, { clinicId: A.clinicId, actor: { kind: 'patient' } }, 'check_in_patient', {
        phone,
        doctorId: A.doctorIds[0],
        language: 'en',
        consent: {},
      });
      void pid;
    }
    await admin.query("UPDATE patients SET tags='{}'"); // re-enable consent for Asha (STOP earlier)
    await admin.query('UPDATE consents SET withdrawn_at=NULL WHERE patient_id=$1', [ids.ok]);
    await callTool(rt, doc, 'call_next_patient', {});
    await callTool(rt, doc, 'call_next_patient', {});
    await callTool(rt, doc, 'call_next_patient', {});
    const pending = (
      await admin.query(
        "SELECT count(*)::int n, bool_and(run_at > now() + interval '1 hour 50 minutes') AS delayed FROM agent_runs WHERE agent_id=$1 AND status='pending'",
        [id],
      )
    ).rows[0];
    expect(pending.n).toBe(2);
    expect(pending.delayed).toBe(true);
    await admin.query('UPDATE agent_runs SET run_at=now() WHERE agent_id=$1', [id]);
    await run();
    expect(await bodies('+919811000001')).toHaveLength(2); // earlier test message + this one
    expect((await bodies('+919811000001')).at(-1)).toMatch(/Thank you for visiting, Asha\./);
    expect(await bodies('+919811000003')).toEqual([]); // no consent: skipped, never messaged
  });
  it('"tell the receptionist when someone cancels": a console item plus WhatsApp to their number', async () => {
    await admin.query('DELETE FROM custom_agents WHERE clinic_id=$1', [A.clinicId]);
    const id = await create(
      {
        trigger: { type: 'event', event: 'appointment.cancelled', delayHours: 0 },
        audience: {},
        action: {
          type: 'notify_staff',
          to: 'receptionist',
          text: { en: '{name} cancelled an appointment.' },
        },
      },
      'Tell reception',
    );
    await callTool(rt, manager, 'activate_custom_agent', { agentId: id });
    const slot = (
      await callTool(rt, rec, 'list_free_slots', { doctorId: A.doctorIds[0], count: 1 })
    ).slots[0];
    const booked = await callTool(rt, rec, 'book_appointment', {
      doctorId: A.doctorIds[0],
      patientId: ids.ok,
      startsAt: slot,
    });
    await callTool(rt, rec, 'cancel_appointment', { appointmentId: booked.appointmentId });
    await run();
    expect(
      (
        await admin.query(
          "SELECT summary FROM flags WHERE summary LIKE '%cancelled an appointment%'",
        )
      ).rows[0].summary,
    ).toBe('Asha Diab cancelled an appointment.');
    expect(await bodies('+919810000002')).toEqual(['Asha Diab cancelled an appointment.']);
    expect(await bodies('+919810000001')).toEqual([]); // the doctor was not asked
  });
  it('a scheduled summary goes to the doctor with the chosen numbers', async () => {
    await admin.query('DELETE FROM custom_agents WHERE clinic_id=$1', [A.clinicId]);
    const id = await create(
      {
        trigger: { type: 'schedule', every: 'day', at: '19:00' },
        audience: {},
        action: { type: 'summary', metrics: ['seen', 'cancellations'] },
      },
      'Evening numbers',
    );
    await callTool(rt, manager, 'activate_custom_agent', { agentId: id });
    await dueNow(id);
    await run();
    const m = await bodies('+919810000001');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatch(
      /Evening numbers\n.*patient\(s\) seen today\.\n.*cancellation\(s\) today\./,
    );
  });
});
