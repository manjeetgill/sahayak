/** Local, synthetic meeting demo. No messages are sent; existing clinics are untouched. */
import pg from 'pg';
import { hashPassword, makePool } from '../packages/db/src/index';
import { callTool, EventBus, registerAllTools, type ToolContext } from '../packages/core/src/index';
if (process.env.NODE_ENV === 'production' || !process.argv.includes('--create'))
  throw new Error('Local demo only. Run with --create.');
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
await admin.connect();
const pool = makePool();
try {
  const existing = (await admin.query("SELECT id FROM clinics WHERE slug='feedback-demo'")).rows[0];
  if (existing) {
    console.log('Feedback demo already exists; preserving its data.');
  } else {
    await admin.query('BEGIN');
    const clinic = (
      await admin.query(
        "INSERT INTO clinics(slug,name) VALUES('feedback-demo','Patient Care Demo Clinic') RETURNING id",
      )
    ).rows[0].id;
    await admin.query(
      "INSERT INTO clinic_settings(clinic_id,address,directions,phone,timings,avg_consult_minutes,intake_questions,setup) VALUES($1,'Demo only','Demo only','+910000000000',$2,10,'[]','{\"completed\":true}')",
      [
        clinic,
        JSON.stringify(
          Object.fromEntries(
            ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '00:00-23:45']),
          ),
        ),
      ],
    );
    const doctor = (
      await admin.query(
        "INSERT INTO doctors(clinic_id,name,speciality) VALUES($1,'Dr. Demo','General practice') RETURNING id",
        [clinic],
      )
    ).rows[0].id;
    const password = await hashPassword('demo1234');
    const user = (
      await admin.query(
        "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES($1,'feedback@demo.sahayak.in',$2,'Dr. Demo','doctor',$3) RETURNING id",
        [clinic, password, doctor],
      )
    ).rows[0].id;
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role) VALUES($1,'feedback.reception@demo.sahayak.in',$2,'Demo Reception','receptionist')",
      [clinic, password],
    );
    const patients = [];
    for (let n = 1; n <= 3; n++) {
      const p = (
        await admin.query(
          'INSERT INTO patients(clinic_id,name,phone,language) VALUES($1,$2,$3,$4) RETURNING id',
          [
            clinic,
            ['Demo patient — Asha', 'Demo patient — Ravi', 'Demo patient — Meera'][n - 1],
            `+91000000000${n}`,
            n === 3 ? 'hi' : 'en',
          ],
        )
      ).rows[0].id;
      for (const purpose of ['visit_data', 'whatsapp_messaging', 'reminders_followups'])
        await admin.query(
          "INSERT INTO consents(clinic_id,patient_id,purpose,notice_version) VALUES($1,$2,$3,'synthetic-demo-only')",
          [clinic, p, purpose],
        );
      const visit = (
        await admin.query(
          'INSERT INTO queue_entries(clinic_id,patient_id,doctor_id,queue_date,token_number,position_key,status) VALUES($1,$2,$3,current_date,$4::integer,$4::integer,$5) RETURNING id',
          [clinic, p, doctor, n, n === 3 ? 'in_consultation' : 'done'],
        )
      ).rows[0].id;
      patients.push({ id: p, visit, language: n === 3 ? 'hi' : 'en' });
    }
    await admin.query('COMMIT');
    registerAllTools();
    const rt = { pool, bus: new EventBus('') };
    const ctx: ToolContext = {
      clinicId: clinic,
      actor: { kind: 'staff', role: 'doctor', userId: user, doctorId: doctor },
    };
    for (let n = 0; n < 2; n++) {
      const p = patients[n];
      const c = await callTool(rt, ctx, 'schedule_patient_checkin', {
        patientId: p.id,
        queueEntryId: p.visit,
        assignedTo: user,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        language: p.language,
        consent: true,
      });
      const link = await callTool(rt, ctx, 'prepare_feedback_link', {
        id: c.checkinId,
        purpose: 'response',
      });
      await callTool(
        rt,
        { clinicId: clinic, actor: { kind: 'patient' } },
        'submit_patient_feedback',
        {
          token: link.path.split('#')[1],
          recovery: n === 0 ? 'same' : 'better',
          help: n === 0 ? 'instructions' : 'visit',
          theme: n === 0 ? 'explanation' : 'waiting',
          message:
            n === 0
              ? 'Demo: I am still feeling the same and did not understand when to return.'
              : 'Demo: I feel better, but the waiting time was long. Please help me book a quieter time.',
        },
      );
    }
    console.log(
      'Synthetic demo ready: feedback@demo.sahayak.in / demo1234. Reception: feedback.reception@demo.sahayak.in. WhatsApp invitations remain disabled.',
    );
  }
  // Keep one untouched form available for a live walkthrough, without resetting earlier cases.
  await admin.query(
    "INSERT INTO staff_users(clinic_id,email,password_hash,name,role) SELECT id,'feedback.admin@demo.sahayak.in',$1,'Demo Admin','admin' FROM clinics WHERE slug='feedback-demo' ON CONFLICT (email) DO NOTHING",
    [await hashPassword('demo1234')],
  );
  const demo = (await admin.query("SELECT id FROM clinics WHERE slug='feedback-demo'")).rows[0];
  const pending = (
    await admin.query("SELECT id FROM patients WHERE clinic_id=$1 AND phone='+910000000004'", [
      demo.id,
    ])
  ).rows[0];
  if (!pending) {
    const staff = (
      await admin.query(
        "SELECT id,doctor_id FROM staff_users WHERE clinic_id=$1 AND email='feedback@demo.sahayak.in'",
        [demo.id],
      )
    ).rows[0];
    await admin.query('BEGIN');
    const p = (
      await admin.query(
        "INSERT INTO patients(clinic_id,name,phone,language) VALUES($1,'Demo patient — New check-in','+910000000004','en') RETURNING id",
        [demo.id],
      )
    ).rows[0].id;
    for (const purpose of ['visit_data', 'whatsapp_messaging', 'reminders_followups'])
      await admin.query(
        "INSERT INTO consents(clinic_id,patient_id,purpose,notice_version) VALUES($1,$2,$3,'synthetic-demo-only')",
        [demo.id, p, purpose],
      );
    const visit = (
      await admin.query(
        "INSERT INTO queue_entries(clinic_id,patient_id,doctor_id,queue_date,token_number,position_key,status) VALUES($1,$2,$3,current_date,4,4,'done') RETURNING id",
        [demo.id, p, staff.doctor_id],
      )
    ).rows[0].id;
    await admin.query('COMMIT');
    registerAllTools();
    await callTool(
      { pool, bus: new EventBus('') },
      {
        clinicId: demo.id,
        actor: { kind: 'staff', role: 'doctor', userId: staff.id, doctorId: staff.doctor_id },
      },
      'schedule_patient_checkin',
      {
        patientId: p,
        queueEntryId: visit,
        assignedTo: staff.id,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        language: 'en',
        consent: true,
      },
    );
    console.log('Untouched patient form case added for the meeting.');
  }
} finally {
  await admin.end();
  await pool.end();
}
