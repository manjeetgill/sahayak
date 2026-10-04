import { describe, it, expect } from 'vitest';
import { signWebhook } from '@sahayak/core';
import { buildRequest } from '../lib/requests';
import { verifySignature } from '../lib/signature';

describe('signature (must match the server)', () => {
  const body = JSON.stringify({ id: 'e1', type: 'appointment.booked', data: {} });
  it('accepts what the Sahayak server signs, rejects tampering, wrong secret and old timestamps', () => {
    const sig = signWebhook('whsec_x', body);
    expect(verifySignature('whsec_x', body, sig)).toBe(true);
    expect(verifySignature('whsec_y', body, sig)).toBe(false);
    expect(verifySignature('whsec_x', body + '1', sig)).toBe(false);
    expect(
      verifySignature(
        'whsec_x',
        body,
        signWebhook('whsec_x', body, Math.floor(Date.now() / 1000) - 4000),
      ),
    ).toBe(false);
    expect(verifySignature('whsec_x', body, undefined)).toBe(false);
    expect(verifySignature('whsec_x', body, 'garbage')).toBe(false);
  });
});

describe('buildRequest', () => {
  it('maps operations to API calls and drops empty parameters', () => {
    expect(
      buildRequest('slot', 'getAll', { doctorId: 'd', date: '', from: '16:00', to: '', count: 3 }),
    ).toEqual({ method: 'GET', path: '/v1/slots', qs: { doctorId: 'd', from: '16:00', count: 3 } });
    expect(
      buildRequest('appointment', 'book', {
        doctorId: 'd',
        startsAt: 's',
        phone: '98',
        name: '',
        consentVisitData: false,
      }),
    ).toEqual({
      method: 'POST',
      path: '/v1/appointments',
      body: { doctorId: 'd', startsAt: 's', patient: { phone: '98' } },
    });
    expect(buildRequest('appointment', 'cancel', { appointmentId: 'a/b' }).path).toBe(
      '/v1/appointments/a%2Fb/cancel',
    );
    expect(buildRequest('message', 'send', { phone: '98', text: 'hi' })).toEqual({
      method: 'POST',
      path: '/v1/messages',
      body: { phone: '98', text: 'hi' },
    });
    expect(() => buildRequest('queue', 'nope', {})).toThrow();
  });
});
