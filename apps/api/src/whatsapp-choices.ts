import { createHash } from 'node:crypto';
import { t, type Lang } from '@sahayak/shared';
import { fmtTime } from '@sahayak/core';
export function clinicChoices(
  conversationId: string,
  state: Record<string, any>,
  lang: Lang,
  timezone: string,
) {
  const label = (key: string) => t(lang, ('msg.choice_' + key) as any);
  let values: { value: string; title: string; description?: string }[] = [];
  const fixed = (pairs: string[][]) => pairs.map(([value, key]) => ({ value, title: label(key) }));
  switch (state.flow) {
    case 'clinic_menu':
      values = fixed([
        ['1', 'book'],
        ['2', 'timings'],
        ['3', 'address'],
        ['4', 'reception'],
      ]);
      break;
    case 'clinic_visit':
      values = fixed([
        ['1', 'first'],
        ['2', 'follow'],
      ]);
      break;
    case 'reminder_consent':
    case 'lead_consent':
    case 'confirm_clinic_slot':
      values = fixed([
        ['yes', 'yes'],
        ['no', 'no'],
      ]);
      break;
    case 'ask_pref':
      values = fixed([
        ['earliest', 'earliest'],
        ['tomorrow', 'tomorrow'],
      ]);
      break;
    case 'pick_doctor':
      values = (state.doctors ?? []).map((d: any, i: number) => ({
        value: String(i + 1),
        title: d.name,
      }));
      break;
    case 'pick_slot':
      values = (state.slots ?? []).map((s: string, i: number) => ({
        value: String(i + 1),
        title: fmtTime(s, timezone, lang),
        description: fmtTime(s, timezone, lang),
      }));
      break;
  }
  // Keep the full numbered-text fallback when a menu exceeds WhatsApp's list limit.
  if (!values.length || values.length > 10) return null;
  const version = createHash('sha256')
    .update(conversationId + JSON.stringify(state))
    .digest('hex')
    .slice(0, 20);
  return {
    button: label('choose').slice(0, 20),
    choices: values.map((v, i) => ({
      ...v,
      id: `sc:${version}:${i}`,
      title: v.title.slice(0, 24),
      ...(v.description ? { description: v.description.slice(0, 72) } : {}),
    })),
  };
}
