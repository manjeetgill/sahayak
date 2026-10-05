import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Fresh demo data (Dr. Sharma's Clinic, 25 appointments) before every e2e run. */
export default async function setup() {
  const env = { ...process.env };
  for (const l of readFileSync('.env', 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
  for (const key of ['DATABASE_URL', 'ADMIN_DATABASE_URL']) {
    if (env.E2E_ISOLATED !== '1' || !/^\/sahayak_e2e_\d+$/.test(new URL(env[key] ?? '').pathname))
      throw new Error('Browser tests require an isolated database. Run pnpm e2e.');
  }
  execSync('pnpm db:reset', { stdio: 'inherit', env });
}
