import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from '@sahayak/core';
const credentials = z.record(
  z.string().uuid(),
  z.object({
    keyId: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/),
    keySecret: z.string().min(10),
    webhookSecret: z.string().min(16),
  }),
);
export interface RazorpayOptions {
  clinics: z.infer<typeof credentials>;
  fetchImpl?: typeof fetch;
}
export function razorpayFromEnv(env = process.env): RazorpayOptions | undefined {
  if (!env.RAZORPAY_CLINIC_CREDENTIALS) return undefined;
  // Fail closed on malformed credentials so live payments cannot silently use another account.
  return { clinics: credentials.parse(JSON.parse(env.RAZORPAY_CLINIC_CREDENTIALS)) };
}
export function verifyPaymentSignature(body: string, signature: string, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    createHmac('sha256', secret).update(body).digest(),
  );
}
export async function razorpayRequest(
  options: RazorpayOptions,
  clinicId: string,
  path: string,
  body?: unknown,
) {
  const c = options.clinics[clinicId];
  if (!c)
    throw new ToolError('payment_setup', 'Online payment is not connected for this clinic.', 409);
  try {
    const res = await (options.fetchImpl ?? fetch)('https://api.razorpay.com/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(c.keyId + ':' + c.keySecret).toString('base64'),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw Error();
    return await res.json();
  } catch {
    throw new ToolError(
      'payment_unavailable',
      'Payment provider could not confirm this request. Refresh status before trying again.',
      503,
    );
  }
}
export const razorpayOrderSchema = z.object({
  id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  amount: z.number().int(),
  currency: z.string(),
  receipt: z.string(),
  status: z.string(),
});
export const razorpayPaymentSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  order_id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  captured: z.boolean(),
  amount_refunded: z.number().int().min(0),
  method: z.string().optional(),
});
