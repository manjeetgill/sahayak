import { it, expect } from 'vitest';
import { LlmGate } from '../src/llm';
import { translateInstructions } from '../src/agents/translation';
const model = (body: string) =>
  new LlmGate({
    name: 'test',
    chat: async () => ({ content: JSON.stringify({ body }), toolCalls: [] }),
  });
it('returns a draft translation while preserving printed numeric strings', async () => {
  expect(
    await translateInstructions(model('3 दिनों के बाद आएं'), 'Return after 3 days', 'hi'),
  ).toBe('3 दिनों के बाद आएं');
});
it('rejects changed or added numeric details', async () => {
  await expect(
    translateInstructions(model('Return after 4 days'), 'Return after 3 days', 'en'),
  ).rejects.toThrow('numeric');
});
it('does not silently fake translation when the configured model is unavailable', async () => {
  await expect(translateInstructions(new LlmGate(null), 'Return tomorrow', 'hi')).rejects.toThrow(
    'unavailable',
  );
});
