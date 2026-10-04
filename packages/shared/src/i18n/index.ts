import en from './en.json';
import hi from './hi.json';

export type Lang = 'en' | 'hi';
export type MessageKey = keyof typeof en;
export const bundles: Record<Lang, Record<string, string>> = { en, hi };

/** Look up a translated string and fill {placeholders}. All user-facing text goes through here. */
export function t(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const raw = bundles[lang]?.[key] ?? bundles.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
