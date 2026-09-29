import { describe, expect, test, vi } from 'vitest';

import {
  runIsolatedScheduledJobs,
  scheduledLane,
} from './scheduled-job-isolation.js';

describe('runIsolatedScheduledJobs', () => {
  test('通知・5分重処理・6時間重処理を別の実行単位へ振り分ける', () => {
    expect(scheduledLane('*/5 * * * *')).toBe('delivery');
    expect(scheduledLane('1-56/5 * * * *')).toBe('frequentHeavy');
    expect(scheduledLane('0 */6 * * *')).toBe('sixHourlyHeavy');
    expect(scheduledLane('invalid')).toBe('ignored');
  });

  test('重い1処理が失敗しても同じ実行単位の残りを止めない', async () => {
    const completed: string[] = [];
    const onFailure = vi.fn();

    const result = await runIsolatedScheduledJobs([
      { name: 'heavy-failed', run: async () => { throw new Error('temporary'); } },
      { name: 'heavy-next', run: async () => { completed.push('heavy-next'); } },
    ], onFailure);

    expect(result).toEqual({ succeeded: 1, failed: 1 });
    expect(completed).toEqual(['heavy-next']);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ name: 'heavy-failed' }));
  });

  test('重い実行が失敗した後でも別の通知実行単位を処理できる', async () => {
    const reminder = vi.fn(async () => undefined);
    await runIsolatedScheduledJobs([
      { name: 'analytics', run: async () => { throw new Error('slow query'); } },
    ], () => undefined);

    await runIsolatedScheduledJobs([{ name: 'booking-reminder', run: reminder }]);

    expect(reminder).toHaveBeenCalledOnce();
  });
});
