/** Operator-only: attach an existing verified channel; never called by a browser. */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { makePool } from '@sahayak/db';
import { callTool, registerAllTools, EventBus } from '@sahayak/core';
import { whatsappPlatform, whatsappPlatformFromEnv } from './whatsapp-platform';
for (const line of readFileSync('../../.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const [clinicId, channelId, phone] = process.argv.slice(2);
z.string().uuid().parse(clinicId);
z.string().uuid().parse(channelId);
z.string()
  .regex(/^\+[1-9]\d{7,14}$/)
  .parse(phone);
const bindings = JSON.parse(process.env.AGENT_CHANNEL_BRIDGE_BINDINGS ?? '{}');
if (bindings[channelId]?.clinicId !== clinicId)
  throw new Error('An operator-verified clinic bridge binding is required.');
const channels = await whatsappPlatform(
  whatsappPlatformFromEnv(),
  clinicId,
  '/v1/whatsapp/channels?limit=100',
  z.array(
    z.object({
      id: z.string(),
      app_id: z.string(),
      execution_mode: z.string(),
      enabled: z.boolean(),
      webhook_verified_at: z.string().nullable(),
    }),
  ),
);
const ch = channels.find(
  (c) =>
    c.id === channelId && c.app_id === bindings[channelId].appId && c.execution_mode === 'SAHAYAK',
);
if (!ch) throw new Error('Platform did not confirm the bound clinic channel.');
const pool = makePool();
registerAllTools();
try {
  await callTool(
    { pool, bus: new EventBus('') },
    { clinicId, actor: { kind: 'system', name: 'verified-pilot-link' } },
    'attach_verified_whatsapp_channel',
    {
      phone,
      channelId,
      appId: ch.app_id,
      phase: ch.enabled ? 'ACTIVE' : ch.webhook_verified_at ? 'READY' : 'WEBHOOK_PENDING',
    },
  );
  console.log('Verified pilot attached to clinic setup.');
} finally {
  await pool.end();
}
