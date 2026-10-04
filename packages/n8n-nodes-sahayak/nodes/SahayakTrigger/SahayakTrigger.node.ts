import { NodeConnectionTypes } from 'n8n-workflow';
import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { verifySignature } from '../../lib/signature';

const EVENTS = [
  'patient.checked_in',
  'queue.called',
  'visit.finished',
  'appointment.booked',
  'appointment.cancelled',
  'appointment.rescheduled',
  'flag.raised',
  'schedule.shifted',
  'message.received',
  'patient.erased',
];

export class SahayakTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Sahayak Trigger',
    name: 'sahayakTrigger',
    icon: 'file:sahayak.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description:
      'Starts a flow when something happens in your clinic (check-in, booking, emergency alert, ...)',
    defaults: { name: 'Sahayak Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'sahayakApi', required: true }],
    webhooks: [
      { name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' },
    ],
    properties: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: ['appointment.booked'],
        options: EVENTS.map((e) => ({ name: e, value: e })),
      },
      {
        displayName: 'Patient Details',
        name: 'level',
        type: 'options',
        default: 'minimal',
        options: [
          { name: 'Ids Only (Recommended)', value: 'minimal' },
          {
            name: 'Include Patient Name and Phone',
            value: 'full',
            description: 'Only if you are allowed to share patient details with this workflow',
          },
        ],
      },
      {
        displayName:
          'The API key needs "admin" access so this node can register itself in Sahayak when the workflow is activated.',
        name: 'notice',
        type: 'notice',
        default: '',
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        return typeof (this.getWorkflowStaticData('node') as IDataObject).webhookId === 'string';
      },
      async create(this: IHookFunctions): Promise<boolean> {
        const cred = await this.getCredentials('sahayakApi');
        const res = await this.helpers.httpRequestWithAuthentication.call(this, 'sahayakApi', {
          method: 'POST',
          url: `${String(cred.baseUrl).replace(/\/$/, '')}/v1/webhooks`,
          body: {
            url: this.getNodeWebhookUrl('default'),
            events: this.getNodeParameter('events') as string[],
            level: this.getNodeParameter('level') as string,
          },
          json: true,
        });
        const data = this.getWorkflowStaticData('node') as IDataObject;
        data.webhookId = res.id;
        data.secret = res.secret;
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node') as IDataObject;
        if (typeof data.webhookId === 'string') {
          const cred = await this.getCredentials('sahayakApi');
          try {
            await this.helpers.httpRequestWithAuthentication.call(this, 'sahayakApi', {
              method: 'DELETE',
              url: `${String(cred.baseUrl).replace(/\/$/, '')}/v1/webhooks/${data.webhookId}`,
              json: true,
            });
          } catch {
            /* already gone */
          }
        }
        delete data.webhookId;
        delete data.secret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const secret = String((this.getWorkflowStaticData('node') as IDataObject).secret ?? '');
    const raw = (req as any).rawBody
      ? Buffer.from((req as any).rawBody).toString('utf8')
      : JSON.stringify(req.body);
    const sig = this.getHeaderData()['x-sahayak-signature'] as string | undefined;
    // Reject anything not signed by our Sahayak server: anyone can call a public webhook URL.
    if (!secret || !verifySignature(secret, raw, sig)) {
      const res = this.getResponseObject();
      res.status(401).json({ error: 'bad_signature' });
      return { noWebhookResponse: true };
    }
    const event = this.getBodyData() as IDataObject;
    const wanted = this.getNodeParameter('events') as string[];
    if (!wanted.includes(String(event.type))) return { webhookResponse: { ignored: true } };
    return { workflowData: [this.helpers.returnJsonArray(event)] };
  }
}
