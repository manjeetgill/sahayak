export type Resource = 'appointment' | 'slot' | 'queue' | 'doctor' | 'message';

export interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  qs?: Record<string, string | number>;
  body?: Record<string, unknown>;
}

const clean = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  ) as T;

/** Map an n8n resource/operation and its parameters to a Sahayak API request. Pure, so it is unit-tested. */
export function buildRequest(
  resource: Resource,
  operation: string,
  p: Record<string, any>,
): RequestSpec {
  switch (`${resource}.${operation}`) {
    case 'doctor.getAll':
      return { method: 'GET', path: '/v1/doctors' };
    case 'slot.getAll':
      return {
        method: 'GET',
        path: '/v1/slots',
        qs: clean({
          doctorId: p.doctorId,
          date: p.date,
          from: p.from,
          to: p.to,
          count: p.count,
        }) as any,
      };
    case 'queue.get':
      return { method: 'GET', path: '/v1/queue' };
    case 'appointment.getAll':
      return {
        method: 'GET',
        path: '/v1/appointments',
        qs: clean({ date: p.date, doctorId: p.doctorId }) as any,
      };
    case 'appointment.book':
      return {
        method: 'POST',
        path: '/v1/appointments',
        body: clean({
          doctorId: p.doctorId,
          startsAt: p.startsAt,
          reason: p.reason,
          patient: clean({ phone: p.phone, name: p.name }),
          consentVisitData: p.consentVisitData === true ? true : undefined,
        }),
      };
    case 'appointment.cancel':
      return {
        method: 'POST',
        path: `/v1/appointments/${encodeURIComponent(p.appointmentId)}/cancel`,
        body: {},
      };
    case 'appointment.reschedule':
      return {
        method: 'POST',
        path: `/v1/appointments/${encodeURIComponent(p.appointmentId)}/reschedule`,
        body: { newStartsAt: p.newStartsAt },
      };
    case 'message.send':
      return { method: 'POST', path: '/v1/messages', body: { phone: p.phone, text: p.text } };
    default:
      throw new Error(`Unsupported operation ${resource}.${operation}`);
  }
}
