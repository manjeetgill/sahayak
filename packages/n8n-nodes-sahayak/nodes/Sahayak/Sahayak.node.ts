import { NodeConnectionTypes } from 'n8n-workflow';
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { buildRequest, type Resource } from '../../lib/requests';

const show = (resource: string, operations?: string[]) => ({
  show: { resource: [resource], ...(operations ? { operation: operations } : {}) },
});

export class Sahayak implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Sahayak',
    name: 'sahayak',
    icon: 'file:sahayak.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Book appointments, read the queue and message patients in your clinic',
    defaults: { name: 'Sahayak' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'sahayakApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        default: 'appointment',
        options: [
          { name: 'Appointment', value: 'appointment' },
          { name: 'Doctor', value: 'doctor' },
          { name: 'Message', value: 'message' },
          { name: 'Queue', value: 'queue' },
          { name: 'Slot', value: 'slot' },
        ],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'getAll',
        displayOptions: show('doctor'),
        options: [{ name: 'Get Many', value: 'getAll', action: 'Get many doctors' }],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'get',
        displayOptions: show('queue'),
        options: [{ name: "Get Today's Queue", value: 'get', action: "Get today's queue" }],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'getAll',
        displayOptions: show('slot'),
        options: [{ name: 'Get Free Slots', value: 'getAll', action: 'Get free slots' }],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'send',
        displayOptions: show('message'),
        options: [
          {
            name: 'Send WhatsApp Message',
            value: 'send',
            action: 'Send a WhatsApp message',
            description: 'Only reaches patients who agreed to messages',
          },
        ],
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'getAll',
        displayOptions: show('appointment'),
        options: [
          { name: 'Book', value: 'book', action: 'Book an appointment' },
          { name: 'Cancel', value: 'cancel', action: 'Cancel an appointment' },
          { name: 'Get Many', value: 'getAll', action: 'Get appointments for a day' },
          { name: 'Reschedule', value: 'reschedule', action: 'Move an appointment' },
        ],
      },
      {
        displayName: 'Doctor ID',
        name: 'doctorId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: show('slot'),
        description: 'From the Doctor, Get Many operation',
      },
      {
        displayName: 'Doctor ID',
        name: 'doctorId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: show('appointment', ['book']),
      },
      {
        displayName: 'Doctor ID',
        name: 'doctorId',
        type: 'string',
        default: '',
        displayOptions: show('appointment', ['getAll']),
        description: 'Optional filter',
      },
      {
        displayName: 'Date',
        name: 'date',
        type: 'string',
        default: '',
        placeholder: '2026-10-12',
        displayOptions: show('slot'),
        description: 'YYYY-MM-DD; searches from this day onward. Empty = today',
      },
      {
        displayName: 'Date',
        name: 'date',
        type: 'string',
        default: '',
        placeholder: '2026-10-12',
        displayOptions: show('appointment', ['getAll']),
        description: 'YYYY-MM-DD. Empty = today',
      },
      {
        displayName: 'From (Time)',
        name: 'from',
        type: 'string',
        default: '',
        placeholder: '16:00',
        displayOptions: show('slot'),
      },
      {
        displayName: 'To (Time)',
        name: 'to',
        type: 'string',
        default: '',
        placeholder: '21:00',
        displayOptions: show('slot'),
      },
      {
        displayName: 'How Many',
        name: 'count',
        type: 'number',
        default: 5,
        typeOptions: { minValue: 1, maxValue: 20 },
        displayOptions: show('slot'),
      },
      {
        displayName: 'Starts At',
        name: 'startsAt',
        type: 'string',
        default: '',
        required: true,
        placeholder: '2026-10-12T10:30:00.000Z',
        displayOptions: show('appointment', ['book']),
        description: 'Use a time returned by Slot, Get Free Slots',
      },
      {
        displayName: 'Patient Phone',
        name: 'phone',
        type: 'string',
        default: '',
        required: true,
        displayOptions: show('appointment', ['book']),
        placeholder: '9876543210',
      },
      {
        displayName: 'Patient Name',
        name: 'name',
        type: 'string',
        default: '',
        displayOptions: show('appointment', ['book']),
        description: 'Required for patients the clinic has not seen before',
      },
      {
        displayName: 'Patient Agreed to the Clinic Storing Their Details',
        name: 'consentVisitData',
        type: 'boolean',
        default: false,
        displayOptions: show('appointment', ['book']),
        description: 'Required for new patients. Only turn on if the patient really agreed.',
      },
      {
        displayName: 'Reason',
        name: 'reason',
        type: 'string',
        default: '',
        displayOptions: show('appointment', ['book']),
      },
      {
        displayName: 'Appointment ID',
        name: 'appointmentId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: show('appointment', ['cancel', 'reschedule']),
      },
      {
        displayName: 'New Starts At',
        name: 'newStartsAt',
        type: 'string',
        default: '',
        required: true,
        displayOptions: show('appointment', ['reschedule']),
      },
      {
        displayName: 'Patient Phone',
        name: 'phone',
        type: 'string',
        default: '',
        required: true,
        displayOptions: show('message'),
      },
      {
        displayName: 'Text',
        name: 'text',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        required: true,
        displayOptions: show('message'),
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    const cred = await this.getCredentials('sahayakApi');
    const baseUrl = String(cred.baseUrl).replace(/\/$/, '');
    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as Resource;
        const operation = this.getNodeParameter('operation', i) as string;
        const params: IDataObject = {};
        for (const k of [
          'doctorId',
          'date',
          'from',
          'to',
          'count',
          'startsAt',
          'phone',
          'name',
          'consentVisitData',
          'reason',
          'appointmentId',
          'newStartsAt',
          'text',
        ]) {
          try {
            params[k] = this.getNodeParameter(k, i) as any;
          } catch {
            /* parameter not shown for this operation */
          }
        }
        const spec = buildRequest(resource, operation, params);
        const res = await this.helpers.httpRequestWithAuthentication.call(this, 'sahayakApi', {
          method: spec.method,
          url: `${baseUrl}${spec.path}`,
          qs: spec.qs,
          body: spec.body,
          json: true,
        });
        const rows: unknown[] = Array.isArray(res)
          ? res
          : res?.slots
            ? res.slots.map((startsAt: string) => ({ startsAt }))
            : (res?.appointments ?? res?.queue ?? [res]);
        for (const r of rows)
          out.push({
            json: (typeof r === 'object' && r !== null ? r : { value: r }) as IDataObject,
            pairedItem: { item: i },
          });
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        throw new NodeApiError(this.getNode(), error as any);
      }
    }
    return [out];
  }
}
