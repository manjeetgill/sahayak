import { MockWhatsAppChannel, type ToolRuntime } from '@sahayak/core';

/** Staff demonstrations must never use a live adapter or silently drop practice notices. */
export async function demoRuntime(
  runtime: ToolRuntime,
  clinicId: string,
  enabled: boolean,
  excluded: string[],
): Promise<ToolRuntime> {
  if (!enabled || process.env.NODE_ENV === 'production' || excluded.includes(clinicId))
    return runtime;
  const result = await runtime.pool.query(
    "SELECT 1 FROM clinics WHERE id=$1 AND ((slug='showcase-solo' AND name='DEMO · One Doctor Clinic') OR (slug='showcase-hospital' AND name='DEMO · Community Hospital'))",
    [clinicId],
  );
  if (!result.rowCount) return runtime;
  return {
    ...runtime,
    channel: new MockWhatsAppChannel(),
    requireLiveChannel: false,
    platformClinics: [],
  };
}
