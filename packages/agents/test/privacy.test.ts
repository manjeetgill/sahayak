import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool, withClinic } from '@sahayak/db';
import { EventBus, callTool, registerAllTools, type ToolContext } from '@sahayak/core';
import { LlmGate, detectPrivacyRequest, handleInbound } from '../src';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
const env = { rt, gate: new LlmGate(null) };
let c: Awaited<ReturnType<typeof createTestClinic>>;
let rec: ToolContext;
const say = (from: string, text: string) =>
  handleInbound(env, { clinicId: c.clinicId, from, text });
const one = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  c = await createTestClinic(admin, 'priv');
  const u = (
    await admin.query(
      "INSERT INTO staff_users (clinic_id,email,password_hash,name,role) VALUES ($1,$2,'x','R','receptionist') RETURNING id",
      [c.clinicId, `r-${c.slug}@t.in`],
    )
  ).rows[0].id;
  rec = { clinicId: c.clinicId, actor: { kind: 'staff', role: 'receptionist', userId: u } };
});
afterAll(async () => {
  await dropTestClinic(admin, c.clinicId);
  await admin.end();
  await pool.end();
});

describe('request detection', () => {
  it.each([
    ['STOP', 'stop'],
    ['stop', 'stop'],
    ["please don't message me", 'stop'],
    ['message band karo', 'stop'],
    ['start', 'start'],
    ['delete my data', 'delete_data'],
    ['please erase my details', 'delete_data'],
    ['mera data delete karo', 'delete_data'],
    ['मेरा डेटा हटा दो', 'delete_data'],
    ['what data do you have about me', 'my_data'],
    ['export my data', 'my_data'],
    ['मेरा डेटा क्या है', 'my_data'],
    ['what are your timings', null],
    ['stop the bleeding', null],
    ['I need to start treatment', null],
  ])('%s -> %s', (text, want) => expect(detectPrivacyRequest(text)).toBe(want));
});

describe('STOP / START', () => {
  it('STOP withdraws messaging consent, cancels pending follow-ups, and no proactive message goes out', async () => {
    const pid = await addPatient(admin, c.clinicId, 'Stopper', '+919600000001');
    await admin.query(
      "INSERT INTO follow_ups (clinic_id,patient_id,kind,run_at) VALUES ($1,$2,'post_visit', now())",
      [c.clinicId, pid],
    );
    const r = await say('+919600000001', 'STOP');
    expect(r.replies[0]).toMatch(/will not receive any more messages/);
    expect(
      await one('SELECT purpose FROM consents WHERE patient_id=$1 AND withdrawn_at IS NULL', [pid]),
    ).toEqual([{ purpose: 'visit_data' }]);
    expect(
      (await one('SELECT status, detail FROM follow_ups WHERE patient_id=$1', [pid]))[0],
    ).toEqual({ status: 'skipped', detail: 'consent_withdrawn' });
    const sys = { clinicId: c.clinicId, actor: { kind: 'system' as const } };
    const f = await callTool(rt, rec, 'schedule_followup', {
      patientId: pid,
      kind: 'post_visit',
      runAt: new Date().toISOString(),
    });
    expect((await callTool(rt, sys, 'run_followup', { followUpId: f.followUpId })).status).toBe(
      'skipped',
    );
    // but replies to their own questions still work
    expect((await say('+919600000001', 'what are your timings')).replies[0]).toMatch(
      /Clinic timings/,
    );
  });
  it('START turns messaging back on', async () => {
    const r = await say('+919600000001', 'START');
    expect(r.replies[0]).toMatch(/messages are back on/);
    const pid = (await one("SELECT id FROM patients WHERE phone='+919600000001'"))[0].id;
    expect(
      (
        await one(
          'SELECT purpose FROM consents WHERE patient_id=$1 AND withdrawn_at IS NULL ORDER BY purpose',
          [pid],
        )
      ).map((x) => x.purpose),
    ).toContain('whatsapp_messaging');
  });
});

describe('see, export and erase my data', () => {
  let pid: string;
  const phone = '+919600000002';
  beforeAll(async () => {
    pid = await addPatient(admin, c.clinicId, 'Erase Me', phone);
    await admin.query('UPDATE patients SET year_of_birth=1980 WHERE id=$1', [pid]);
    await admin.query(
      "INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at,reason) VALUES ($1,$2,$3, now()+interval '2 days', now()+interval '2 days 15 min', 'private reason')",
      [c.clinicId, c.doctorIds[0], pid],
    );
    await admin.query(
      "INSERT INTO intake_summaries (clinic_id,patient_id,answers,summary) VALUES ($1,$2,'[]','secret symptoms')",
      [c.clinicId, pid],
    );
    await addPatient(admin, c.clinicId, 'Bystander', '+919600000003');
    await say(phone, 'hello');
  });
  it('"what data do you have" lists what is held', async () => {
    const r = await say(phone, 'what data do you have about me?');
    expect(r.replies[0]).toMatch(/Erase Me/);
    expect(r.replies[0]).toMatch(/1 appointment/);
  });
  it('staff can export a complete copy', async () => {
    const out = await callTool(rt, rec, 'export_patient_data', { patientId: pid });
    expect(out.patient.name).toBe('Erase Me');
    expect(out.intake[0].summary).toBe('secret symptoms');
    expect(out.messages.length).toBeGreaterThan(0);
  });
  it('erasure needs an explicit DELETE; anything else cancels', async () => {
    let r = await say(phone, 'delete my data');
    expect(r.replies[0]).toMatch(/Reply DELETE to confirm/);
    r = await say(phone, 'actually no');
    expect(r.replies[0]).toMatch(/nothing was deleted/);
    expect((await one('SELECT name FROM patients WHERE id=$1', [pid]))[0].name).toBe('Erase Me');
  });
  it('DELETE removes identity, chats, intake and follow-ups, and redacts the audit log', async () => {
    await say(phone, 'delete my data');
    const r = await say(phone, 'DELETE');
    expect(r.replies[0]).toMatch(/has been erased/);
    const p = (await one('SELECT name, phone, year_of_birth FROM patients WHERE id=$1', [pid]))[0];
    expect(p).toEqual({ name: 'Erased patient', phone: `erased:${pid}`, year_of_birth: null });
    expect(await one('SELECT 1 FROM conversations WHERE contact=$1', [phone])).toHaveLength(0);
    expect(
      await one(
        'SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.patient_id=$1',
        [pid],
      ),
    ).toHaveLength(0);
    expect(await one('SELECT 1 FROM intake_summaries WHERE patient_id=$1', [pid])).toHaveLength(0);
    expect(
      (await one('SELECT reason FROM appointments WHERE patient_id=$1', [pid]))[0].reason,
    ).toBeNull();
    const audit = await one('SELECT input FROM agent_actions WHERE patient_id=$1', [pid]);
    expect(audit.length).toBeGreaterThan(0);
    // every earlier entry is stripped; the erase call itself only records the (now meaningless) patient id
    for (const a of audit) expect([{ redacted: true }, { patientId: pid }]).toContainEqual(a.input);
    expect(JSON.stringify(audit)).not.toMatch(/Erase Me|\+919600000002/);
    expect(
      JSON.stringify(await one('SELECT * FROM agent_actions WHERE clinic_id=$1', [c.clinicId])),
    ).not.toContain('Erase Me');
    expect((await one("SELECT name FROM patients WHERE phone='+919600000003'"))[0].name).toBe(
      'Bystander',
    ); // others untouched
    expect((await one("SELECT kind, via FROM data_requests WHERE kind='erase'"))[0]).toEqual({
      kind: 'erase',
      via: 'whatsapp',
    });
  });
  it('receptionist can erase on behalf of a patient at the desk', async () => {
    const p2 = await addPatient(admin, c.clinicId, 'Desk Erase', '+919600000004');
    await callTool(rt, rec, 'erase_patient_data', { patientId: p2 });
    expect((await one('SELECT name FROM patients WHERE id=$1', [p2]))[0].name).toBe(
      'Erased patient',
    );
  });
  it('a patient can only erase their own data', async () => {
    const other = (await one("SELECT id FROM patients WHERE phone='+919600000003'"))[0].id;
    await say('+919600000001', 'hello');
    const conv = (await one("SELECT id FROM conversations WHERE contact='+919600000001'"))[0].id;
    const mine = (await one("SELECT id FROM patients WHERE phone='+919600000001'"))[0].id;
    await expect(
      callTool(
        rt,
        {
          clinicId: c.clinicId,
          actor: { kind: 'agent', agent: 'front_desk' },
          patientId: mine,
          conversationId: conv,
        },
        'erase_patient_data',
        { patientId: other },
      ),
    ).rejects.toThrow(/only access the current patient/);
  });
  it('an unknown number can have its chat removed too', async () => {
    const lead = '+919600000005';
    await say(lead, 'hi');
    await say(lead, 'delete my data');
    expect((await say(lead, 'DELETE')).replies[0]).toMatch(/erased/);
    expect(
      await one(
        'SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.contact=$1',
        [lead],
      ),
    ).toHaveLength(0);
  });
});

describe('retention rules', () => {
  it('old messages and intake answers are deleted, old audit payloads redacted, inactive patients erased', async () => {
    const old = await addPatient(admin, c.clinicId, 'Old Inactive', '+919600000010');
    await admin.query("UPDATE patients SET created_at = now() - interval '5 years' WHERE id=$1", [
      old,
    ]);
    const act = await addPatient(admin, c.clinicId, 'Recent Active', '+919600000011');
    await admin.query("UPDATE patients SET created_at = now() - interval '5 years' WHERE id=$1", [
      act,
    ]);
    await admin.query(
      "INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at) VALUES ($1,$2,$3, now()+interval '3 days', now()+interval '3 days 15 min')",
      [c.clinicId, c.doctorIds[0], act],
    );
    const conv = (
      await admin
        .query(
          "INSERT INTO conversations (clinic_id,patient_id,contact) VALUES ($1,$2,'+919600000012',$2) RETURNING id",
          [c.clinicId, null].slice(0, 2) as any,
        )
        .catch(async () =>
          admin.query(
            "INSERT INTO conversations (clinic_id,contact) VALUES ($1,'+919600000012') RETURNING id",
            [c.clinicId],
          ),
        )
    ).rows[0].id;
    await admin.query(
      "INSERT INTO messages (clinic_id,conversation_id,direction,sender,body,created_at) VALUES ($1,$2,'in','patient','ancient', now() - interval '400 days'), ($1,$2,'in','patient','fresh', now())",
      [c.clinicId, conv],
    );
    await admin.query(
      "INSERT INTO intake_summaries (clinic_id,patient_id,answers,summary,created_at) VALUES ($1,$2,'[]','old intake', now() - interval '500 days')",
      [c.clinicId, act],
    );
    await admin.query(
      "INSERT INTO agent_actions (clinic_id,agent,kind,input,created_at) VALUES ($1,'system','decision','{\"name\":\"Someone\"}', now() - interval '800 days')",
      [c.clinicId],
    );
    const out = await callTool(
      rt,
      { clinicId: c.clinicId, actor: { kind: 'system' } },
      'apply_retention',
      {},
    );
    expect(out.messages).toBeGreaterThanOrEqual(1);
    expect(out.patientsErased).toBeGreaterThanOrEqual(1);
    expect(
      (await one('SELECT body FROM messages WHERE conversation_id=$1', [conv])).map((m) => m.body),
    ).toEqual(['fresh']);
    expect(await one('SELECT 1 FROM intake_summaries WHERE patient_id=$1', [act])).toHaveLength(0);
    expect((await one('SELECT name FROM patients WHERE id=$1', [old]))[0].name).toBe(
      'Erased patient',
    );
    expect((await one('SELECT name FROM patients WHERE id=$1', [act]))[0].name).toBe(
      'Recent Active',
    ); // has an upcoming appointment
    expect(
      (
        await one("SELECT input FROM agent_actions WHERE created_at < now() - interval '700 days'")
      )[0].input,
    ).toEqual({ redacted: true });
  });
  it('the redaction functions refuse to touch another clinic or short audit retention', async () => {
    const other = await createTestClinic(admin, 'priv2');
    await expect(
      withClinic(pool, other.clinicId, (db) =>
        db.query('SELECT redact_old_audit($1,$2)', [c.clinicId, 800]),
      ),
    ).rejects.toThrow(/wrong clinic context/);
    await expect(
      withClinic(pool, c.clinicId, (db) =>
        db.query('SELECT redact_old_audit($1,$2)', [c.clinicId, 30]),
      ),
    ).rejects.toThrow(/365 days/);
    await dropTestClinic(admin, other.clinicId);
  });
  it('retention floors are enforced when a doctor changes the rules', async () => {
    const doc = {
      clinicId: c.clinicId,
      actor: {
        kind: 'staff' as const,
        role: 'doctor' as const,
        userId: rec.actor.kind === 'staff' ? rec.actor.userId : '',
        doctorId: c.doctorIds[0],
      },
    };
    await expect(
      callTool(rt, doc, 'update_clinic_settings', {
        retentionRules: {
          messages_days: 10,
          intake_days: 365,
          audit_days: 730,
          inactive_patient_days: 1095,
        },
      }),
    ).rejects.toThrow();
    await expect(
      callTool(rt, doc, 'update_clinic_settings', {
        retentionRules: {
          messages_days: 90,
          intake_days: 365,
          audit_days: 100,
          inactive_patient_days: 1095,
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await callTool(rt, doc, 'update_clinic_settings', {
          retentionRules: {
            messages_days: 90,
            intake_days: 365,
            audit_days: 730,
            inactive_patient_days: 1095,
          },
        })
      ).changed,
    ).toEqual(['retentionRules']);
  });
});
