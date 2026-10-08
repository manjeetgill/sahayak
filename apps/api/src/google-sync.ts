import type pg from 'pg';
import { withClinic } from '@sahayak/db';
import { z } from 'zod';
import { GoogleError, accessToken, googleApi, type GoogleOptions } from './google-provider';
const Payload = z
  .object({
    appointmentId: z.string().uuid(),
    doctorId: z.string().uuid(),
    startsAt: z.string(),
    endsAt: z.string(),
    status: z.enum([
      'booked',
      'checked_in',
      'completed',
      'cancelled',
      'no_show',
      'needs_rebooking',
      'deleted',
    ]),
  })
  .strict();
export async function syncGoogleConnection(
  pool: pg.Pool,
  o: GoogleOptions,
  clinicId: string,
  id: string,
) {
  return withClinic(pool, clinicId, async (db) => {
    const c = (
      await db.query(
        'SELECT * FROM google_connections WHERE id=$1 AND enabled AND target_id IS NOT NULL FOR NO KEY UPDATE SKIP LOCKED',
        [id],
      )
    ).rows[0];
    if (!c) return { processed: 0 };
    const items = (
      await db.query(
        "SELECT * FROM google_sync_items WHERE connection_id=$1 AND status='pending' AND next_attempt_at<=now() ORDER BY updated_at LIMIT 5 FOR UPDATE SKIP LOCKED",
        [id],
      )
    ).rows;
    if (!items.length) return { processed: 0 };
    let token: string;
    try {
      token = await accessToken(o, clinicId, c.kind, c.refresh_token);
    } catch (e) {
      const transient = e instanceof GoogleError && [429, 500, 502, 503, 504].includes(e.status);
      await db.query('UPDATE google_connections SET enabled=$2,last_error=$3 WHERE id=$1', [
        id,
        transient,
        transient
          ? 'Google is temporarily unavailable. Updates will retry.'
          : 'Google sign-in needs attention. Reconnect this account.',
      ]);
      await db.query(
        "UPDATE google_sync_items SET next_attempt_at=now()+interval '1 minute' WHERE connection_id=$1 AND status='pending'",
        [id],
      );
      return { processed: 0 };
    }
    let processed = 0;
    for (const item of items) {
      try {
        const p = Payload.parse(item.payload),
          target = encodeURIComponent(c.target_id);
        if (c.kind === 'calendar') {
          const eventId = 'sh' + p.appointmentId.replace(/-/g, ''),
            base = `www.googleapis.com/calendar/v3/calendars/${target}/events`;
          if (['cancelled', 'deleted'].includes(p.status)) {
            try {
              await googleApi(o, token, base + '/' + eventId + '?sendUpdates=none', 'DELETE');
            } catch (e) {
              if (!(e instanceof GoogleError) || ![404, 410].includes(e.status)) throw e;
            }
          } else {
            const body = {
              id: eventId,
              summary: 'Clinic appointment · ' + p.appointmentId.slice(0, 8),
              description: `Appointment reference: ${p.appointmentId}\nDoctor reference: ${p.doctorId}\nStatus: ${p.status}\nManaged by Sahayak. Change appointments in Sahayak.`,
              start: { dateTime: new Date(p.startsAt).toISOString() },
              end: { dateTime: new Date(p.endsAt).toISOString() },
              visibility: 'private',
              reminders: { useDefault: false },
              extendedProperties: {
                private: { sahayakClinic: clinicId, sahayakAppointment: p.appointmentId },
              },
            };
            let existing: any;
            try {
              existing = await googleApi(o, token, base + '/' + eventId);
            } catch (e) {
              if (!(e instanceof GoogleError) || e.status !== 404) throw e;
            }
            if (!existing) {
              try {
                await googleApi(o, token, base + '?sendUpdates=none', 'POST', body);
              } catch (e) {
                if (!(e instanceof GoogleError) || e.status !== 409) throw e;
                existing = await googleApi(o, token, base + '/' + eventId);
              }
            }
            if (existing) {
              if (
                existing.extendedProperties?.private?.sahayakClinic !== clinicId ||
                existing.extendedProperties?.private?.sahayakAppointment !== p.appointmentId
              )
                throw new Error(
                  'The calendar entry was changed outside Sahayak. Ask your setup team to check it.',
                );
              const { id: _id, ...patch } = body;
              void _id;
              await googleApi(o, token, base + '/' + eventId + '?sendUpdates=none', 'PATCH', patch);
            }
          }
        } else {
          if (item.row_number > 10000)
            throw new Error(
              'This appointment sheet is full. Ask your setup team to archive it and start a new connection.',
            );
          const range = encodeURIComponent(
              `'Appointments'!A${item.row_number}:E${item.row_number}`,
            ),
            base = `sheets.googleapis.com/v4/spreadsheets/${target}/values/`;
          const current = await googleApi(o, token, base + range);
          if (current.values?.[0]?.[0] && current.values[0][0] !== p.appointmentId)
            throw new Error(
              'Rows were moved or edited in the appointment sheet. Restore their order before retrying.',
            );
          await googleApi(o, token, base + range + '?valueInputOption=RAW', 'PUT', {
            range: `'Appointments'!A${item.row_number}:E${item.row_number}`,
            majorDimension: 'ROWS',
            values: [
              [
                p.appointmentId,
                p.doctorId,
                new Date(p.startsAt).toISOString(),
                new Date(p.endsAt).toISOString(),
                p.status,
              ],
            ],
          });
        }
        await db.query(
          "UPDATE google_sync_items SET status='synced',attempts=attempts+1,last_error=NULL,synced_at=now() WHERE id=$1",
          [item.id],
        );
        await db.query(
          'UPDATE google_connections SET last_synced_at=now(),last_error=NULL WHERE id=$1',
          [id],
        );
        processed++;
      } catch (e) {
        const auth = e instanceof GoogleError && [401, 403].includes(e.status);
        const retry =
          e instanceof GoogleError &&
          [429, 500, 502, 503, 504].includes(e.status) &&
          item.attempts < 4;
        const message =
          e instanceof GoogleError
            ? e.message
            : e instanceof z.ZodError
              ? 'This appointment update could not be read. Ask your setup team to check it.'
              : (e as Error).message;
        await db.query(
          'UPDATE google_sync_items SET status=$2,attempts=attempts+1,last_error=$3,next_attempt_at=now()+make_interval(secs=>$4) WHERE id=$1',
          [item.id, retry ? 'pending' : 'failed', message, 30 * 2 ** item.attempts],
        );
        await db.query(
          'UPDATE google_connections SET last_error=$2,enabled=CASE WHEN $3 THEN false ELSE enabled END WHERE id=$1',
          [id, message, auth],
        );
        if (auth) break;
      }
    }
    return { processed };
  });
}
export async function runGoogleSync(pool: pg.Pool, o: GoogleOptions) {
  const due = (await pool.query('SELECT id,clinic_id FROM due_google_connections()')).rows;
  for (const c of due) await syncGoogleConnection(pool, o, c.clinic_id, c.id);
}
export function startGoogleSync(pool: pg.Pool, o: GoogleOptions, log: () => void) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runGoogleSync(pool, o);
    } catch {
      log();
    } finally {
      running = false;
    }
  }, 30000);
  timer.unref();
  return () => clearInterval(timer);
}
