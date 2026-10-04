import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';

// Load .env for tests without extra dependencies.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
