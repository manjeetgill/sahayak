import pg from 'pg';

export type Db = pg.PoolClient;

export function makePool(url = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString: url, max: 10 });
}

/**
 * Run work inside a transaction scoped to one clinic. Row-level security uses the
 * `app.clinic_id` setting, so code inside `fn` can only ever see/write that clinic's rows.
 */
export async function withClinic<T>(pool: pg.Pool, clinicId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId]);
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}
