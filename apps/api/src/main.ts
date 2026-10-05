import { bridgeFromEnv, provisioningFromEnv } from './whatsapp-bridge';
import { whatsappPlatformFromEnv } from './whatsapp-platform';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LlmGate, NemotronProvider, startJobs } from '@sahayak/agents';
import { EventBus, pluginFromEnv } from '@sahayak/core';
import { makePool } from '@sahayak/db';
import { activeClinics, buildApp } from './app';
import { agentPlatformFromEnv } from './agent-platform';

// Load the repo-root .env when running from the workspace (no extra dependency).
const envFile = join(process.cwd(), '../../.env');
if (existsSync(envFile))
  for (const l of readFileSync(envFile, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET)
  throw new Error('JWT_SECRET must be set in production');
const pool = makePool();
const bus = new EventBus();
const gate = new LlmGate(NemotronProvider.fromEnv(), bus, () => [...activeClinics]);
const platformChannels = process.env.LIVE_CHANNEL_OWNER === 'platform';
const whatsapp = platformChannels ? undefined : pluginFromEnv() ?? undefined;
const app = await buildApp({
  liveChannelOwner: platformChannels ? 'platform' : 'local',
  whatsapp,
  agentPlatform: agentPlatformFromEnv(),
  whatsappPlatform: whatsappPlatformFromEnv(),
  whatsappBridge: bridgeFromEnv(),
  whatsappProvisioning: provisioningFromEnv(),
  pool,
  bus,
  gate,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret',
});
await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: '0.0.0.0' });

if (process.env.JOBS_ENABLED !== 'false' && process.env.ADMIN_DATABASE_URL) {
  startJobs({
    channel: whatsapp?.messaging,
    adminUrl: process.env.ADMIN_DATABASE_URL,
    pool,
    bus,
    log: (m, e) => app.log.warn({ err: e }, m),
  })
    .then(() => app.log.info('background jobs started'))
    .catch((e) =>
      app.log.error(e, 'background jobs failed to start; reminders and no-show sweeps are off'),
    );
}
