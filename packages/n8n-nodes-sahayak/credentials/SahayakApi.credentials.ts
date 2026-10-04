import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class SahayakApi implements ICredentialType {
  name = 'sahayakApi';
  displayName = 'Sahayak API';
  documentationUrl = 'https://github.com/your-org/sahayak#integrations';
  properties: INodeProperties[] = [
    {
      displayName: 'Server URL',
      name: 'baseUrl',
      type: 'string',
      default: 'http://localhost:4000',
      description: 'Where your Sahayak API runs (no trailing slash)',
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Create one on the Integrations screen in Sahayak (starts with shy_)',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
  };

  test: ICredentialTestRequest = {
    request: { baseURL: '={{$credentials.baseUrl}}', url: '/v1/doctors' },
  };
}
