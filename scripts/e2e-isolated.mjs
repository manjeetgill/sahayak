import process from 'node:process';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { URL } from 'node:url';

const env = { ...process.env };
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !(match[1] in env)) env[match[1]] = match[2];
}
const admin = new pg.Client({ connectionString: env.ADMIN_DATABASE_URL });
const name = `sahayak_e2e_${Date.now()}`;
const databaseUrl = (value) => {
  const url = new URL(value);
  url.pathname = `/${name}`;
  return url.toString();
};
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  console.log(`Running browser tests with isolated database ${name}`);
  const child = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
      ...env,
      ADMIN_DATABASE_URL: databaseUrl(env.ADMIN_DATABASE_URL),
      DATABASE_URL: databaseUrl(env.DATABASE_URL),
      E2E_ISOLATED: '1', E2E_API_PORT: '4100', E2E_WEB_PORT: '3100',
      LLM_PROVIDER: 'offline', LLM_API_KEY: '', TOGETHER_API_KEY: '', AGENT_PLATFORM_URL: '', AGENT_PLATFORM_KEY: '',
      WHATSAPP_PROVIDER: '', CHANNEL_PLUGIN_URL: '',
      JOBS_ENABLED: 'false', PATIENT_MESSAGES_JOBS_ENABLED: 'false',
      AGENT_CHANNEL_BRIDGE_BINDINGS: '', AGENT_CHANNEL_PLATFORM_URL: '', AGENT_CHANNEL_CREDENTIALS: '', LIVE_CHANNEL_OWNER: 'local',
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  console.log('Isolated test database removed.');
}
