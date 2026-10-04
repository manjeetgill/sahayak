import pg from 'pg';

/** Create an isolated clinic (open all day, every day) for tests. Returns ids; call dropTestClinic after. */
export async function createTestClinic(admin: pg.Client, tag = 'test') {
  const slug = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
  const clinicId = (
    await admin.query('INSERT INTO clinics (slug,name) VALUES ($1,$2) RETURNING id', [
      slug,
      `Clinic ${slug}`,
    ])
  ).rows[0].id as string;
  const all = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, '00:00-23:45']),
  );
  await admin.query(
    `INSERT INTO clinic_settings (clinic_id,address,directions,phone,timings,avg_consult_minutes,intake_questions) VALUES ($1,'1 Test Road','Next to the park','+911100000000',$2,10,$3)`,
    [
      clinicId,
      JSON.stringify(all),
      JSON.stringify([
        {
          id: 'reason',
          en: 'What is the reason for your visit?',
          hi: 'आपकी विज़िट का कारण क्या है?',
        },
        { id: 'duration', en: 'Since when?', hi: 'कब से?' },
      ]),
    ],
  );
  const doc = async (n: string) =>
    (
      await admin.query(
        "INSERT INTO doctors (clinic_id,name,speciality) VALUES ($1,$2,'GP') RETURNING id",
        [clinicId, n],
      )
    ).rows[0].id as string;
  const d1 = await doc('Dr. Test One'),
    d2 = await doc('Dr. Test Two');
  return { clinicId, slug, doctorIds: [d1, d2] as [string, string] };
}
export async function dropTestClinic(admin: pg.Client, clinicId: string) {
  await admin.query('DELETE FROM clinics WHERE id=$1', [clinicId]);
}
export async function addPatient(
  admin: pg.Client,
  clinicId: string,
  name: string,
  phone: string,
  opts: { whatsapp?: boolean; lang?: 'en' | 'hi' } = {},
) {
  const id = (
    await admin.query(
      'INSERT INTO patients (clinic_id,name,phone,language) VALUES ($1,$2,$3,$4) RETURNING id',
      [clinicId, name, phone, opts.lang ?? 'en'],
    )
  ).rows[0].id as string;
  for (const p of [
    'visit_data',
    ...(opts.whatsapp === false ? [] : ['whatsapp_messaging', 'reminders_followups']),
  ])
    await admin.query(
      "INSERT INTO consents (clinic_id,patient_id,purpose,notice_version) VALUES ($1,$2,$3,'v1')",
      [clinicId, id, p],
    );
  return id;
}
