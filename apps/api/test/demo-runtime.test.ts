import { describe, it, expect, vi } from 'vitest';
import { demoRuntime } from '../src/demo-runtime';

describe('local demo messaging isolation', () => {
  const runtime = (found: boolean) =>
    ({
      pool: { query: vi.fn().mockResolvedValue({ rowCount: found ? 1 : 0 }) },
      bus: {},
      channel: { kind: 'live' },
      requireLiveChannel: true,
      platformClinics: ['live'],
    }) as any;
  it('uses mock messages for exact fictional clinics even with live delivery enabled', async () => {
    const rt = runtime(true),
      selected = await demoRuntime(rt, 'demo', true, []);
    expect(selected.requireLiveChannel).toBe(false);
    expect(selected.channel).not.toBe(rt.channel);
    expect(selected.platformClinics).toEqual([]);
    expect(rt.requireLiveChannel).toBe(true);
    expect(rt.pool.query.mock.calls[0][0]).toContain("name='DEMO · One Doctor Clinic'");
  });
  it('preserves ordinary clinics and any bound clinic', async () => {
    const rt = runtime(false);
    expect(await demoRuntime(rt, 'ordinary', true, [])).toBe(rt);
    const connected = runtime(true);
    expect(await demoRuntime(connected, 'bound', true, ['bound'])).toBe(connected);
    expect(connected.pool.query).not.toHaveBeenCalled();
  });
  it('does not enable practice delivery when simulator is disabled', async () => {
    const rt = runtime(true);
    expect(await demoRuntime(rt, 'demo', false, [])).toBe(rt);
    expect(rt.pool.query).not.toHaveBeenCalled();
  });
});
