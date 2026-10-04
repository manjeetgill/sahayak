import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(adminUrl = process.env.ADMIN_DATABASE_URL): Promise<string[]> {
  if (!adminUrl) throw new Error('ADMIN_DATABASE_URL is not set');
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  const applied: string[] = [];
  try {
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
    );
    const done = new Set(
      (await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then((a) => console.log(a.length ? `Applied: ${a.join(', ')}` : 'Up to date'));
}
