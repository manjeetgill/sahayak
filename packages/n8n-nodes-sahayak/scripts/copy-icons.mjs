import { cpSync } from 'node:fs';
for (const n of ['Sahayak', 'SahayakTrigger'])
  cpSync(`nodes/${n}/sahayak.svg`, `dist/nodes/${n}/sahayak.svg`);
