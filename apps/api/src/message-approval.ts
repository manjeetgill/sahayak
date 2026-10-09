import { z } from 'zod';
import { withClinic } from '@sahayak/db';
import type { AppDeps } from './app';
import { whatsappPlatform } from './whatsapp-platform';

const template = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  text: z.string(),
});
export const messageSetupSchema = z.object({
  webhook_verified: z.boolean(),
  templates: z.array(template),
  pending_templates: z.array(template).default([]),
});

/** Activate only the exact clinic-reviewed message after provider approval.
 * Conditional UPDATE prevents a concurrent pause/review from being overwritten.
 * Dispatch still rechecks consent, template content, timing and idempotency.
 */
export async function activateApprovedMessage(
  deps: AppDeps,
  clinic: string,
  kind: 'feedback' | 'evening',
) {
  const table = kind === 'feedback' ? 'patient_feedback_settings' : 'patient_evening_settings';
  const settings = await withClinic(
    deps.pool,
    clinic,
    async (db) =>
      (await db.query(`SELECT * FROM ${table} WHERE activation_requested AND NOT enabled`)).rows[0],
  );
  if (!settings?.channel_id || !settings.reviewed_template || !settings.reviewed_by) return false;
  if (kind === 'feedback' && !process.env.CHECKIN_PUBLIC_WEB_URL?.startsWith('https://'))
    return false;
  const setup = await whatsappPlatform(
    deps.whatsappPlatform,
    clinic,
    `/v1/whatsapp/channels/${settings.channel_id}/send-setup`,
    messageSetupSchema,
  );
  const current = setup.templates.find((t) => t.id === settings.template_id);
  if (
    !setup.webhook_verified ||
    !current ||
    !['id', 'name', 'language', 'text'].every(
      (key) => current[key as keyof typeof current] === settings.reviewed_template[key],
    )
  )
    return false;
  return withClinic(
    deps.pool,
    clinic,
    async (db) =>
      !!(
        await db.query(
          `UPDATE ${table} SET enabled=true,activation_requested=false,updated_at=now()
     WHERE activation_requested AND NOT enabled AND channel_id=$1 AND template_id=$2 AND reviewed_template=$3::jsonb`,
          [settings.channel_id, settings.template_id, JSON.stringify(settings.reviewed_template)],
        )
      ).rowCount,
  );
}
