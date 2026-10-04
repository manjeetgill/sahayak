import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify `X-Sahayak-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>` with a replay window. */
export function verifySignature(
  secret: string,
  body: string,
  header: string | undefined,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const m = (header ?? '').match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m || Math.abs(nowSec - Number(m[1])) > toleranceSec) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(`${m[1]}.${body}`).digest('hex'));
  return timingSafeEqual(want, Buffer.from(m[2]));
}
