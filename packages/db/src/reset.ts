import pg from 'pg';
import { migrate } from './migrate';
import { seed } from './seed';

const url = process.env.ADMIN_DATABASE_URL!;
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await c.end();
console.log('Applied:', (await migrate(url)).join(', '));
await seed(url);
