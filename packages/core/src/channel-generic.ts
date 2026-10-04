import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelPlugin, InboundAdapter, MessagingChannel } from './channels';

/**
 * Vendor-neutral WhatsApp bridge. Works with any gateway (or a small shim in front of a vendor) that can:
 *  - POST inbound messages to us as {"to": "<business number>", "from": "<patient number>", "text": "..."}
 *    (or {"messages":[...]}) with header `x-sahayak-signature: sha256=<hex HMAC of the raw body>`;
 *  - accept outbound messages as POST {to, text} with a bearer token.
 * Picking a vendor (Meta Cloud API, Twilio, Gupshup, ...) means writing one ChannelPlugin like this one for it.
 */
export function genericHttpPlugin(cfg: {
  secret: string;
  sendUrl: string;
  sendToken: string;
  fetchImpl?: typeof fetch;
}): ChannelPlugin {
  const messaging: MessagingChannel = {
    name: 'generic-http',
    queued: true,
    async send(m) {
      const res = await (cfg.fetchImpl ?? fetch)(cfg.sendUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.sendToken}` },
        body: JSON.stringify({ to: m.to, text: m.text, language: m.lang }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`WhatsApp gateway HTTP ${res.status}`);
    },
  };
  const inbound: InboundAdapter = {
    name: 'generic-http',
    handshake: (q) => (q['hub.verify_token'] === cfg.secret ? (q['hub.challenge'] ?? '') : null),
    verify(headers, raw) {
      const got = (headers['x-sahayak-signature'] ?? '').replace(/^sha256=/, '');
      const want = createHmac('sha256', cfg.secret).update(raw).digest('hex');
      const a = Buffer.from(got, 'hex'),
        b = Buffer.from(want, 'hex');
      return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
    },
    parse(body: any) {
      const list = Array.isArray(body?.messages) ? body.messages : [body];
      return list
        .filter(
          (m: any) =>
            m &&
            typeof m.to === 'string' &&
            typeof m.from === 'string' &&
            ((typeof m.text === 'string' && m.text.trim()) ||
              (m.media && typeof m.media.base64 === 'string')),
        )
        .map((m: any) => ({
          businessNumber: m.to,
          from: m.from,
          text: typeof m.text === 'string' ? m.text.slice(0, 2000) : '',
          media:
            m.media && typeof m.media.base64 === 'string'
              ? { filename: String(m.media.filename ?? 'file'), base64: m.media.base64 }
              : undefined,
        }));
    },
  };
  return { messaging, inbound };
}

export function pluginFromEnv(env = process.env): ChannelPlugin | null {
  if (env.WHATSAPP_PROVIDER !== 'generic') return null;
  if (!env.WHATSAPP_WEBHOOK_SECRET || !env.WHATSAPP_SEND_URL)
    throw new Error(
      'WHATSAPP_PROVIDER=generic needs WHATSAPP_WEBHOOK_SECRET and WHATSAPP_SEND_URL',
    );
  return genericHttpPlugin({
    secret: env.WHATSAPP_WEBHOOK_SECRET,
    sendUrl: env.WHATSAPP_SEND_URL,
    sendToken: env.WHATSAPP_SEND_TOKEN ?? '',
  });
}
