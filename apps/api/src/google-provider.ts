import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import { ToolError } from '@sahayak/core';
export const GoogleKind = z.enum(['calendar', 'sheets']);
export type GoogleKind = z.infer<typeof GoogleKind>;
export const scopes = {
  calendar: 'https://www.googleapis.com/auth/calendar.app.created',
  sheets: 'https://www.googleapis.com/auth/drive.file',
};
export type GoogleOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webUrl: string;
  encryptionKey: string;
  fetchImpl?: typeof fetch;
};
export function googleFromEnv(env = process.env): GoogleOptions | undefined {
  try {
    const clientId = z.string().min(5).parse(env.GOOGLE_CLIENT_ID),
      clientSecret = z.string().min(5).parse(env.GOOGLE_CLIENT_SECRET);
    const encryptionKey = z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .parse(env.GOOGLE_CONNECTION_ENCRYPTION_KEY);
    const redirect = new URL(env.GOOGLE_REDIRECT_URI ?? ''),
      web = new URL(env.GOOGLE_APP_WEB_URL ?? '');
    for (const u of [redirect, web])
      if (
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        (u.protocol !== 'https:' &&
          !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
      )
        return undefined;
    if (redirect.pathname !== '/integrations/google/callback' || web.pathname !== '/')
      return undefined;
    return {
      clientId,
      clientSecret,
      encryptionKey,
      redirectUri: redirect.href,
      webUrl: web.origin,
    };
  } catch {
    return undefined;
  }
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function encrypt(options: GoogleOptions, value: string, aad: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(options.encryptionKey, 'hex'), iv);
  cipher.setAAD(Buffer.from(aad));
  return [
    iv.toString('hex'),
    Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex'),
    cipher.getAuthTag().toString('hex'),
  ].join('.');
}
export function decrypt(options: GoogleOptions, value: string, aad: string) {
  try {
    const [iv, body, tag] = value.split('.');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(options.encryptionKey, 'hex'),
      Buffer.from(iv, 'hex'),
    );
    cipher.setAAD(Buffer.from(aad));
    cipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([cipher.update(Buffer.from(body, 'hex')), cipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new ToolError(
      'google_key',
      'Connection credentials cannot be opened. Ask your setup team to check the encryption key.',
      409,
    );
  }
}
const State = z.object({
  clinicId: z.string().uuid(),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  kind: GoogleKind,
});
export function signState(o: GoogleOptions, state: z.infer<typeof State>) {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  return (
    body +
    '.' +
    createHmac('sha256', Buffer.from(o.encryptionKey, 'hex')).update(body).digest('hex')
  );
}
export function readState(o: GoogleOptions, raw: string) {
  try {
    const [body, sig] = raw.split('.');
    if (!/^[a-f0-9]{64}$/.test(sig ?? '')) throw Error();
    const expected = createHmac('sha256', Buffer.from(o.encryptionKey, 'hex'))
      .update(body)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) throw Error();
    return State.parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
  } catch {
    throw new ToolError(
      'google_state',
      'This connection link is invalid or expired. Start again from Sahayak.',
      400,
    );
  }
}
export class GoogleError extends ToolError {
  constructor(status: number) {
    super(
      'google_service',
      status === 401 || status === 403
        ? 'Google access needs attention. Reconnect or ask your setup team to check permissions.'
        : status === 429
          ? 'Google is busy. Sahayak will retry shortly.'
          : 'Google could not complete this update. Try again later.',
      status,
    );
  }
}
export async function googleJson(o: GoogleOptions, url: string, init: RequestInit = {}) {
  let r: Response;
  try {
    r = await (o.fetchImpl ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new GoogleError(503);
  }
  if (!r.ok) throw new GoogleError(r.status);
  if (r.status === 204) return {};
  try {
    return await r.json();
  } catch {
    throw new GoogleError(502);
  }
}
export async function tokenRequest(o: GoogleOptions, values: Record<string, string>) {
  const j = await googleJson(o, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: o.clientId,
      client_secret: o.clientSecret,
      ...values,
    }).toString(),
  });
  return z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().min(1).optional(),
      scope: z.string().optional(),
      token_type: z.string().optional(),
    })
    .parse(j);
}
export async function accessToken(
  o: GoogleOptions,
  clinic: string,
  kind: GoogleKind,
  encrypted: string,
) {
  return (
    await tokenRequest(o, {
      grant_type: 'refresh_token',
      refresh_token: decrypt(o, encrypted, clinic + ':' + kind),
    })
  ).access_token;
}
export const googleApi = (
  o: GoogleOptions,
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
) =>
  googleJson(o, 'https://' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
