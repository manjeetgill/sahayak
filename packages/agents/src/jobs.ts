import PgBoss from 'pg-boss';
import type pg from 'pg';
import { callTool, type EventBus } from '@sahayak/core';
import { withClinic } from '@sahayak/db';

type Deps = { adminUrl: string; pool: pg.Pool; bus: EventBus; log?: (msg: string, err?: unknown) => void };

/**
 * Background jobs on pg-boss: follow-up delivery, recall queueing and no-show housekeeping.
 * pg-boss keeps its own tables (schema "pgboss") and uses the admin connection for that.
 * Each job lists work with security-definer functions (ids only) and then acts inside each clinic's own scope.
 */
export async function startJobs({ adminUrl, pool, bus, log = () => {} }: Deps) {
  const boss = new PgBoss({ connectionString: adminUrl, schema: 'pgboss' });
  boss.on('error', (e) => log('pg-boss error', e));
  await boss.start();
  const rt = { pool, bus };
  const system = (clinicId: string) => ({ clinicId, actor: { kind: 'system' as const, name: 'jobs' } });

  const followups = async () => {
    const due = (await pool.query('SELECT id, clinic_id FROM due_followups(200)')).rows;
    for (const d of due) {
      try { await callTool(rt, system(d.clinic_id), 'run_followup', { followUpId: d.id }); }
      catch (e) {
        log(`follow-up ${d.id} failed`, e);
        await withClinic(pool, d.clinic_id, (db) => db.query("UPDATE follow_ups SET status='failed', detail=$2 WHERE id=$1", [d.id, String((e as Error).message).slice(0, 200)])).catch(() => {});
      }
    }
    return due.length;
  };
  const eachClinic = async (tool: string, input: unknown) => {
    for (const c of (await pool.query('SELECT id FROM clinics_for_sweeps()')).rows) {
      try { await callTool(rt, system(c.id), tool, input); } catch (e) { log(`${tool} failed for clinic`, e); }
    }
  };

  for (const q of ['followups.sweep', 'recall.sweep', 'queue.sweep']) await boss.createQueue(q);
  await boss.schedule('followups.sweep', '* * * * *');
  await boss.schedule('queue.sweep', '* * * * *');
  await boss.schedule('recall.sweep', '0 10 * * *');
  await boss.work('followups.sweep', async () => { await followups(); });
  await boss.work('queue.sweep', async () => { await eachClinic('sweep_no_shows', {}); });
  await boss.work('recall.sweep', async () => { await eachClinic('queue_recalls', {}); });
  return { boss, runFollowups: followups, stop: () => boss.stop({ graceful: true, timeout: 5000 }) };
}
