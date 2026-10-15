import { test } from '@playwright/test';
import { videoDisruptions } from './video-disruptions';
test('video scenario: delay, patient reply, cancellation and accepted replacement slot', async ({
  request,
}) => {
  const scenario = await videoDisruptions(request);
  try {
    for (const action of ['late-propose', 'late-confirm', 'late-reply', 'cancel', 'fill-slot'])
      await scenario.run(action);
  } finally {
    await scenario.close();
  }
});
