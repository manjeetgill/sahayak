import { expect, type APIRequestContext } from '@playwright/test';
import { DB } from './helpers';

/** Actual schedule and wait-list APIs, with fixtures confined to the disposable test DB. */
export async function videoDisruptions(request: APIRequestContext) {
  if (process.env.E2E_ISOLATED !== '1' || !process.env.ADMIN_DATABASE_URL?.includes('sahayak_e2e_'))
    throw new Error('This recording fixture requires an isolated test database.');
  const db = DB();
  await db.connect();
  const origin = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '4100'}`;
  let token = '',
    proposal = '',
    offer: any;
  const post = async (path: string, data: unknown) => {
    const response = await request.post(origin + path, {
      data,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const clinic = (await db.query("SELECT id FROM clinics WHERE slug='showcase-solo'")).rows[0].id;
  const doctor = (
    await db.query('SELECT id FROM doctors WHERE clinic_id=$1 AND active ORDER BY id LIMIT 1', [
      clinic,
    ])
  ).rows[0].id;
  // Keep this disconnected scenario within daytime offering hours, at any recording time.
  const offset = new Date().getUTCHours() - 12;
  const timezone = offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '+' : ''}${offset}`;
  await db.query('UPDATE clinics SET timezone=$2 WHERE id=$1', [clinic, timezone]);
  await db.query('UPDATE clinic_settings SET timings=$2 WHERE clinic_id=$1', [
    clinic,
    JSON.stringify(
      Object.fromEntries(
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '00:00-23:59']),
      ),
    ),
  ]);
  await db.query(
    "UPDATE appointments SET status='cancelled' WHERE clinic_id=$1 AND status IN ('booked','checked_in')",
    [clinic],
  );
  await db.query("UPDATE appointment_waitlist SET status='withdrawn' WHERE clinic_id=$1", [clinic]);
  const people: any[] = [];
  for (const [index, name] of ['Asha · demo', 'Rohan · demo', 'Meera · demo'].entries()) {
    const phone = `+91000088800${index}`;
    const patient = (
      await db.query(
        "INSERT INTO patients(clinic_id,name,phone,language,tags) VALUES($1,$2,$3,'en',ARRAY['DEMO']) RETURNING id,phone,name",
        [clinic, name, phone],
      )
    ).rows[0];
    for (const purpose of ['visit_data', 'whatsapp_messaging', 'reminders_followups'])
      await db.query(
        'INSERT INTO consents(clinic_id,patient_id,purpose,notice_version) VALUES($1,$2,$3,$4)',
        [clinic, patient.id, purpose, 'video-demo'],
      );
    people.push(patient);
  }
  const start = Math.ceil((Date.now() + 3600000) / 900000) * 900000;
  const appointments: any[] = [];
  for (let index = 0; index < 2; index++) {
    appointments.push(
      (
        await db.query(
          "INSERT INTO appointments(clinic_id,doctor_id,patient_id,starts_at,ends_at,source) VALUES($1,$2,$3,$4,$5,'manual') RETURNING id,starts_at",
          [
            clinic,
            doctor,
            people[index].id,
            new Date(start + index * 900000),
            new Date(start + (index + 1) * 900000),
          ],
        )
      ).rows[0],
    );
  }
  token = (await post('/auth/login', { email: 'doctor@solo.demo.test', password: 'demo1234' }))
    .token;
  const sim = (index: number, text: string) =>
    post('/sim/showcase-solo/message', { from: people[index].phone, text, doctorId: doctor });
  for (let i = 0; i < 3; i++) await sim(i, 'Hello');
  const day = (
    await db.query("SELECT to_char($1::timestamptz AT TIME ZONE $2,'YYYY-MM-DD') AS day", [
      new Date(start),
      timezone,
    ])
  ).rows[0].day;
  await post('/staff/waitlist', {
    patientId: people[2].id,
    doctorId: doctor,
    fromDate: day,
    toDate: day,
    optedIn: true,
  });
  const time = (value: string | Date) =>
    new Date(value).toLocaleTimeString('en-IN', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  const result = (tiles: string[][]) => ({
    tiles,
    fine: 'Actual saved changes in a fictional test clinic · Messages stay in the simulator · Demo clinic clock',
  });
  return {
    close: () => db.end(),
    async run(action: string) {
      if (action === 'late-propose') {
        const response = await post('/staff/schedule/propose', {
          text: "I'm running 30 minutes late",
        });
        expect(response.affected).toBe(2);
        proposal = response.proposalId;
        const unchanged = (
          await db.query('SELECT starts_at FROM appointments WHERE id=$1', [appointments[0].id])
        ).rows[0];
        expect(new Date(unchanged.starts_at).getTime()).toBe(start);
        return result([
          ['Doctor says', '“I’m running 30 minutes late.”'],
          ['Sahayak prepares', '2 affected appointments. Revised times ready for review.'],
          ['Doctor remains in control', 'Nothing moves and no notice is sent before confirmation.'],
        ]);
      }
      if (action === 'late-confirm') {
        await post(`/staff/schedule/${proposal}/confirm`, {});
        const rows = (
          await db.query(
            'SELECT id,starts_at FROM appointments WHERE id=ANY($1::uuid[]) ORDER BY starts_at',
            [appointments.map((a) => a.id)],
          )
        ).rows;
        expect(new Date(rows[0].starts_at).getTime()).toBe(start + 1800000);
        const notices = (
          await db.query('SELECT notified FROM schedule_shift_items WHERE proposal_id=$1', [
            proposal,
          ])
        ).rows;
        expect(notices.filter((r) => r.notified)).toHaveLength(2);
        const message = (
          await db.query(
            "SELECT m.body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.patient_id=$1 AND m.direction='out' AND m.body LIKE '%30 minutes late%' ORDER BY m.created_at DESC LIMIT 1",
            [people[0].id],
          )
        ).rows[0];
        expect(message?.body).toContain('30 minutes late');
        return result([
          ['Asha’s appointment', `${time(new Date(start))} → ${time(rows[0].starts_at)}`],
          ['Rohan’s appointment', `${time(new Date(start + 900000))} → ${time(rows[1].starts_at)}`],
          ['Notice to Asha · simulator', message.body],
        ]);
      }
      if (action === 'late-reply') {
        await sim(0, '1');
        const row = (
          await db.query(
            'SELECT response FROM schedule_shift_items WHERE proposal_id=$1 AND patient_id=$2',
            [proposal, people[0].id],
          )
        ).rows[0];
        expect(row.response).toBe('kept');
        return result([
          ['Asha replies', '“I can keep the new time.”'],
          ['Doctor’s summary', '1 patient has accepted the revised time.'],
          [
            'If the time does not work',
            'The late-notice conversation also supports requesting another time.',
          ],
        ]);
      }
      if (action === 'cancel') {
        await post(`/staff/appointments/${appointments[1].id}/cancel`, {});
        const row = (
          await db.query('SELECT status FROM appointments WHERE id=$1', [appointments[1].id])
        ).rows[0];
        expect(row.status).toBe('cancelled');
        offer = (
          await db.query("SELECT * FROM slot_offers WHERE patient_id=$1 AND status='pending'", [
            people[2].id,
          ])
        ).rows[0];
        expect(offer).toBeTruthy();
        return result([
          ['Rohan cancels', 'Future appointment marked cancelled in the clinic record.'],
          [
            'An opening is available',
            `${time(offer.starts_at)} is offered to an eligible waiting patient.`,
          ],
          [
            'Meera receives an offer',
            'She opted in to cancellation offers. Her offer expires in 15 minutes.',
          ],
        ]);
      }
      if (action === 'fill-slot') {
        await sim(2, `ACCEPT ${offer.code}`);
        const row = (
          await db.query('SELECT status,appointment_id FROM slot_offers WHERE id=$1', [offer.id])
        ).rows[0];
        expect(row.status).toBe('accepted');
        const bookings = (
          await db.query(
            "SELECT id FROM appointments WHERE doctor_id=$1 AND starts_at=$2 AND status='booked'",
            [doctor, offer.starts_at],
          )
        ).rows;
        expect(bookings).toHaveLength(1);
        expect(bookings[0].id).toBe(row.appointment_id);
        await sim(2, `ACCEPT ${offer.code}`);
        const count = (
          await db.query(
            "SELECT count(*) FROM appointments WHERE doctor_id=$1 AND starts_at=$2 AND status='booked'",
            [doctor, offer.starts_at],
          )
        ).rows[0].count;
        expect(Number(count)).toBe(1);
        return result([
          ['Meera accepts', 'The offered slot becomes her confirmed appointment.'],
          [
            'Clinic calendar updated',
            `${time(offer.starts_at)} · Meera booked. Rohan remains cancelled.`,
          ],
          [
            'One slot, one booking',
            'A repeated acceptance does not create a second booking. Queue entry follows arrival.',
          ],
        ]);
      }
      throw new Error(`Unknown interruption action: ${action}`);
    },
  };
}
