import { afterEach, expect, test, vi } from 'vitest';
import { createTestD1 } from './test-utils/d1-sqlite.js';

const { processJobs, sender } = vi.hoisted(() => ({
  processJobs: vi.fn(async () => ({ processed: 0 })),
  sender: vi.fn(),
}));
vi.mock('./services/event-waitlist.js', () => ({
  processEventWaitlistPromotionJobs: processJobs,
  createEventWaitlistOfferSender: () => sender,
}));
const { default: worker } = await import('./index.js');
afterEach(() => vi.restoreAllMocks());

// Webのソース文字列確認を、実際のscheduled入口とジョブの接続の確認へ置き換える。
test.each([
  ['*/5 * * * *', 1],
  ['ignored', 0],
] as const)('待機案内は実scheduledの配信tickだけが回収する: %s', async (cron, calls) => {
  const fixture = createTestD1();
  const scheduledTime = Date.parse('2026-10-18T01:00:00Z');
  const pending: Promise<unknown>[] = [];
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external call forbidden'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await worker.scheduled(
      { cron, scheduledTime } as ScheduledEvent,
      { DB: fixture.db } as import('./index.js').Env['Bindings'],
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
    );
    await Promise.allSettled(pending);
    expect(processJobs).toHaveBeenCalledTimes(calls);
    if (calls) expect(processJobs).toHaveBeenCalledWith(fixture.db, { now: new Date(scheduledTime), sender });
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    await Promise.allSettled(pending);
    fixture.raw.close();
  }
});
