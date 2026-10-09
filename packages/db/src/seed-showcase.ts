import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPassword } from './password';

/** Fictional, local-only walkthrough data. Never use real contact details here. */
const PASSWORD = 'demo1234';
const CLINICS = [
  { slug: 'showcase-solo', name: 'DEMO · One Doctor Clinic', mode: 'solo' as const },
  { slug: 'showcase-hospital', name: 'DEMO · Community Hospital', mode: 'full' as const },
];

const intakeQuestions = [
  { id: 'reason', en: 'What brings you in today?', hi: 'आज आप किस कारण आए हैं?' },
  { id: 'duration', en: 'When did this start?', hi: 'यह कब शुरू हुआ?' },
  { id: 'allergies', en: 'Any known allergies?', hi: 'क्या कोई एलर्जी है?' },
];
const hours = {
  mon: '09:00-13:00, 15:00-18:00', tue: '09:00-13:00, 15:00-18:00',
  wed: '09:00-13:00, 15:00-18:00', thu: '09:00-13:00, 15:00-18:00',
  fri: '09:00-13:00, 15:00-18:00', sat: '09:00-13:00', sun: 'Closed',
};
const localToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
function day(offset: number) {
  const d = new Date(`${localToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const at = (offset: number, time: string) => `${day(offset)}T${time}:00+05:30`;
const json = (value: unknown) => JSON.stringify(value);

// A real, tiny PDF so the report viewer has a file to open. It contains no clinical result.
function demoPdf(line: string) {
  const stream = `BT /F1 16 Tf 48 740 Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

async function seedClinic(db: pg.Client, config: (typeof CLINICS)[number], passwordHash: string) {
  const existing = await db.query('SELECT id,name FROM clinics WHERE slug=$1', [config.slug]);
  if (existing.rowCount) {
    console.log(`${config.slug}: already present; existing demo work was kept.`);
    return;
  }
  await db.query('BEGIN');
  try {
    const clinic = (await db.query(
      'INSERT INTO clinics(slug,name,default_language) VALUES($1,$2,$3) RETURNING id',
      [config.slug, config.name, 'en'],
    )).rows[0].id as string;
    await db.query(
      `INSERT INTO clinic_settings(clinic_id,address,directions,phone,timings,avg_consult_minutes,
         intake_questions,faqs,setup,public_page,workspace_mode,ai_features,reputation)
       VALUES($1,$2,$3,$4,$5,15,$6,$7,$8,$9,$10,$11,$12)`,
      [clinic, 'Fictional Demo Road, Sample City', 'Demo location only. No physical clinic is here.',
        '+910000000000', json(hours), json(intakeQuestions),
        json([
          { id: 'fees', keywords: ['fees', 'price', 'फीस'], en: 'The sample consultation fee is ₹500. Please confirm with reception.', hi: 'डेमो परामर्श शुल्क ₹500 है। रिसेप्शन से पुष्टि करें।' },
        ]),
        json({ completed: true }), json({ about: 'Fictional clinic and patients for a Sahayak product demonstration.' }),
        config.mode, json({ scribe: true }),
        json({ enabled: false, review_url: '', delay_hours: 3, show_rating: false })],
    );

    const doctor = async (name: string, speciality: string) => (await db.query(
      'INSERT INTO doctors(clinic_id,name,speciality,qualifications,registration_no) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [clinic, name, speciality, 'Demo profile', null],
    )).rows[0].id as string;
    const firstDoctor = await doctor('Dr. Kavita Rao', 'General Medicine');
    const secondDoctor = config.mode === 'full' ? await doctor('Dr. Farah Ali', 'Paediatrics') : firstDoctor;
    const staff = async (email: string, name: string, role: string, doctorId: string | null, soloOwner = false) =>
      (await db.query(
        'INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id,solo_owner) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [clinic, email, passwordHash, name, role, doctorId, soloOwner],
      )).rows[0].id as string;
    const admin = config.mode === 'full'
      ? await staff('admin@hospital.demo.test', 'Demo Hospital Admin', 'admin', null)
      : null;
    const firstUser = await staff(config.mode === 'solo' ? 'doctor@solo.demo.test' : 'kavita@hospital.demo.test',
      'Dr. Kavita Rao', 'doctor', firstDoctor, config.mode === 'solo');
    const secondUser = config.mode === 'full'
      ? await staff('farah@hospital.demo.test', 'Dr. Farah Ali', 'doctor', secondDoctor)
      : firstUser;
    const desk = await staff(config.mode === 'solo' ? 'desk@solo.demo.test' : 'desk@hospital.demo.test',
      'Demo Reception', 'receptionist', null);

    await db.query(
      'INSERT INTO clinic_qr_settings(clinic_id,enabled,amount_paise,public_web_url,updated_by) VALUES($1,true,50000,$2,$3)',
      [clinic, 'http://localhost:3000', admin ?? firstUser],
    );
    await db.query('INSERT INTO patient_feedback_settings(clinic_id,enabled) VALUES($1,false)', [clinic]);
    for (const [doctorId, userId, enabled] of [
      [firstDoctor, firstUser, true],
      ...(config.mode === 'full' ? [[secondDoctor, secondUser, false]] : []),
    ] as [string, string, boolean][]) {
      await db.query(
        'INSERT INTO doctor_feedback_preferences(doctor_id,clinic_id,enabled,delay_days,send_time,assigned_to,updated_by) VALUES($1,$2,$3,1,$4,$5,$5)',
        [doctorId, clinic, enabled, '18:00', userId],
      );
      for (const kind of ['whatsapp', 'phone', 'reminders'])
        await db.query(
          'INSERT INTO doctor_assistant_access(clinic_id,doctor_id,kind,allowed,enabled) VALUES($1,$2,$3,true,$4)',
          // Enable each doctor's assistant for the practice channels. No live
          // WhatsApp or calling connection is created for either demo clinic.
          [clinic, doctorId, kind, true],
        );
      await db.query(
        'INSERT INTO visit_templates(clinic_id,doctor_id,name,body) VALUES($1,$2,$3,$4)',
        [clinic, doctorId, 'Follow-up note', 'Concern:\nHistory:\nExamination (only if observed):\nPlan:\nFollow-up:'],
      );
      await db.query(
        'INSERT INTO doctor_medicine_catalog(clinic_id,doctor_id,name) VALUES($1,$2,$3)',
        [clinic, doctorId, 'Paracetamol'],
      );
    }
    await db.query(
      'INSERT INTO care_templates(clinic_id,family_id,version,title,steps,created_by,approved_by,approved_at) VALUES($1,$2,1,$3,$4,$5,$5,now())',
      [clinic, randomUUID(), 'Appointment follow-through',
        json([{ title: 'Confirm visit date', message: 'Please contact the clinic to confirm your follow-up appointment.', afterDays: 2 }]), firstUser],
    );
    await db.query(
      'INSERT INTO custom_agents(clinic_id,name,description,spec,status,created_by,doctor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [clinic, 'Daily clinic summary (demo draft)', 'A sample staff summary that is not active.',
        json({ trigger: { type: 'schedule', every: 'day', at: '20:00' }, audience: {},
          action: { type: 'summary', metrics: ['seen', 'appointments', 'wait'] } }), 'draft', firstUser, firstDoctor],
    );

    const patientData = [
      ['Asha Demo', 'en', 1988, ['new patient']],
      ['Ravi Demo', 'hi', 1977, ['follow-up']],
      ['Meena Demo', 'en', 1992, ['follow-up']],
      ['Kabir Demo', 'hi', 1983, ['feedback']],
      ['Noor Demo', 'en', 2000, ['new patient']],
      ['Pooja Demo', 'hi', 1995, ['needs call']],
      ['Ishaan Demo', 'en', 2017, ['paediatric']],
      ['Anaya Demo', 'en', 1990, ['booked today']],
      ['Dev Demo', 'en', 1986, ['agent booking']],
    ] as const;
    const patients: string[] = [];
    for (let i = 0; i < patientData.length; i++) {
      const [name, language, birth, tags] = patientData[i];
      const id = (await db.query(
        'INSERT INTO patients(clinic_id,name,phone,language,year_of_birth,tags,source) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [clinic, name, `+9100000000${String(i + 1).padStart(2, '0')}`, language, birth, tags, 'demo'],
      )).rows[0].id as string;
      patients.push(id);
      // The two agent-journey patients have visit-data permission but no
      // proactive messaging permission. Their practice chats use the mock
      // channel, and check-in prepares no outbound patient message.
      for (const purpose of i >= 7 ? ['visit_data'] : ['visit_data', 'whatsapp_messaging', 'reminders_followups'])
        await db.query(
          'INSERT INTO consents(clinic_id,patient_id,purpose,notice_version) VALUES($1,$2,$3,$4)',
          [clinic, id, purpose, 'demo-v1'],
        );
    }
    const appointment = async (patient: number, doctorId: string, offset: number, time: string, status: string, reason: string) =>
      (await db.query(
        `INSERT INTO appointments(clinic_id,doctor_id,patient_id,starts_at,ends_at,status,source,reason)
         VALUES($1,$2,$3,$4::timestamptz,$4::timestamptz+interval '15 minutes',$5,'manual',$6) RETURNING id`,
        [clinic, doctorId, patients[patient], at(offset, time), status, reason],
      )).rows[0].id as string;
    const queue = async (patient: number, doctorId: string, apptId: string, offset: number, token: number, status: string) =>
      (await db.query(
        `INSERT INTO queue_entries(clinic_id,doctor_id,patient_id,appointment_id,queue_date,token_number,status,position_key,
           checked_in_at,called_at,finished_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [clinic, doctorId, patients[patient], apptId, day(offset), token, status, token * 1000,
          at(offset, '09:30'), ['called', 'in_consultation', 'done'].includes(status) ? at(offset, '10:00') : null,
          status === 'done' ? at(offset, '10:30') : null],
      )).rows[0].id as string;

    const a0 = await appointment(0, firstDoctor, 0, '10:00', 'checked_in', 'First visit discussion');
    const a1 = await appointment(1, firstDoctor, 0, '10:15', 'checked_in', 'Review previous visit');
    const a2 = await appointment(2, firstDoctor, -1, '10:00', 'completed', 'Follow-up conversation');
    const a3 = await appointment(3, firstDoctor, -2, '11:00', 'completed', 'Routine visit');
    await appointment(4, secondDoctor, 1, '10:30', 'booked', 'New appointment');
    await appointment(5, firstDoctor, 1, '11:30', 'cancelled', 'Cancelled slot for waiting list');
    const a6 = await appointment(6, secondDoctor, 0, '11:00', 'checked_in', 'Paediatric visit');
    // Anaya shows the booked → arrival → queue transition. Dev has no
    // appointment until the practice assistant books one during the demo.
    await appointment(7, firstDoctor, 0, '20:30', 'booked', 'Demo booked patient arriving today');
    const q0 = await queue(0, firstDoctor, a0, 0, 1, 'waiting');
    const q1 = await queue(1, firstDoctor, a1, 0, 2, 'called');
    const q2 = await queue(2, firstDoctor, a2, -1, 1, 'done');
    const q3 = await queue(3, firstDoctor, a3, -2, 1, 'done');
    await queue(6, secondDoctor, a6, 0, 3, 'waiting');

    for (const [patient, queueId, concern] of [
      [0, q0, 'First visit; wants to discuss a concern'],
      [1, q1, 'Would like clarification from the doctor'],
      [2, q2, 'Follow-up date discussed'],
    ] as [number, string, string][]) {
      await db.query(
        'INSERT INTO intake_summaries(clinic_id,patient_id,queue_entry_id,answers,summary) VALUES($1,$2,$3,$4,$5)',
        [clinic, patients[patient], queueId,
          json([{ question: 'What brings you in today?', answer: concern }, { question: 'Any known allergies?', answer: 'Not provided in this demo' }]),
          `DEMO intake: ${concern}. No medical finding has been recorded.`],
      );
    }

    const draftNote = (await db.query(
      `INSERT INTO visit_notes(clinic_id,patient_id,doctor_id,queue_entry_id,status,source,transcript,note,created_by)
       VALUES($1,$2,$3,$4,'draft','typed',$5,$6,$7) RETURNING id`,
      [clinic, patients[1], firstDoctor, q1, 'DEMO draft. Patient asks for clarification. Doctor has not signed.',
        json({ complaint: 'Patient asks for clarification.', history: '', examination: '', diagnosis: '', plan: '', follow_up: '' }), firstUser],
    )).rows[0].id as string;
    const signedNote = (await db.query(
      `INSERT INTO visit_notes(clinic_id,patient_id,doctor_id,queue_entry_id,status,source,transcript,note,created_by,signed_at,signed_by,created_at)
       VALUES($1,$2,$3,$4,'signed','typed',$5,$6,$7,$8,$7,$8) RETURNING id`,
      [clinic, patients[2], firstDoctor, q2, 'DEMO historical note: follow-up appointment discussed.',
        json({ complaint: 'Follow-up appointment discussion.', history: 'Patient-reported information only.',
          examination: '', diagnosis: '', plan: 'Confirm next appointment with clinic.', follow_up: 'Clinic will contact patient.' }),
        firstUser, at(-1, '10:30')],
    )).rows[0].id as string;
    await db.query(
      `INSERT INTO patient_instructions(clinic_id,patient_id,note_id,language,body,status,created_by,approved_by,approved_at)
       VALUES($1,$2,$3,'en',$4,'approved',$5,$5,$6),($1,$7,$8,'hi',$9,'draft',$5,NULL,NULL)`,
      [clinic, patients[2], signedNote, 'DEMO: Please contact the clinic to confirm your follow-up date.',
        firstUser, at(-1, '10:35'), patients[1], draftNote, 'डेमो मसौदा: अगली तारीख डॉक्टर से पुष्टि करें।'],
    );
    await db.query(
      `INSERT INTO issued_documents(clinic_id,patient_id,doctor_id,kind,subtype,status,content,created_by)
       VALUES($1,$2,$3,'prescription','prescription','draft',$4,$5),
             ($1,$2,$3,'certificate','attendance','draft',$6,$5)`,
      [clinic, patients[1], firstDoctor,
        json({ items: [], advice: 'DEMO draft only. Doctor must enter and check every item before signing.' }),
        firstUser, json({ purpose: 'Demo attendance certificate; doctor review required.' })],
    );

    const pdf = demoPdf('DEMO ONLY - fictional uploaded report; no clinical results.');
    const documentId = (await db.query(
      `INSERT INTO patient_documents(clinic_id,patient_id,uploaded_via,kind,filename,mime,size_bytes,data,caption,status)
       VALUES($1,$2,'staff','report',$3,'application/pdf',$4,$5,$6,'new') RETURNING id`,
      [clinic, patients[2], 'demo-report.pdf', pdf.length, pdf,
        'Fictional sample document with no test result.'],
    )).rows[0].id as string;
    await db.query(
      `INSERT INTO clinical_entries(clinic_id,patient_id,kind,data,document_id,recorded_by,occurred_on)
       VALUES($1,$2,'investigation',$3,$4,$5,$6)`,
      [clinic, patients[2], json({ name: 'Demo uploaded report', note: 'Awaiting doctor review; no clinical values.' }),
        documentId, firstUser, day(-1)],
    );
    for (const [patient, queueId, kind, title, status, due, docId, owner] of [
      [1, q1, 'report', 'Review requested report', 'requested', at(1, '12:00'), null, firstUser],
      [2, q2, 'report', 'Review uploaded demo report', 'received', at(-1, '17:00'), documentId, firstUser],
      [3, q3, 'followup', 'Confirm next visit date with patient', 'reviewed', at(1, '11:00'), null, desk],
    ] as [number, string, string, string, string, string, string | null, string][]) {
      await db.query(
        `INSERT INTO care_tasks(clinic_id,patient_id,queue_entry_id,kind,title,status,assigned_to,due_at,document_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [clinic, patients[patient], queueId, kind, title, status, owner, due, docId, firstUser],
      );
    }
    const plan = (await db.query(
      `INSERT INTO care_plans(clinic_id,patient_id,title,status,assigned_to,created_by,approved_at)
       VALUES($1,$2,$3,'active',$4,$4,$5) RETURNING id`,
      [clinic, patients[2], 'Confirm follow-up appointment', firstUser, at(-1, '10:35')],
    )).rows[0].id as string;
    await db.query(
      `INSERT INTO care_plan_steps(clinic_id,plan_id,patient_id,title,message,due_at,status)
       VALUES($1,$2,$3,$4,$5,$6,'pending')`,
      [clinic, plan, patients[2], 'Confirm appointment',
        'Please contact the clinic to confirm your follow-up appointment.', at(2, '11:00')],
    );
    await db.query(
      `INSERT INTO insurance_cases(clinic_id,patient_id,title,status,assigned_to,due_at,document_id)
       VALUES($1,$2,$3,'preparing',$4,$5,$6)`,
      [clinic, patients[2], 'Demo document request', desk, at(3, '16:00'), documentId],
    );

    const paid = (await db.query(
      `INSERT INTO clinic_charges(clinic_id,patient_id,description,amount_paise,created_by,is_test)
       VALUES($1,$2,'Demo consultation fee',50000,$3,true) RETURNING id`,
      [clinic, patients[0], desk],
    )).rows[0].id as string;
    const openCharge = (await db.query(
      `INSERT INTO clinic_charges(clinic_id,patient_id,description,amount_paise,created_by,is_test)
       VALUES($1,$2,'Demo consultation fee',50000,$3,true) RETURNING id`,
      [clinic, patients[1], desk],
    )).rows[0].id as string;
    await db.query(
      `INSERT INTO clinic_payments(clinic_id,charge_id,request_id,amount_paise,method,recorded_by,is_test)
       VALUES($1,$2,$3,50000,'cash',$4,true)`,
      [clinic, paid, randomUUID(), desk],
    );
    await db.query(
      `INSERT INTO qr_arrivals(clinic_id,patient_id,doctor_id,arrival_date,access_hash,amount_paise,status,queue_entry_id,charge_id,confirmed_by,confirmed_at,expires_at)
       VALUES($1,$2,$3,$4,$5,50000,'queued',$6,$7,$8,now(),now()+interval '12 hours'),
             ($1,$9,$3,$4,$10,50000,'awaiting_payment',NULL,$11,NULL,NULL,now()+interval '12 hours')`,
      [clinic, patients[0], firstDoctor, day(0), randomBytes(32).toString('hex'), q0, paid, desk,
        patients[1], randomBytes(32).toString('hex'), openCharge],
    );

    const waitlist = (await db.query(
      `INSERT INTO appointment_waitlist(clinic_id,patient_id,doctor_id,from_date,to_date,created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [clinic, patients[3], firstDoctor, day(1), day(7), desk],
    )).rows[0].id as string;
    await db.query(
      `INSERT INTO slot_offers(clinic_id,waitlist_id,doctor_id,patient_id,starts_at,expires_at,code)
       VALUES($1,$2,$3,$4,$5,now()+interval '24 hours',$6)`,
      [clinic, waitlist, firstDoctor, patients[3], at(1, '11:30'), `DEMO${randomBytes(3).toString('hex').toUpperCase()}`],
    );
    await db.query(
      'INSERT INTO doctor_leave(clinic_id,doctor_id,starts_on,ends_on,note) VALUES($1,$2,$3,$3,$4)',
      [clinic, secondDoctor, day(8), 'Demo planned day away'],
    );

    const conversation = async (patient: number, channel: string, human: boolean) =>
      (await db.query(
        `INSERT INTO conversations(clinic_id,patient_id,doctor_id,channel,contact,language,handled_by,human_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [clinic, patients[patient], firstDoctor, channel,
          `+9100000000${String(patient + 1).padStart(2, '0')}`, patientData[patient][1],
          human ? 'human' : 'agent', human ? desk : null],
      )).rows[0].id as string;
    const humanConversation = await conversation(5, 'whatsapp', true);
    await db.query(
      `INSERT INTO messages(clinic_id,conversation_id,direction,sender,body,created_at)
       VALUES($1,$2,'in','patient',$3,$4),($1,$2,'out','agent:frontdesk',$5,$6)`,
      [clinic, humanConversation, 'DEMO: I would like a person to call me about my appointment.', at(0, '09:05'),
        'DEMO: Your request has been passed to the clinic team.', at(0, '09:06')],
    );
    await db.query(
      `INSERT INTO flags(clinic_id,conversation_id,patient_id,kind,severity,summary)
       VALUES($1,$2,$3,'human_requested','normal',$4)`,
      [clinic, humanConversation, patients[5], 'DEMO: patient requested a human callback.'],
    );
    const urgentConversation = await conversation(4, 'web', false);
    await db.query(
      `INSERT INTO messages(clinic_id,conversation_id,direction,sender,body)
       VALUES($1,$2,'in','patient',$3)`,
      [clinic, urgentConversation, 'DEMO safety example: I have chest pain.'],
    );
    await db.query(
      `INSERT INTO flags(clinic_id,conversation_id,patient_id,kind,severity,summary)
       VALUES($1,$2,$3,'red_flag','urgent',$4)`,
      [clinic, urgentConversation, patients[4], 'DEMO ONLY: urgent symptom phrase needs immediate human review.'],
    );

    const checkin = async (patient: number, queueId: string, offset: number, work: string, category: string, assigned: string) =>
      (await db.query(
        `INSERT INTO patient_checkins(clinic_id,patient_id,queue_entry_id,assigned_to,scheduled_at,language,created_by,
           work_status,category,response_due_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [clinic, patients[patient], queueId, assigned, at(offset, '18:00'), patientData[patient][1],
          firstUser, work, category, at(offset + 1, '18:00')],
      )).rows[0].id as string;
    const feedbackOpen = await checkin(2, q2, -1, 'new', 'service', firstUser);
    const feedbackClosed = await checkin(3, q3, -2, 'closed', 'review', desk);
    // Ravi's active visit intentionally has no check-in yet. Finishing it creates
    // the next feedback case in front of the audience.
    await db.query(
      `INSERT INTO patient_feedback_responses(clinic_id,checkin_id,recovery,help,theme,message,created_at)
       VALUES($1,$2,'same','visit','waiting',$3,$4),
             ($1,$5,'better','none','none',$6,$7)`,
      [clinic, feedbackOpen, 'DEMO feedback: I waited longer than expected and would appreciate an update next time.',
        at(0, '09:15'), feedbackClosed,
        'DEMO feedback: The follow-up date was explained clearly.', at(-1, '12:00')],
    );
    await db.query(
      `INSERT INTO patient_feedback_events(clinic_id,checkin_id,actor_id,kind,note)
       VALUES($1,$2,NULL,'patient_response',$3),($1,$4,$5,'close',$6)`,
      [clinic, feedbackOpen, 'Fictional patient feedback for the demo.', feedbackClosed, desk,
        'DEMO: receptionist confirmed the follow-up date with the patient.'],
    );
    await db.query(
      `INSERT INTO patient_feedback_improvements(clinic_id,source_checkin_id,title,assigned_to,due_at)
       VALUES($1,$2,$3,$4,$5)`,
      [clinic, feedbackOpen, 'Explain waiting times at check-in', desk, at(5, '17:00')],
    );
    await db.query(
      `INSERT INTO visit_feedback(clinic_id,patient_id,doctor_id,queue_entry_id,rating,comment)
       VALUES($1,$2,$3,$4,3,$5),($1,$6,$3,$7,5,$8)`,
      [clinic, patients[2], firstDoctor, q2, 'DEMO: waiting time could be clearer.',
        patients[3], q3, 'DEMO: the follow-up date was clear.'],
    );
    // No delivery receipt is fabricated: these fictional responses are for a manual-link walkthrough.
    // The clinic has no live WhatsApp, phone, payment, or external-software connection.
    await db.query('COMMIT');
    console.log(`${config.slug}: created ${patientData.length} fictional patients and linked demo workflows.`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function seedShowcase(adminUrl = process.env.ADMIN_DATABASE_URL, reset = false) {
  if (!adminUrl) throw new Error('ADMIN_DATABASE_URL is required');
  const url = new URL(adminUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
    throw new Error('The showcase seed only runs against a local database.');
  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  try {
    if (reset) {
      await db.query('BEGIN');
      try {
        for (const clinic of CLINICS) {
          const found = await db.query('SELECT id,name FROM clinics WHERE slug=$1', [clinic.slug]);
          if (found.rowCount && found.rows[0].name !== clinic.name)
            throw new Error(`Refusing to reset ${clinic.slug}: clinic name does not match the demo.`);
          if (found.rowCount)
            await db.query('DELETE FROM clinics WHERE id=$1', [found.rows[0].id]);
        }
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
    const passwordHash = await hashPassword(PASSWORD);
    for (const clinic of CLINICS) await seedClinic(db, clinic, passwordHash);
    console.log('Local showcase password: demo1234. No real message or payment was sent.');
  } finally {
    await db.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await seedShowcase(process.env.ADMIN_DATABASE_URL, process.argv.includes('--reset'));
