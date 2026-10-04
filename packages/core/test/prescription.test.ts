import { describe, it, expect } from 'vitest';
import { parsePrescriptionText } from '../src/prescription';

describe('reading a dictated prescription (copies, never suggests)', () => {
  it('reads a complete line exactly as said', () => {
    const p = parsePrescriptionText('tab paracetamol 500 mg twice a day for 3 days');
    expect(p.items).toEqual([
      {
        drug: 'paracetamol',
        form: 'tab',
        strength: '500 mg',
        frequency: 'twice a day',
        duration: '3 days',
      },
    ]);
    expect(p.incomplete).toEqual([]);
  });
  it('understands 1-0-1 style and "after food", several lines, advice and follow-up', () => {
    const p = parsePrescriptionText(
      'Tab Azithromycin 500mg 1-0-0 x 5 days after food\nCap Omeprazole 20 mg 1-0-0 for 7 days\nadvice: rest and plenty of fluids\nfollow up after 5 days',
    );
    expect(
      p.items.map((i) => [i.drug, i.strength, i.frequency, i.duration, i.instructions]),
    ).toEqual([
      ['Azithromycin', '500mg', 'once a day', '5 days', 'after food'],
      ['Omeprazole', '20 mg', 'once a day', '7 days', undefined],
    ]);
    expect(p.advice).toBe('rest and plenty of fluids');
    expect(p.follow_up).toBe('after 5 days');
  });
  it('leaves out and reports what it could not read, instead of guessing', () => {
    const p = parsePrescriptionText('ORS sachet\ntab cetirizine 10 mg at bedtime');
    expect(p.items[0]).toEqual({ drug: 'ORS sachet' });
    expect(p.incomplete).toContain('ORS sachet: how often and duration not found');
    expect(p.incomplete).toContain('cetirizine: duration not found');
  });
  it('never adds a medicine, dose or duration that was not said', () => {
    expect(parsePrescriptionText('amoxicillin').items).toEqual([{ drug: 'amoxicillin' }]);
    // an unlabelled line is kept (the doctor decides) but flagged
    const r = parsePrescriptionText('rest and fluids');
    expect(r.items).toEqual([{ drug: 'rest and fluids' }]);
    expect(r.incomplete.join(' ')).toMatch(/Check that this is a medicine/);
  });
  it('handles bd/tds/sos and weeks', () => {
    const p = parsePrescriptionText(
      'tab drugx 250 mg bd for 2 weeks; syp drugy tds for 1 week; tab drugz sos',
    );
    expect(p.items.map((i) => [i.frequency, i.duration])).toEqual([
      ['twice a day', '2 weeks'],
      ['three times a day', '1 week'],
      ['only if needed', undefined],
    ]);
  });
});
