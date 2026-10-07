/** Server operator bootstrap for an existing clinic; does not change any existing login. */
import pg from 'pg';
import { hashPassword } from '../packages/db/src/index';
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
};
const slug = arg('--clinic'),
  email = arg('--email')?.trim().toLowerCase(),
  name = arg('--name');
const password = process.env.SAHAYAK_ADMIN_PASSWORD;
if (!slug || !email || !name || !password || password.length < 12)
  throw Error(
    'Provide --clinic SLUG --email EMAIL --name NAME and SAHAYAK_ADMIN_PASSWORD (12+ characters). Existing accounts are never changed.',
  );
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
try {
  await db.connect();
  await db.query('BEGIN');
  const clinic = (await db.query('SELECT id FROM clinics WHERE slug=$1', [slug])).rows[0];
  if (!clinic) throw Error('Clinic not found');
  if ((await db.query('SELECT id FROM staff_users WHERE email=$1', [email])).rowCount)
    throw Error('That email already has an account. Choose a separate admin email.');
  await db.query(
    "INSERT INTO staff_users(clinic_id,email,password_hash,name,role) VALUES($1,$2,$3,$4,'admin')",
    [clinic.id, email, await hashPassword(password), name],
  );
  await db.query('COMMIT');
  console.log('Admin account created. Sign in at /login.');
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await db.end();
}
