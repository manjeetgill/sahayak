import { expect, it } from 'vitest';
import { deliver, notifyPatient } from '../src/tools/common';
import type { ToolRun } from '../src/tools/registry';

it('does not report a proactive platform message as sent without a delivery channel', async () => {
  const queries: string[] = [];
  const run = {
    db: {
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: 1, rows: [{ id: 'conversation' }] };
      },
    },
    ctx: { clinicId: 'clinic', actor: { kind: 'system' } },
    rt: { requireLiveChannel: true },
    emit: () => {},
  } as unknown as ToolRun;
  const sent = await notifyPatient(
    run,
    { id: 'patient', phone: '+919000000000', language: 'en' },
    'msg.late_notice',
    { doctor: 'Dr. Demo', minutes: 30, when: 'tomorrow' },
  );
  expect(sent).toBe(false);
  expect(queries).toHaveLength(1); // consent read only; no message or outbox record
  await expect(deliver(run, { to: '+919000000000', text: 'test', lang: 'en' }))
    .rejects.toMatchObject({ code: 'delivery_unavailable' });
});
