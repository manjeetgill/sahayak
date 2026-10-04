import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPassword } from './password';

/** Demo data only. These passwords are for local development; never reuse them. */
export const DEMO_PASSWORD = 'demo1234';

const INTAKE = [
  { id: 'reason', en: 'What is the main reason for your visit today?', hi: 'आज आपकी विज़िट का मुख्य कारण क्या है?' },
  { id: 'duration', en: 'How long have you had this problem?', hi: 'यह समस्या कब से है?' },
  { id: 'medicines', en: 'Are you taking any medicines right now?', hi: 'क्या आप अभी कोई दवा ले रहे हैं?' },
  { id: 'allergies', en: 'Do you have any known allergies?', hi: 'क्या आपको कोई एलर्जी है?' },
];
const FIRST = ['Aarav','Vivaan','Aditya','Diya','Ananya','Ishaan','Kavya','Rohan','Saanvi','Arjun','Meera','Kabir','Priya','Rahul','Neha','Vikram','Anjali','Sanjay','Pooja','Amit','Sunita','Rajesh','Geeta','Manoj','Deepa'];

export async function seed(adminUrl = process.env.ADMIN_DATABASE_URL) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    if ((await c.query("SELECT 1 FROM clinics WHERE slug='dr-sharma'")).rowCount) {
      console.log('Seed already present');
      return;
    }
    const clinic = (await c.query(
      "INSERT INTO clinics (slug,name,default_language) VALUES ('dr-sharma',$1,'en') RETURNING id", ["Dr. Sharma's Clinic"])).rows[0].id;
    await c.query(
      `INSERT INTO clinic_settings (clinic_id,address,directions,phone,timings,avg_consult_minutes,intake_questions)
       VALUES ($1,$2,$3,$4,$5,10,$6)`,
      [clinic, '12 Model Town, Ludhiana, Punjab', 'Opposite City Mall, near the blue gate. Parking behind the building.', '+911612345678',
        JSON.stringify({ mon: '09:00-13:00, 17:00-20:00', tue: '09:00-13:00, 17:00-20:00', wed: '09:00-13:00, 17:00-20:00',
          thu: '09:00-13:00, 17:00-20:00', fri: '09:00-13:00, 17:00-20:00', sat: '09:00-13:00', sun: 'Closed' }),
        JSON.stringify(INTAKE)]);
    const doc = async (name: string, spec: string) =>
      (await c.query('INSERT INTO doctors (clinic_id,name,speciality) VALUES ($1,$2,$3) RETURNING id', [clinic, name, spec])).rows[0].id as string;
    const d1 = await doc('Dr. Anil Sharma', 'General Medicine');
    const d2 = await doc('Dr. Meera Sharma', 'Paediatrics');
    const pw = await hashPassword(DEMO_PASSWORD);
    const staff = (email: string, name: string, role: string, doctor: string | null) =>
      c.query('INSERT INTO staff_users (clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,$3,$4,$5,$6)', [clinic, email, pw, name, role, doctor]);
    await staff('anil@demo.sahayak.in', 'Dr. Anil Sharma', 'doctor', d1);
    await staff('meera@demo.sahayak.in', 'Dr. Meera Sharma', 'doctor', d2);
    await staff('reception@demo.sahayak.in', 'Sunita (Reception)', 'receptionist', null);

    const today = (await c.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d")).rows[0].d as Date;
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    // 25 appointments today: 13 for doctor 1 from 09:00, 12 for doctor 2 from 09:00, 15-minute slots.
    for (let i = 0; i < 25; i++) {
      const p = (await c.query(
        'INSERT INTO patients (clinic_id,name,phone,language,year_of_birth) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [clinic, `${FIRST[i]} ${i % 2 ? 'Kaur' : 'Singh'}`, `+91987650${String(1000 + i)}`, i % 3 === 0 ? 'hi' : 'en', 1950 + ((i * 7) % 55)])).rows[0].id;
      for (const purpose of ['visit_data', 'whatsapp_messaging', 'reminders_followups'])
        await c.query('INSERT INTO consents (clinic_id,patient_id,purpose,notice_version) VALUES ($1,$2,$3,$4)', [clinic, p, purpose, 'v1']);
      const first = i < 13;
      const slot = first ? i : i - 13;
      const mins = 9 * 60 + slot * 15;
      const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
      await c.query(
        `INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at,source,reason)
         VALUES ($1,$2,$3, ($4::date + $5::time) AT TIME ZONE 'Asia/Kolkata', ($4::date + $5::time + interval '15 minutes') AT TIME ZONE 'Asia/Kolkata', 'manual', $6)`,
        [clinic, first ? d1 : d2, p, day, `${hh}:${mm}`, ['Fever', 'Follow-up', 'Cough and cold', 'Routine check-up', 'Back pain'][i % 5]]);
    }
    console.log(`Seeded Dr. Sharma's Clinic (slug dr-sharma). Staff password: ${DEMO_PASSWORD}`);
  } finally {
    await c.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await seed();
