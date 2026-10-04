import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LlmGate, NemotronProvider } from '@sahayak/agents';
import { EventBus } from '@sahayak/core';
import { makePool } from '@sahayak/db';
import { activeClinics, buildApp } from './app';

// Load the repo-root .env when running from the workspace (no extra dependency).
const envFile = join(process.cwd(), '../../.env');
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
const pool = makePool();
const bus = new EventBus();
const gate = new LlmGate(NemotronProvider.fromEnv(), bus, () => [...activeClinics]);
const app = await buildApp({ pool, bus, gate, jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret' });
await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: '0.0.0.0' });
