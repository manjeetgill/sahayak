import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withClinic, type Db } from '@sahayak/db';
import { ToolError, type ToolContext } from '@sahayak/core';
import type { AppDeps } from './app';
import {
  GoogleKind,
  scopes,
  digest,
  encrypt,
  decrypt,
  signState,
  readState,
  tokenRequest,
  accessToken,
  googleApi,
  type GoogleOptions,
} from './google-provider';
import { syncGoogleConnection } from './google-sync';
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const kindParam = (req: FastifyRequest) => z.object({ kind: GoogleKind }).parse(req.params).kind;
const connectionFields =
  'id,kind,target_id,target_name,setup_state,enabled,last_error,last_synced_at,created_at';
export async function installGoogleConnections(
  app: FastifyInstance,
  deps: AppDeps,
  staffContext: (
    req: FastifyRequest,
    roles?: ('admin' | 'doctor' | 'receptionist')[],
  ) => Promise<ToolContext>,
) {
  const auth = (req: FastifyRequest) => staffContext(req, ['admin']);
  const options = () => {
    if (!deps.google)
      throw new ToolError(
        'google_setup',
        'Your setup team must add the Google connection settings first.',
        409,
      );
    return deps.google;
  };
  const actor = (ctx: ToolContext) => (ctx.actor.kind === 'staff' ? ctx.actor.userId : '');
  const audit = (db: Db, ctx: ToolContext, action: string, kind: string) =>
    db.query(
      "INSERT INTO agent_actions(clinic_id,agent,kind,tool,input,ok) VALUES($1,$2,'tool_call',$3,$4,true)",
      [ctx.clinicId, 'staff:' + actor(ctx), action, JSON.stringify({ kind })],
    );
  app.get('/staff/integrations/google', async (req) => {
    const ctx = await auth(req);
    return withClinic(deps.pool, ctx.clinicId, async (db) => {
      const connections = (
        await db.query(`SELECT ${connectionFields} FROM google_connections ORDER BY kind`)
      ).rows;
      for (const c of connections) {
        c.counts = (
          await db.query(
            "SELECT count(*) FILTER(WHERE status='pending')::int pending,count(*) FILTER(WHERE status='failed')::int failed,count(*) FILTER(WHERE status='synced')::int synced FROM google_sync_items WHERE connection_id=$1",
            [c.id],
          )
        ).rows[0];
        c.recent = (
          await db.query(
            'SELECT appointment_id,status,attempts,last_error,synced_at FROM google_sync_items WHERE connection_id=$1 ORDER BY updated_at DESC LIMIT 5',
            [c.id],
          )
        ).rows;
      }
      return { configured: !!deps.google, connections };
    });
  });
  app.post('/staff/integrations/google/:kind/start', async (req) => {
    const ctx = await auth(req),
      kind = kindParam(req),
      o = options();
    const nonce = randomBytes(32).toString('hex'),
      proof = randomBytes(32).toString('hex'),
      verifier = randomBytes(32).toString('base64url');
    const state = signState(o, { clinicId: ctx.clinicId, kind, nonce });
    await withClinic(deps.pool, ctx.clinicId, async (db) => {
      await db.query('DELETE FROM google_oauth_requests WHERE kind=$1 OR expires_at<now()', [kind]);
      await db.query(
        'INSERT INTO google_oauth_requests(clinic_id,nonce,kind,user_id,proof_hash,verifier) VALUES($1,$2,$3,$4,$5,$6)',
        [
          ctx.clinicId,
          nonce,
          kind,
          actor(ctx),
          digest(proof),
          encrypt(o, verifier, ctx.clinicId + ':oauth:' + nonce),
        ],
      );
      await audit(db, ctx, 'google_connection_start', kind);
    });
    const query = new URLSearchParams({
      client_id: o.clientId,
      redirect_uri: o.redirectUri,
      response_type: 'code',
      scope: scopes[kind],
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + query, state, proof };
  });
  app.get('/integrations/google/callback', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const o = options(),
      q = z
        .object({
          state: z.string().max(2000),
          code: z.string().max(4000).optional(),
          error: z.string().max(200).optional(),
        })
        .parse(req.query),
      s = readState(o, q.state);
    const pending = await withClinic(
      deps.pool,
      s.clinicId,
      async (db) =>
        (
          await db.query(
            `UPDATE google_oauth_requests SET consumed=true WHERE nonce=$1 AND kind=$2 AND expires_at>now() AND NOT consumed
    AND EXISTS(SELECT 1 FROM staff_users WHERE id=google_oauth_requests.user_id AND role='admin') RETURNING *`,
            [s.nonce, s.kind],
          )
        ).rows[0],
    );
    if (!pending)
      throw new ToolError(
        'google_state',
        'This connection link expired or was already used. Start again.',
        400,
      );
    if (q.error || !q.code)
      return reply.redirect(o.webUrl + '/admin/integrations?google=cancelled');
    try {
      const token = await tokenRequest(o, {
        grant_type: 'authorization_code',
        code: q.code,
        redirect_uri: o.redirectUri,
        code_verifier: decrypt(o, pending.verifier, s.clinicId + ':oauth:' + s.nonce),
      });
      if (!token.refresh_token || !token.scope?.split(' ').includes(scopes[s.kind]))
        throw Error('Missing offline access');
      const encryptedToken = encrypt(o, token.refresh_token, s.clinicId + ':' + s.kind);
      await withClinic(deps.pool, s.clinicId, (db) =>
        db.query(
          'UPDATE google_oauth_requests SET pending_token=$2,verifier=$3 WHERE nonce=$1 AND expires_at>now()',
          [s.nonce, encryptedToken, ''],
        ),
      );
      return reply.redirect(
        o.webUrl + '/admin/integrations?google=complete&state=' + encodeURIComponent(q.state),
      );
    } catch {
      return reply.redirect(o.webUrl + '/admin/integrations?google=failed');
    }
  });
  app.post('/staff/integrations/google/complete', async (req) => {
    const ctx = await auth(req),
      o = options(),
      i = z.object({ state: z.string().max(2000), proof: hex }).parse(req.body),
      s = readState(o, i.state);
    if (s.clinicId !== ctx.clinicId)
      throw new ToolError('forbidden', 'Sign in to the clinic that started this connection.', 403);
    return withClinic(deps.pool, ctx.clinicId, async (db) => {
      const p = (
        await db.query(
          'SELECT * FROM google_oauth_requests WHERE nonce=$1 AND user_id=$2 AND proof_hash=$3 AND expires_at>now() AND consumed AND pending_token IS NOT NULL FOR UPDATE',
          [s.nonce, actor(ctx), digest(i.proof)],
        )
      ).rows[0];
      if (!p)
        throw new ToolError(
          'google_state',
          'Complete the connection in the browser and Admin account that started it.',
          403,
        );
      const old = (
        await db.query('SELECT * FROM google_connections WHERE kind=$1 FOR UPDATE', [s.kind])
      ).rows[0];
      if (old?.target_id) {
        const token = await accessToken(o, ctx.clinicId, s.kind, p.pending_token);
        await verifyTarget(o, token, s.kind, old.target_id);
      }
      await db.query(
        `INSERT INTO google_connections(clinic_id,kind,refresh_token) VALUES($1,$2,$3) ON CONFLICT(clinic_id,kind) DO UPDATE SET refresh_token=$3,last_error=NULL`,
        [ctx.clinicId, s.kind, p.pending_token],
      );
      await db.query('DELETE FROM google_oauth_requests WHERE nonce=$1', [s.nonce]);
      await audit(db, ctx, 'google_connection_authorized', s.kind);
      return { ok: true };
    });
  });
  app.post('/staff/integrations/google/:kind/prepare', async (req) => {
    const ctx = await auth(req),
      kind = kindParam(req),
      o = options();
    const i = z.object({ acceptsExport: z.literal(true) }).parse(req.body);
    void i;
    const c = await withClinic(deps.pool, ctx.clinicId, async (db) => {
      const row = (
        await db.query(
          "UPDATE google_connections SET setup_state='creating' WHERE kind=$1 AND target_id IS NULL AND setup_state='ready' RETURNING *",
          [kind],
        )
      ).rows[0];
      if (!row)
        throw new ToolError(
          'google_setup',
          'Destination is already prepared, in progress, or needs review. Refresh its status.',
          409,
        );
      await audit(db, ctx, 'google_destination_prepare', kind);
      return row;
    });
    let target: string | undefined;
    try {
      const token = await accessToken(o, ctx.clinicId, kind, c.refresh_token);
      const name = 'Sahayak appointments ' + ctx.clinicId.slice(0, 8);
      const result =
        kind === 'calendar'
          ? await googleApi(o, token, 'www.googleapis.com/calendar/v3/calendars', 'POST', {
              summary: name,
              timeZone: 'UTC',
              description:
                'Managed by Sahayak. Appointment references only; no patient names or medical notes.',
            })
          : await googleApi(o, token, 'sheets.googleapis.com/v4/spreadsheets', 'POST', {
              properties: { title: name },
              sheets: [
                {
                  properties: {
                    title: 'Appointments',
                    gridProperties: { rowCount: 10000, columnCount: 5, frozenRowCount: 1 },
                  },
                },
              ],
            });
      target = z
        .string()
        .min(1)
        .max(300)
        .parse(kind === 'calendar' ? result.id : result.spreadsheetId);
      // Save the provider id before subsequent writes. A lost response never creates a second destination.
      const saved = await withClinic(deps.pool, ctx.clinicId, (db) =>
        db.query(
          "UPDATE google_connections SET target_id=$2,target_name=$3,setup_state='ready',last_error=NULL WHERE id=$1",
          [c.id, target, name],
        ),
      );
      if (!saved.rowCount)
        throw new ToolError(
          'google_disconnected',
          'This connection was disconnected during setup. Check Google for the destination that may have been created.',
          409,
        );
      if (kind === 'sheets') await writeHeader(o, token, target);
      return { ok: true };
    } catch {
      await withClinic(deps.pool, ctx.clinicId, (db) =>
        db.query('UPDATE google_connections SET setup_state=$2,last_error=$3 WHERE id=$1', [
          c.id,
          target ? 'ready' : 'unknown',
          target
            ? 'The sheet was created, but its headings need retrying. Use Check connection.'
            : 'The creation result is uncertain. Check your Google account before disconnecting and trying again; a destination may already exist.',
        ]),
      );
      throw new ToolError(
        'google_setup',
        'Google setup needs attention. Refresh the connection status for next steps.',
        409,
      );
    }
  });
  app.post('/staff/integrations/google/:kind/check', async (req) => {
    const ctx = await auth(req),
      kind = kindParam(req),
      o = options();
    return withClinic(deps.pool, ctx.clinicId, async (db) => {
      const c = await getConnection(db, kind);
      const token = await accessToken(o, ctx.clinicId, kind, c.refresh_token);
      await verifyTarget(o, token, kind, c.target_id);
      if (kind === 'sheets') await writeHeader(o, token, c.target_id);
      await db.query('UPDATE google_connections SET last_error=NULL WHERE id=$1', [c.id]);
      await audit(db, ctx, 'google_connection_check', kind);
      return { ok: true };
    });
  });
  app.put('/staff/integrations/google/:kind/settings', async (req) => {
    const ctx = await auth(req),
      kind = kindParam(req);
    options();
    const i = z
      .object({
        enabled: z.boolean(),
        acceptsExport: z.boolean().optional(),
        includeUpcoming: z.boolean().default(false),
      })
      .parse(req.body);
    if (i.enabled && !i.acceptsExport)
      throw new ToolError(
        'google_export',
        'Confirm the appointment information you want to share.',
        400,
      );
    return withClinic(deps.pool, ctx.clinicId, async (db) => {
      const c = await getConnection(db, kind);
      if (i.enabled) {
        const token = await accessToken(options(), ctx.clinicId, kind, c.refresh_token);
        await verifyTarget(options(), token, kind, c.target_id);
        if (kind === 'sheets') await writeHeader(options(), token, c.target_id);
      }
      await db.query('UPDATE google_connections SET enabled=$2,last_error=NULL WHERE id=$1', [
        c.id,
        i.enabled,
      ]);
      if (i.enabled && i.includeUpcoming)
        await db.query(
          "SELECT queue_google_appointment(clinic_id,id,doctor_id,starts_at,ends_at,status,$1) FROM appointments WHERE starts_at>=now() AND starts_at<now()+interval '90 days' AND status IN ('booked','checked_in')",
          [c.id],
        );
      await audit(db, ctx, i.enabled ? 'google_sync_enabled' : 'google_sync_paused', kind);
      return { ok: true };
    });
  });
  app.post('/staff/integrations/google/:kind/retry', async (req) => {
    const ctx = await auth(req),
      kind = kindParam(req),
      o = options();
    const id = await withClinic(deps.pool, ctx.clinicId, async (db) => {
      const c = await getConnection(db, kind);
      if (!c.enabled)
        throw new ToolError('google_paused', 'Turn on automatic updates before retrying.', 409);
      await db.query(
        "UPDATE google_sync_items SET status='pending',attempts=0,next_attempt_at=now() WHERE connection_id=$1 AND status<>'synced'",
        [c.id],
      );
      await audit(db, ctx, 'google_sync_retry', kind);
      return c.id;
    });
    return syncGoogleConnection(deps.pool, o, ctx.clinicId, id);
  });
  app.delete('/staff/integrations/google/:kind', async (req) => {
    const ctx = await auth(req),
      kind = kindParam(req);
    await withClinic(deps.pool, ctx.clinicId, async (db) => {
      await db.query('DELETE FROM google_oauth_requests WHERE kind=$1', [kind]);
      await db.query('DELETE FROM google_connections WHERE kind=$1', [kind]);
      await audit(db, ctx, 'google_connection_disconnected', kind);
    });
    return { ok: true };
  });
}
async function getConnection(db: Db, kind: GoogleKind) {
  const c = (await db.query('SELECT * FROM google_connections WHERE kind=$1 FOR UPDATE', [kind]))
    .rows[0];
  if (!c?.target_id)
    throw new ToolError(
      'google_setup',
      'Connect Google and create the clinic destination first.',
      409,
    );
  return c;
}
async function verifyTarget(o: GoogleOptions, token: string, kind: GoogleKind, id: string) {
  return googleApi(
    o,
    token,
    kind === 'calendar'
      ? 'www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(id)
      : 'sheets.googleapis.com/v4/spreadsheets/' +
          encodeURIComponent(id) +
          '?fields=spreadsheetId,sheets.properties',
  );
}
async function writeHeader(o: GoogleOptions, token: string, id: string) {
  return googleApi(
    o,
    token,
    `sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent("'Appointments'!A1:E1")}?valueInputOption=RAW`,
    'PUT',
    {
      values: [['Appointment reference', 'Doctor reference', 'Start (UTC)', 'End (UTC)', 'Status']],
    },
  );
}
