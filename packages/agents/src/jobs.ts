import PgBoss from 'pg-boss';
import type pg from 'pg';
import { callTool, deliverWebhooks, type EventBus, type MessagingChannel } from '@sahayak/core';
import { withClinic } from '@sahayak/db';

type Deps = {
  channel?: MessagingChannel;
  adminUrl: string;
  pool: pg.Pool;
  bus: EventBus;
  log?: (msg: string, err?: unknown) => void;
};

/**
 * Background jobs on pg-boss: follow-up delivery, recall queueing and no-show housekeeping.
 * pg-boss keeps its own tables (schema "pgboss") and uses the admin connection for that.
 * Each job lists work with security-definer functions (ids only) and then acts inside each clinic's own scope.
 */
export async function deliverOutbox(
  pool: pg.Pool,
  channel: MessagingChannel,
  log: (m: string, e?: unknown) => void = () => {},
) {
  const due = (await pool.query('SELECT id, clinic_id FROM due_outbox(100)')).rows;
  let sent = 0;
  for (const d of due) {
    await withClinic(pool, d.clinic_id, async (db) => {
      const row = (
        await db.query(
          "SELECT * FROM outbox WHERE id=$1 AND status='pending' FOR UPDATE SKIP LOCKED",
          [d.id],
        )
      ).rows[0];
      if (!row) return;
      if (
        row.slot_offer_id &&
        !(
          await db.query(
            "SELECT 1 FROM slot_offers o JOIN appointment_waitlist w ON w.id=o.waitlist_id WHERE o.id=$1 AND o.status='pending' AND o.expires_at>now() AND extract(hour FROM now() AT TIME ZONE (SELECT timezone FROM clinics WHERE id=o.clinic_id)) BETWEEN 8 AND 20 AND w.status='waiting' AND EXISTS (SELECT 1 FROM consents WHERE patient_id=o.patient_id AND purpose='whatsapp_messaging' AND withdrawn_at IS NULL) AND EXISTS (SELECT 1 FROM consents WHERE patient_id=o.patient_id AND purpose='reminders_followups' AND withdrawn_at IS NULL)",
            [row.slot_offer_id],
          )
        ).rowCount
      ) {
        await db.query(
          "UPDATE outbox SET status='failed',last_error='Offer expired or consent withdrawn' WHERE id=$1",
          [row.id],
        );
        return;
      }
      try {
        await channel.send({
          clinicId: d.clinic_id,
          to: row.to_contact,
          text: row.body,
          lang: row.language,
        });
        await db.query("UPDATE outbox SET status='sent', attempts=attempts+1 WHERE id=$1", [d.id]);
        sent++;
      } catch (e) {
        const attempts = row.attempts + 1;
        const msg = String((e as Error).message).slice(0, 200);
        log('outbox send failed', e);
        if (attempts >= 5) {
          await db.query(
            "UPDATE outbox SET status='failed', attempts=$2, last_error=$3 WHERE id=$1",
            [d.id, attempts, msg],
          );
          await db.query(
            "INSERT INTO flags (clinic_id,kind,severity,summary) VALUES ($1,'system','urgent',$2)",
            [
              d.clinic_id,
              `A WhatsApp message to ${row.to_contact} could not be delivered after 5 tries. Please contact the patient another way.`,
            ],
          );
        } else {
          await db.query(
            'UPDATE outbox SET attempts=$2, last_error=$3, next_attempt_at=now() + make_interval(secs => $4) WHERE id=$1',
            [d.id, attempts, msg, 30 * 2 ** attempts],
          );
        }
      }
    });
  }
  return sent;
}

export async function startJobs({ adminUrl, pool, bus, channel, log = () => {} }: Deps) {
  const boss = new PgBoss({ connectionString: adminUrl, schema: 'pgboss' });
  boss.on('error', (e) => log('pg-boss error', e));
  await boss.start();
  const rt = { pool, bus };
  const system = (clinicId: string) => ({
    clinicId,
    actor: { kind: 'system' as const, name: 'jobs' },
  });

  const followups = async () => {
    const due = (await pool.query('SELECT id, clinic_id FROM due_followups(200)')).rows;
    for (const d of due) {
      try {
        await callTool(rt, system(d.clinic_id), 'run_followup', { followUpId: d.id });
      } catch (e) {
        log(`follow-up ${d.id} failed`, e);
        await withClinic(pool, d.clinic_id, (db) =>
          db.query("UPDATE follow_ups SET status='failed', detail=$2 WHERE id=$1", [
            d.id,
            String((e as Error).message).slice(0, 200),
          ]),
        ).catch(() => {});
      }
    }
    return due.length;
  };
  const eachClinic = async (tool: string, input: unknown) => {
    for (const c of (await pool.query('SELECT id FROM clinics_for_sweeps()')).rows) {
      try {
        await callTool(rt, system(c.id), tool, input);
      } catch (e) {
        log(`${tool} failed for clinic`, e);
      }
    }
  };

  for (const q of [
    'followups.sweep',
    'recall.sweep',
    'queue.sweep',
    'brief.sweep',
    'agents.sweep',
    'retention.sweep',
    'webhooks.sweep',
  ])
    await boss.createQueue(q);
  await boss.schedule('followups.sweep', '* * * * *');
  await boss.schedule('queue.sweep', '* * * * *');
  await boss.schedule('recall.sweep', '0 10 * * *');
  await boss.schedule('webhooks.sweep', '* * * * *');
  await boss.schedule('brief.sweep', '*/10 * * * *');
  await boss.schedule('agents.sweep', '* * * * *');
  await boss.schedule('retention.sweep', '30 21 * * *'); // 03:00 IST
  await boss.work('followups.sweep', async () => {
    await followups();
  });
  await boss.work('queue.sweep', async () => {
    await eachClinic('sweep_no_shows', {});
  });
  await boss.work('agents.sweep', async () => {
    await eachClinic('run_custom_agents', {});
  });
  await boss.work('brief.sweep', async () => {
    await eachClinic('send_daily_briefs', {});
  });
  await boss.work('webhooks.sweep', async () => {
    await deliverWebhooks(pool, log);
  });
  await boss.work('retention.sweep', async () => {
    await eachClinic('apply_retention', {});
  });
  await boss.work('recall.sweep', async () => {
    await eachClinic('queue_recalls', {});
  });
  // Real vendors: drain the outbox every few seconds in-process (cron granularity is one minute).
  let timer: NodeJS.Timeout | undefined;
  const hookTimer = setInterval(
    () => deliverWebhooks(pool, log).catch((e) => log('webhook sweep failed', e)),
    5000,
  );
  if (channel?.queued)
    timer = setInterval(
      () => deliverOutbox(pool, channel, log).catch((e) => log('outbox sweep failed', e)),
      5000,
    );
  return {
    boss,
    runFollowups: followups,
    stop: () => {
      clearInterval(timer);
      clearInterval(hookTimer);
      return boss.stop({ graceful: true, timeout: 5000 });
    },
  };
}
