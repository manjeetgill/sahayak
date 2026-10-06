import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelProviderFromEnv } from '../llm';

const file = join(process.cwd(), '../../.env');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const provider = modelProviderFromEnv();
if (!provider) {
  console.error('No model configured. Set LLM_PROVIDER and its corresponding API key in .env.');
  process.exit(1);
}
// Synthetic inputs only; no database access or patient records.
try {
  const start = Date.now();
  const reply = await provider.chat({
    messages: [
      { role: 'system', content: 'Follow the instruction exactly. Do not explain.' },
      { role: 'user', content: 'Reply with exactly: SAHAYAK_OK' },
    ],
    maxTokens: 2048,
    retries: 0,
  });
  if (reply.content?.trim() !== 'SAHAYAK_OK') throw new Error('Text response check failed');
  const result = await provider.chat({
    messages: [
      {
        role: 'system',
        content: 'You must call get_clinic_info before answering about clinic hours.',
      },
      { role: 'user', content: 'What time does this clinic open?' },
    ],
    tools: [
      {
        name: 'get_clinic_info',
        description: 'Read the clinic opening hours.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    ],
    maxTokens: 2048,
    retries: 0,
  });
  const tool = result.toolCalls.find((x) => x.name === 'get_clinic_info');
  if (!tool || JSON.stringify(JSON.parse(tool.arguments)) !== '{}')
    throw new Error('Tool-calling check failed');
  console.log(
    `PASS: ${provider.name} text and tool calling (${Date.now() - start} ms total). No patient data sent.`,
  );
  console.log('Run pnpm eval with this provider before using it for live clinic conversations.');
} catch {
  // Do not print provider response bodies, credentials, or internal reasoning.
  console.error(
    `FAIL: ${provider.name} model check. Check credentials, model access, token budget and timeout; run the evaluation before activation.`,
  );
  process.exitCode = 1;
}
