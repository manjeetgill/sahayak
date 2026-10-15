/* global fetch, AbortSignal */
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import { spawnSync, spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Node loads .env itself: no shell evaluation and no credentials in diagnostic output.
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
process.loadEnvFile(resolve(root, '.env'));
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`${command} ${args[0]} failed. Check that Docker Desktop is running.`);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reachable = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
};
async function service(kind, url) {
  if (await reachable(url)) return;
  const label = `gui/${process.getuid?.()}/in.sahayak.local.${kind}`;
  if (
    process.platform === 'darwin' &&
    spawnSync('launchctl', ['print', label], { stdio: 'ignore' }).status === 0
  ) {
    run('launchctl', ['kickstart', '-k', label]);
  } else {
    const log = openSync(resolve(tmpdir(), `sahayak-demo-${kind}.log`), 'a', 0o600);
    const pnpmCli = process.env.npm_execpath;
    if (!pnpmCli) throw new Error('Start this helper with pnpm demo:ready.');
    // Execute the pnpm JavaScript entry point: Windows cannot spawn pnpm.cmd
    // directly without a shell. No shell parsing is needed on either OS.
    const child = spawn(process.execPath, [pnpmCli, `dev:${kind}`], {
      cwd: root,
      env: process.env,
      detached: true,
      stdio: ['ignore', log, log],
    });
    child.on('error', () => console.error(`Could not start the ${kind} service.`));
    child.unref();
    closeSync(log);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await reachable(url)) return;
    await pause(1000);
  }
  throw new Error(`The ${kind} service did not become ready. Check its local service log.`);
}
try {
  console.log('Starting the local database and cache…');
  run('docker', ['compose', 'up', '-d', 'postgres', 'redis']);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres'], {
        stdio: 'ignore',
      }).status === 0
    )
      break;
    await pause(1000);
  }
  run('node', ['node_modules/tsx/dist/cli.mjs', 'packages/db/src/migrate.ts']);
  const seedArgs = ['node_modules/tsx/dist/cli.mjs', 'packages/db/src/seed-showcase.ts'];
  if (process.argv.includes('--refresh-demo')) seedArgs.push('--reset');
  run('node', seedArgs);
  await service('api', 'http://localhost:4000/health');
  await service('web', 'http://localhost:3000/demo');
  for (const email of [
    'doctor@solo.demo.test',
    'kavita@hospital.demo.test',
    'admin@hospital.demo.test',
    'desk@hospital.demo.test',
  ]) {
    const response = await fetch('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'demo1234' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Demo sign-in failed for ${email}`);
  }
  console.log('Ready: http://localhost:3000/demo');
  console.log('Doctor, admin and reception demo sign-ins verified. Password: demo1234');
  console.log(
    'Practice messages and payments stay in the fictional clinics. Live external delivery is separate.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
