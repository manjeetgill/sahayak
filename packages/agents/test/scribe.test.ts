import { describe, it, expect } from 'vitest';
import { LlmGate, isGrounded, structureDeterministic, structureNote } from '../src';

describe('structuring a dictation without AI', () => {
  it("uses the doctor's headings and keeps their words", () => {
    const s = structureDeterministic(
      'Complaint: fever and cough for 3 days. History: no known allergies. Examination: throat congested, chest clear. Diagnosis: viral URI. Plan: rest, fluids, paracetamol 500 mg twice a day for 3 days. Follow up: after 3 days if fever persists.',
    );
    expect(s.note).toEqual({
      complaint: 'fever and cough for 3 days',
      history: 'no known allergies',
      examination: 'throat congested, chest clear',
      diagnosis: 'viral URI',
      plan: 'rest, fluids, paracetamol 500 mg twice a day for 3 days',
      follow_up: 'after 3 days if fever persists',
    });
    expect(s.flags).toEqual([]);
  });
  it('understands spoken headings without punctuation, and Hindi headings', () => {
    const a = structureDeterministic(
      'complaint headache since morning. diagnosis tension headache. plan rest and water. follow up one week',
    );
    expect(a.note.complaint).toBe('headache since morning');
    expect(a.note.diagnosis).toBe('tension headache');
    expect(a.note.follow_up).toBe('one week');
    const b = structureDeterministic('शिकायत: तीन दिन से बुखार। निदान: वायरल। सलाह: आराम और पानी');
    expect(b.note).toEqual({
      complaint: 'तीन दिन से बुखार',
      diagnosis: 'वायरल',
      plan: 'आराम और पानी',
    });
  });
  it('never invents: unlabelled text goes under History with a flag', () => {
    const s = structureDeterministic('patient has had cough for a week and takes no medicines');
    expect(s.note).toEqual({ history: 'patient has had cough for a week and takes no medicines' });
    expect(s.flags[0]).toMatch(/No section headings/);
    expect(JSON.stringify(s.note)).not.toMatch(/diagnos/i);
  });
  it('keeps text before the first heading and says so', () => {
    const s = structureDeterministic('Known diabetic. Diagnosis: fungal infection');
    expect(s.note.history).toBe('Known diabetic');
    expect(s.note.diagnosis).toBe('fungal infection');
    expect(s.flags[0]).toMatch(/before the first heading/);
  });
  it('words like "plan" inside a sentence do not split it', () => {
    const s = structureDeterministic(
      'Complaint: patient wants to plan travel and asks about fitness. Diagnosis: none',
    );
    expect(s.note.complaint).toBe('patient wants to plan travel and asks about fitness');
  });
});

describe("the AI path (optional) is held to the doctor's own words", () => {
  const t = 'Complaint: sore throat two days. Diagnosis: pharyngitis. Plan: warm water gargles';
  const llm = (out: object) =>
    new LlmGate({ name: 'x', chat: async () => ({ content: JSON.stringify(out), toolCalls: [] }) });
  it('is not used unless switched on', async () => {
    const s = await structureNote(llm({ complaint: 'invented' }), t, false);
    expect(s.usedAi).toBe(false);
  });
  it('accepts a faithful arrangement', async () => {
    const s = await structureNote(
      llm({
        complaint: 'sore throat two days',
        diagnosis: 'pharyngitis',
        plan: 'warm water gargles',
        unclear: [],
      }),
      t,
      true,
    );
    expect(s.usedAi).toBe(true);
    expect(s.note.diagnosis).toBe('pharyngitis');
  });
  it('rejects anything the doctor did not say (invented diagnosis, drug, advice)', async () => {
    for (const bad of [
      { complaint: 'sore throat two days', diagnosis: 'streptococcal tonsillitis' },
      { complaint: 'sore throat', plan: 'amoxicillin 500 mg three times daily for five days' },
      { plan: 'warm water gargles and avoid cold drinks and rest completely' },
    ]) {
      const s = await structureNote(llm(bad), t, true);
      expect(s.usedAi).toBe(false);
      expect(s.note.diagnosis).toBe('pharyngitis'); // fell back to the doctor's own headings
      expect(s.flags.join(' ')).toMatch(/rejected/);
    }
  });
  it('falls back quietly when the model fails or returns nonsense', async () => {
    const down = new LlmGate({
      name: 'x',
      chat: async () => {
        throw new Error('down');
      },
    });
    expect((await structureNote(down, t, true)).note.diagnosis).toBe('pharyngitis');
    expect((await structureNote(llm({}), t, true)).usedAi).toBe(false);
  });
  it('grounding check', () => {
    expect(isGrounded({ plan: 'warm water gargles' }, t)).toBe(false); // omitted other dictated findings
    expect(isGrounded(structureDeterministic(t).note, t)).toBe(true);
    expect(isGrounded({ plan: 'strong antibiotics immediately' }, t)).toBe(false);
  });
});

it('rejects changed doses and dropped negation even when vocabulary overlaps', () => {
  const transcript = 'History: no fever. Plan: tablet 5 mg once daily';
  expect(isGrounded({ history: 'fever', plan: 'tablet 5 mg once daily' }, transcript)).toBe(false);
  expect(isGrounded({ history: 'no fever', plan: 'tablet 50 mg once daily' }, transcript)).toBe(
    false,
  );
  expect(isGrounded({ history: 'no fever', plan: 'tablet 5 mg twice daily' }, transcript)).toBe(
    false,
  );
});
it('preserves doctor-stated assessment, differential, investigation and instructions', () => {
  const source =
    'Assessment: Needs review. Differential: Doctor recorded possibilities. Investigations: Bring existing report. Instructions: Call clinic tomorrow.';
  const result = structureDeterministic(source);
  expect(result.note).toMatchObject({
    assessment: 'Needs review',
    differential: 'Doctor recorded possibilities',
    investigations: 'Bring existing report',
    instructions: 'Call clinic tomorrow',
  });
  expect(result.note).not.toHaveProperty('plan');
});
