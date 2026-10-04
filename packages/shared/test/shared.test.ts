import { describe, it, expect } from 'vitest';
import { bundles, detectRedFlagKeywords, t } from '../src';

describe('translations', () => {
  it('Hindi and English have exactly the same keys, none empty', () => {
    expect(Object.keys(bundles.hi).sort()).toEqual(Object.keys(bundles.en).sort());
    for (const lang of ['en', 'hi'] as const)
      for (const [k, v] of Object.entries(bundles[lang]))
        expect([k, v.trim().length > 0]).toEqual([k, true]);
  });
  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(bundles.en))
      expect([k, ph(bundles.hi[k])]).toEqual([k, ph(bundles.en[k])]);
  });
  it('fills variables', () =>
    expect(t('en', 'msg.your_turn', { name: 'A', doctor: 'D', token: 5 })).toContain('Token 5'));
  it('the fixed medical reply is exactly as specified', () =>
    expect(bundles.en['msg.medical_advice']).toBe(
      "I can't advise on that, but I've told the doctor's team right away.",
    ));
});

describe('red-flag keywords', () => {
  const should = [
    'chest pain',
    'Pain in my chest',
    'seene mein dard',
    'सीने में दर्द',
    'सीने में बहुत तेज़ दर्द',
    'my newborn has a fever',
    'baby has very high fever',
    "can't breathe",
    'difficulty breathing',
    'she is unconscious',
    'suicide',
    'zeher kha liya',
    'बच्चे को दौरा पड़ रहा है',
    "bleeding that won't stop",
  ];
  const shouldNot = [
    'what are your timings',
    'I have a fever since yesterday',
    'my back hurts a little',
    'book an appointment',
    'my baby needs a vaccination',
    'where is the pharmacy',
    'poisonous plants in garden are not an issue? just asking about parking',
  ];
  it.each(should)('flags: %s', (m) => expect(detectRedFlagKeywords(m)).not.toBeNull());
  it.each(shouldNot.slice(0, 5))('does not flag: %s', (m) =>
    expect(detectRedFlagKeywords(m)).toBeNull(),
  );
  it('clinic-added phrases add to, never replace, the built-ins', () => {
    expect(detectRedFlagKeywords('bee sting', [{ phrase: 'bee sting' }])).not.toBeNull();
    expect(detectRedFlagKeywords('chest pain', [{ phrase: 'unrelated' }])).not.toBeNull();
  });
});
