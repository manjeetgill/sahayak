/** Hand-written OpenAPI description of the public API (kept short on purpose). */
export function openApiSpec() {
  const bearer = [{ bearer: [] }];
  const uuid = { type: 'string', format: 'uuid' };
  const op = (summary: string, scope: string, extra: Record<string, unknown> = {}) => ({
    summary: `${summary} (scope: ${scope})`,
    security: bearer,
    responses: {
      '200': { description: 'OK' },
      '401': { description: 'Missing or invalid API key' },
      '403': { description: 'Key scope too low' },
    },
    ...extra,
  });
  return {
    openapi: '3.0.3',
    info: {
      title: 'Sahayak API',
      version: '1.0.0',
      description:
        'Clinic front-desk automation. Create keys on the Integrations screen. Limit: 120 requests per minute per key. Events are delivered to webhooks signed with `X-Sahayak-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>`.',
    },
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'shy_<prefix>_<secret>' },
      },
    },
    paths: {
      '/v1/doctors': { get: op('List doctors', 'read') },
      '/v1/slots': {
        get: op('Free slots for a doctor', 'read', {
          parameters: [
            { name: 'doctorId', in: 'query', required: true, schema: uuid },
            { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'from', in: 'query', schema: { type: 'string', example: '16:00' } },
            { name: 'to', in: 'query', schema: { type: 'string', example: '21:00' } },
            { name: 'count', in: 'query', schema: { type: 'integer', default: 5 } },
          ],
        }),
      },
      '/v1/appointments': {
        get: op('Appointments for a day (default today)', 'read', {
          parameters: [
            { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'doctorId', in: 'query', schema: uuid },
          ],
        }),
        post: op(
          'Book an appointment. New patients need patient.name and consentVisitData=true.',
          'write',
        ),
      },
      '/v1/appointments/{id}/cancel': { post: op('Cancel an appointment', 'write') },
      '/v1/appointments/{id}/reschedule': {
        post: op('Move an appointment to a free slot', 'write'),
      },
      '/v1/queue': { get: op("Today's queue", 'read') },
      '/v1/messages': {
        post: op('Send a WhatsApp message to a patient who consented to messages', 'write'),
      },
      '/v1/webhooks': { post: op('Subscribe a URL to events', 'admin') },
      '/v1/webhooks/{id}': { delete: op('Delete a webhook', 'admin') },
    },
  };
}
