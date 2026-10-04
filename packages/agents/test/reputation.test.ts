import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { EventBus, callTool, registerAllTools, type ToolContext } from '@sahayak/core';
import { LlmGate, handleInbound } from '../src';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
const env = { rt, gate: new LlmGate(null) };
let c: Awaited<ReturnType<typeof createTestClinic>>;
let doc: ToolContext;
const sys = () => ({ clinicId: c.clinicId, actor: { kind: 'system' as const } });
const say = (from: string, text: string) =>
  handleInbound(env, { clinicId: c.clinicId, from, text });
const REVIEW = 'https://g.page/r/test-clinic';

/** A finished visit for this patient, as the doctor's "Next patient" would leave it. */
async function finishVisit(patientId: string, phone: string): Promise<string> {
  const ci = await callTool(
    rt,
    { clinicId: c.clinicId, actor: { kind: 'patient' } },
    'check_in_patient',
    { phone, doctorId: c.doctorIds[0], language: 'en', consent: {} },
  );
  await callTool(rt, doc, 'call_next_patient', {});
  const entry = ci.queueEntryId as string;
  await callTool(rt, doc, 'finish_visit', { queueEntryId: entry });
  return entry;
}
const dueNow = () =>
  admin.query(
    "UPDATE follow_ups SET run_at=now() WHERE kind='review_request' AND status='pending'",
  );
const runDue = async () => {
  const rows = (
    await admin.query(
      "SELECT id FROM follow_ups WHERE status='pending' AND run_at <= now() AND kind='review_request' AND clinic_id=$1",
      [c.clinicId],
    )
  ).rows;
  for (const r of rows) await callTool(rt, sys(), 'run_followup', { followUpId: r.id });
  return rows.length;
};

beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  c = await createTestClinic(admin, 'rep');
  const u = (
    await admin.query(
      "INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'x','D','doctor',$3) RETURNING id",
      [c.clinicId, `d-${c.slug}@t.in`, c.doctorIds[0]],
    )
  ).rows[0].id;
  doc = {
    clinicId: c.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: u, doctorId: c.doctorIds[0] },
  };
});
afterAll(async () => {
  await dropTestClinic(admin, c.clinicId);
  await admin.end();
  await pool.end();
});

describe('feedback after a visit', () => {
  it('is off by default: nothing is scheduled', async () => {
    const p = await addPatient(admin, c.clinicId, 'Off Pt', '+919700000001');
    await finishVisit(p, '+919700000001');
    expect(
      (await admin.query("SELECT count(*)::int n FROM follow_ups WHERE kind='review_request'"))
        .rows[0].n,
    ).toBe(0);
  });
  it('when enabled, asks a few hours after the visit, only patients who agreed to follow-ups', async () => {
    await admin.query(`UPDATE clinic_settings SET reputation=$2 WHERE clinic_id=$1`, [
      c.clinicId,
      JSON.stringify({ enabled: true, review_url: REVIEW, delay_hours: 3, show_rating: true }),
    ]);
    const yes = await addPatient(admin, c.clinicId, 'Happy Pt', '+919700000002');
    const no = await addPatient(admin, c.clinicId, 'Silent Pt', '+919700000003', {
      whatsapp: false,
    });
    await finishVisit(yes, '+919700000002');
    await finishVisit(no, '+919700000003');
    const rows = (
      await admin.query(
        "SELECT patient_id, run_at > now() + interval '2 hours' AS later FROM follow_ups WHERE kind='review_request'",
      )
    ).rows;
    expect(rows).toEqual([{ patient_id: yes, later: true }]); // asked 3 hours later; nothing for the patient without consent
  });
  it('asks once, rating 5: thanks and the optional review link', async () => {
    await dueNow();
    expect(await runDue()).toBe(1);
    const ask = (
      await admin.query(
        "SELECT body FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.contact='+919700000002' ORDER BY m.created_at DESC LIMIT 1",
      )
    ).rows[0].body;
    expect(ask).toMatch(/how was your visit with Dr\. Test One/i);
    const r = await say('+919700000002', '5');
    expect(r.replies[0]).toMatch(/Thank you for your feedback/);
    expect(r.replies[1]).toContain(REVIEW);
    expect(
      (
        await admin.query(
          "SELECT rating, comment FROM visit_feedback WHERE patient_id=(SELECT id FROM patients WHERE phone='+919700000002')",
        )
      ).rows,
    ).toEqual([{ rating: 5, comment: null }]);
  });
  it('does not ask the same patient again within 60 days', async () => {
    const p = (await admin.query("SELECT id FROM patients WHERE phone='+919700000002'")).rows[0].id;
    await finishVisit(p, '+919700000002');
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM follow_ups WHERE kind='review_request' AND patient_id=$1",
          [p],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('unhappy patients (and no review gating)', () => {
  const phone = '+919700000010';
  let pid: string;
  it('a low rating alerts the receptionist AND still gets the review link: the link is offered to everyone', async () => {
    pid = await addPatient(admin, c.clinicId, 'Unhappy Pt', phone);
    await finishVisit(pid, phone);
    await dueNow();
    await runDue();
    const r = await say(phone, '2');
    expect(r.replies[0]).toMatch(/Sorry we did not meet your expectations/);
    expect(r.replies.join(' ')).toContain(REVIEW); // not hidden from unhappy patients
    const flag = (
      await admin.query('SELECT summary, severity FROM flags WHERE patient_id=$1', [pid])
    ).rows[0];
    expect(flag.summary).toMatch(/Low rating \(2\/5\) from Unhappy Pt/);
  });
  it('their comment is stored and shown to the team', async () => {
    const r = await say(phone, 'I waited 90 minutes and nobody told me why');
    expect(r.replies[0]).toMatch(/passed your comment/);
    expect(
      (await admin.query('SELECT comment FROM visit_feedback WHERE patient_id=$1', [pid])).rows[0]
        .comment,
    ).toMatch(/waited 90 minutes/);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM flags WHERE patient_id=$1 AND summary LIKE 'Feedback comment:%'",
          [pid],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('a comment that describes an emergency still triggers the safety path', async () => {
    const p2 = await addPatient(admin, c.clinicId, 'Alarm Pt', '+919700000011');
    await finishVisit(p2, '+919700000011');
    await dueNow();
    await runDue();
    await say('+919700000011', '1');
    const r = await say('+919700000011', 'and now I have chest pain');
    expect(r.redFlag).toBe(true);
  });
  it('anything that is not a rating just carries on normally', async () => {
    const p3 = await addPatient(admin, c.clinicId, 'Chatty Pt', '+919700000012');
    await finishVisit(p3, '+919700000012');
    await dueNow();
    await runDue();
    const r = await say('+919700000012', 'what are your timings?');
    expect(r.replies[0]).toMatch(/Clinic timings/);
  });
  it('respects STOP: no feedback request after consent is withdrawn', async () => {
    const p4 = await addPatient(admin, c.clinicId, 'Stopped Pt', '+919700000013');
    await finishVisit(p4, '+919700000013');
    await say('+919700000013', 'STOP');
    await dueNow();
    await runDue();
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.contact='+919700000013' AND m.body LIKE '%how was your visit%'",
        )
      ).rows[0].n,
    ).toBe(0);
  });
});

describe('ratings in "Ask your clinic", and the public page', () => {
  it('answers questions about ratings', async () => {
    const out = await callTool(rt, doc, 'ask_clinic', {
      question: 'what is our average rating today',
    });
    expect(out.answer).toMatch(
      /Average rating today: \d(\.\d)? out of 5 from 3 rating\(s\); 2 low/,
    );
  });
  it('the public page shows an average only with enough ratings, counting every rating', async () => {
    const before = (await pool.query('SELECT public_clinic_profile($1) AS p', [c.slug])).rows[0].p;
    expect(before.rating).toBeNull(); // 3 ratings: too few to publish
    const p = (await admin.query("SELECT id FROM patients WHERE phone='+919700000002'")).rows[0].id;
    for (let i = 0; i < 8; i++)
      await admin.query(
        'INSERT INTO visit_feedback (clinic_id,patient_id,rating) VALUES ($1,$2,5)',
        [c.clinicId, p],
      );
    const after = (await pool.query('SELECT public_clinic_profile($1) AS p', [c.slug])).rows[0].p;
    expect(after.rating).toEqual({ average: 4.4, count: 11 }); // includes the 1s and 2s: nothing filtered out
    expect(Object.keys(after).sort()).toEqual([
      'about',
      'address',
      'directions',
      'doctors',
      'name',
      'phone',
      'rating',
      'slug',
      'timings',
      'whatsapp',
    ]);
    expect(JSON.stringify(after)).not.toMatch(/Unhappy|waited 90/);
  });
  it('the rating is hidden unless the clinic chooses to show it', async () => {
    await admin.query(
      `UPDATE clinic_settings SET reputation = reputation || '{"show_rating": false}' WHERE clinic_id=$1`,
      [c.clinicId],
    );
    expect(
      (await pool.query('SELECT public_clinic_profile($1) AS p', [c.slug])).rows[0].p.rating,
    ).toBeNull();
    expect(
      (await pool.query('SELECT public_clinic_profile($1) AS p', ['no-such-clinic'])).rows[0].p,
    ).toBeNull();
  });
});
