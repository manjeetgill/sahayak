import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Fresh demo data (Dr. Sharma's Clinic, 25 appointments) before every e2e run. */
export default async function setup() {
  const env = { ...process.env };
  for (const l of readFileSync('.env', 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
  execSync('pnpm db:reset', { stdio: 'inherit', env });
}
