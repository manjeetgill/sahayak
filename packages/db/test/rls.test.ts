import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { makePool, withClinic } from '../src/client';
import { migrate } from '../src/migrate';

const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
const pool = makePool();
let a: string, b: string, patientA: string;

beforeAll(async () => {
  await migrate();
  await admin.connect();
  const mk = async (slug: string) => (await admin.query("INSERT INTO clinics (slug,name) VALUES ($1,$1) RETURNING id", [slug + Date.now()])).rows[0].id as string;
  a = await mk('rls-a'); b = await mk('rls-b');
  patientA = (await admin.query("INSERT INTO patients (clinic_id,name,phone) VALUES ($1,'Secret Patient','+919000000001') RETURNING id", [a])).rows[0].id;
  await admin.query("INSERT INTO patients (clinic_id,name,phone) VALUES ($1,'B Patient','+919000000002')", [b]);
});
afterAll(async () => {
  await admin.query('DELETE FROM clinics WHERE id = ANY($1)', [[a, b]]);
  await admin.end(); await pool.end();
});

describe('clinic data separation (row-level security)', () => {
  it('clinic B cannot read clinic A patients', async () => {
    const rows = await withClinic(pool, b, async (db) => (await db.query('SELECT name FROM patients')).rows);
    expect(rows.map((r) => r.name)).toEqual(['B Patient']);
  });
  it('clinic B cannot read clinic A patient by id', async () => {
    const r = await withClinic(pool, b, (db) => db.query('SELECT 1 FROM patients WHERE id=$1', [patientA]));
    expect(r.rowCount).toBe(0);
  });
  it('clinic B cannot insert rows for clinic A', async () => {
    await expect(withClinic(pool, b, (db) =>
      db.query("INSERT INTO patients (clinic_id,name,phone) VALUES ($1,'x','+919000000009')", [a]))).rejects.toThrow(/row-level security/);
  });
  it('clinic B cannot update or delete clinic A rows', async () => {
    const u = await withClinic(pool, b, (db) => db.query("UPDATE patients SET name='hacked' WHERE id=$1", [patientA]));
    const d = await withClinic(pool, b, (db) => db.query('DELETE FROM patients WHERE id=$1', [patientA]));
    expect([u.rowCount, d.rowCount]).toEqual([0, 0]);
  });
  it('no clinic context means no rows at all (fails closed)', async () => {
    const c = await pool.connect();
    try { expect((await c.query('SELECT 1 FROM patients')).rowCount).toBe(0); } finally { c.release(); }
  });
  it('every tenant table has RLS enabled and forced', async () => {
    const { rows } = await admin.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='clinic_id' AND NOT a.attisdropped
      JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
      WHERE c.relkind='r' AND c.relname NOT IN ('clinics')`);
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });
  it('audit log is append-only for the app role', async () => {
    await withClinic(pool, a, (db) => db.query("INSERT INTO agent_actions (clinic_id,agent,kind) VALUES ($1,'system','decision')", [a]));
    await expect(withClinic(pool, a, (db) => db.query('UPDATE agent_actions SET agent=$1', ['x']))).rejects.toThrow(/permission denied/);
    await expect(withClinic(pool, a, (db) => db.query('DELETE FROM agent_actions'))).rejects.toThrow(/permission denied/);
  });
});
