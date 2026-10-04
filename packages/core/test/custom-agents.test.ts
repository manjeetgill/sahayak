import { describe, it, expect } from 'vitest';
import { explainSpec, interpretAgentRequest, validateSpec } from '../src/custom-agents';

describe('plain words become a PROPOSED agent', () => {
  it('"remind my diabetic patients every month"', () => {
    const i = interpretAgentRequest('remind my diabetic patients every month');
    expect(i.understood).toBe(true);
    expect(i.spec).toMatchObject({
      trigger: { type: 'schedule', every: 'month', dayOfMonth: 1, at: '10:00' },
      audience: { tags: ['diabetic'] },
      action: { type: 'message_patients' },
    });
    expect(validateSpec(i.spec).ok).toBe(true);
    expect(i.notes.join(' ')).toMatch(/did not write the message/);
  });
  it("uses the doctor's own quoted wording", () => {
    const i = interpretAgentRequest(
      'remind my bp patients every week: "Hello {name}, please book your BP check at {clinic}."',
    );
    expect((i.spec as any).action.text.en).toBe(
      'Hello {name}, please book your BP check at {clinic}.',
    );
    expect((i.spec as any).trigger.every).toBe('week');
  });
  it('a summary at a chosen time', () => {
    const i = interpretAgentRequest('send me the number of no-shows every evening at 7pm');
    expect(i.spec).toMatchObject({
      trigger: { type: 'schedule', every: 'day', at: '19:00' },
      action: { type: 'summary', metrics: ['no_shows'] },
    });
    const j = interpretAgentRequest('send me a summary at 8pm');
    expect((j.spec as any).trigger.at).toBe('20:00');
    expect((j.spec as any).action.metrics).toEqual(['seen', 'no_shows', 'cancellations']);
  });
  it('patients not seen for a while', () => {
    const i = interpretAgentRequest("message patients who haven't visited in 90 days");
    expect((i.spec as any).audience).toEqual({ lastVisitOlderThanDays: 90 });
    expect(
      (interpretAgentRequest("message patients who haven't visited in 3 months").spec as any)
        .audience.lastVisitOlderThanDays,
    ).toBe(90);
  });
  it('tell the receptionist when something happens', () => {
    const i = interpretAgentRequest('tell the receptionist when someone cancels');
    expect(i.spec).toMatchObject({
      trigger: { type: 'event', event: 'appointment.cancelled' },
      action: { type: 'notify_staff', to: 'receptionist' },
    });
  });
  it('after every visit', () => {
    const i = interpretAgentRequest('after every visit send "Thank you for visiting, {name}"');
    expect(i.spec).toMatchObject({
      trigger: { type: 'event', event: 'visit.finished', delayHours: 2 },
      action: { text: { en: 'Thank you for visiting, {name}' } },
    });
  });
  it('says so, with examples, when it does not understand', () => {
    const i = interpretAgentRequest('please do something clever with my data');
    expect(i.understood).toBe(false);
    expect(i.help).toMatch(/Try:/);
  });
  it('the explanation is plain language and states the fixed protections', () => {
    const i = interpretAgentRequest('remind my diabetic patients every month');
    const v = validateSpec(i.spec);
    if (!v.ok) throw new Error('invalid');
    const text = explainSpec(v.spec).join('\n');
    expect(text).toMatch(/On day 1 of every month at 10 am/);
    expect(text).toMatch(/patients labelled "diabetic"/);
    expect(text).toMatch(/agreed to messages and reminders/);
    expect(text).toMatch(/one custom-agent message per patient per week/);
    expect(text).toMatch(/Never at night/);
  });
});

describe('the rules a custom agent can never break', () => {
  const base = {
    trigger: { type: 'schedule', every: 'week', weekday: 1, at: '10:00' },
    audience: { tags: ['diabetes'] },
    action: {
      type: 'message_patients',
      text: { en: 'Hello {name}, please book your check-up at {clinic}.' },
    },
  };
  const bad = (patch: Record<string, any>) => validateSpec({ ...base, ...patch });
  const msg = (en: string, hi?: string) =>
    bad({ action: { type: 'message_patients', text: { en, hi } } });
  it('accepts a sensible agent', () => expect(validateSpec(base).ok).toBe(true));
  it('refuses links in messages (no phishing from a compromised login)', () => {
    for (const t of [
      'Visit https://evil.example/pay now',
      'see www.bank.com',
      'go to pay.me/now',
      'open bit.ly/x',
      'check mysite.in',
    ])
      expect(msg(t).ok).toBe(false);
  });
  it('refuses unknown placeholders', () => expect(msg('Hello {secret}').ok).toBe(false));
  it('refuses anything that reads like medical advice, in either language', () => {
    for (const t of [
      'Take paracetamol 500 mg twice a day',
      'Do not worry, it is nothing serious',
      'You probably have a viral infection',
    ])
      expect(msg(t).ok).toBe(false);
    expect(msg('Hello {name}', 'चिंता न करें, यह कुछ नहीं है').ok).toBe(false);
  });
  it('a scheduled message must have an audience; it can never go to all patients', () => {
    const v = bad({ audience: {} });
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v.problems)).toMatch(/cannot go to every patient/);
  });
  it('patients are never messaged at night', () => {
    expect(bad({ trigger: { type: 'schedule', every: 'day', at: '23:00' } }).ok).toBe(false);
    expect(bad({ trigger: { type: 'schedule', every: 'day', at: '07:59' } }).ok).toBe(false);
    expect(bad({ trigger: { type: 'schedule', every: 'day', at: '20:59' } }).ok).toBe(true);
  });
  it('a summary needs a schedule; shapes the schema does not know are rejected', () => {
    expect(
      validateSpec({
        trigger: { type: 'event', event: 'visit.finished' },
        audience: {},
        action: { type: 'summary', metrics: ['seen'] },
      }).ok,
    ).toBe(false);
    expect(validateSpec({ ...base, action: { type: 'run_code', code: 'process.exit()' } }).ok).toBe(
      false,
    );
    expect(
      validateSpec({ ...base, trigger: { type: 'schedule', every: 'second', at: '10:00' } }).ok,
    ).toBe(false);
  });
  it('labels cannot carry anything but plain words', () => {
    expect(bad({ audience: { tags: ["x'; DROP TABLE patients;--"] } }).ok).toBe(false);
    expect(bad({ audience: { tags: ['<script>'] } }).ok).toBe(false);
  });
});
