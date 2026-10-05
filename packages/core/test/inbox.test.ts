import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { addPatient, createTestClinic, dropTestClinic, makePool } from '@sahayak/db';
import { callTool, EventBus, registerAllTools, type ToolContext } from '../src';
const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
const rt = { pool, bus: new EventBus('') };
let clinic: Awaited<ReturnType<typeof createTestClinic>>, other: typeof clinic;
let ctx: ToolContext,
  patient: string,
  conversation: string,
  foreignConversation: string,
  document: string;
beforeAll(async () => {
  await admin.connect();
  registerAllTools();
  clinic = await createTestClinic(admin, 'inbox');
  other = await createTestClinic(admin, 'inbox-other');
  const user = (
    await admin.query(
      "INSERT INTO staff_users(clinic_id,email,password_hash,name,role,doctor_id) VALUES ($1,$2,'unused','Inbox doctor','doctor',$3) RETURNING id",
      [clinic.clinicId, `${clinic.slug}@test.invalid`, clinic.doctorIds[0]],
    )
  ).rows[0].id;
  ctx = {
    clinicId: clinic.clinicId,
    actor: { kind: 'staff', role: 'doctor', userId: user, doctorId: clinic.doctorIds[0] },
  };
  patient = await addPatient(admin, clinic.clinicId, 'Synthetic Inbox Patient', '+199900088111');
  conversation = (
    await admin.query(
      "INSERT INTO conversations(clinic_id,patient_id,contact,handled_by) VALUES ($1,$2,'+199900088111','human') RETURNING id",
      [clinic.clinicId, patient],
    )
  ).rows[0].id;
  foreignConversation = (
    await admin.query(
      "INSERT INTO conversations(clinic_id,contact) VALUES ($1,'+199900088112') RETURNING id",
      [other.clinicId],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO messages(clinic_id,conversation_id,direction,sender,body) VALUES ($1,$2,'in','patient','private source text')",
    [clinic.clinicId, conversation],
  );
  for (const severity of ['normal', 'urgent'])
    await admin.query(
      "INSERT INTO flags(clinic_id,conversation_id,patient_id,kind,severity,summary) VALUES ($1,$2,$3,'other',$4,'private concern')",
      [clinic.clinicId, conversation, patient, severity],
    );
  await admin.query(
    "INSERT INTO care_tasks(clinic_id,patient_id,kind,title,due_at,assigned_to) VALUES ($1,$2,'referral','Private overdue referral',now()-interval '1 day',$3)",
    [clinic.clinicId, patient, user],
  );
  document = (
    await admin.query(
      "INSERT INTO patient_documents(clinic_id,patient_id,uploaded_via,filename,mime,size_bytes,data) VALUES ($1,$2,'staff','report.pdf','application/pdf',1,'x') RETURNING id",
      [clinic.clinicId, patient],
    )
  ).rows[0].id;
  for (const doctor of clinic.doctorIds)
    await admin.query(
      "INSERT INTO visit_notes(clinic_id,patient_id,doctor_id,transcript) VALUES ($1,$2,$3,'private dictation')",
      [clinic.clinicId, patient, doctor],
    );
});
afterAll(async () => {
  if (clinic) await dropTestClinic(admin, clinic.clinicId);
  if (other) await dropTestClinic(admin, other.clinicId);
  await admin.end();
  await pool.end();
});
it('groups alerts, prioritises urgent and overdue work, and shows only own drafts', async () => {
  const result: any = await callTool(rt, ctx, 'get_doctor_inbox', {});
  expect(result.urgent).toBe(1);
  expect(result.overdue).toBe(1);
  expect(result.items[0].kind).toBe('alert');
  expect(result.items[0].alerts).toHaveLength(2);
  expect(result.items[1].kind).toBe('task');
  expect(result.items.filter((i: any) => i.kind === 'conversation')).toHaveLength(0);
  expect(result.items.filter((i: any) => i.kind === 'draft')).toHaveLength(1);
  expect(result.items.some((i: any) => i.conversation_id === foreignConversation)).toBe(false);
});
it('requires a doctor and isolates conversation sources', async () => {
  await expect(
    callTool(
      rt,
      { ...ctx, actor: { kind: 'staff', role: 'receptionist', userId: (ctx.actor as any).userId } },
      'get_doctor_inbox',
      {},
    ),
  ).rejects.toThrow();
  await expect(
    callTool(rt, ctx, 'get_inbox_conversation', { conversationId: foreignConversation }),
  ).rejects.toThrow('Conversation not found');
  const source: any = await callTool(rt, ctx, 'get_inbox_conversation', {
    conversationId: conversation,
  });
  expect(source.messages[0].body).toBe('private source text');
  const logs = await admin.query(
    "SELECT input,output FROM agent_actions WHERE clinic_id=$1 AND tool IN ('get_doctor_inbox','get_inbox_conversation')",
    [clinic.clinicId],
  );
  expect(JSON.stringify(logs.rows)).not.toContain('private source text');
  expect(JSON.stringify(logs.rows)).not.toContain('private concern');
});
it('removes a reviewed report on refresh and removes resolved alerts', async () => {
  await admin.query("UPDATE patient_documents SET status='reviewed' WHERE id=$1", [document]);
  await admin.query("UPDATE flags SET status='resolved' WHERE conversation_id=$1", [conversation]);
  const result: any = await callTool(rt, ctx, 'get_doctor_inbox', {});
  expect(result.urgent).toBe(0);
  expect(result.items.some((i: any) => i.key === `report:${document}`)).toBe(false);
  expect(result.items.filter((i: any) => i.kind === 'conversation')).toHaveLength(1);
});
