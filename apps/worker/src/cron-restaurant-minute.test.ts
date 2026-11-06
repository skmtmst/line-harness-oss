import { expect, test, vi } from 'vitest';
const processRestaurantEvents = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./services/restaurant-events.js', () => ({ processRestaurantEvents }));
const { default: worker } = await import('./index.js');
test('REM3-07 毎分の実scheduledハンドラが飲食イベントの再試行を起動する', async () => {
 await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() } as ScheduledEvent,
   {} as import('./index.js').Env['Bindings'], { waitUntil: vi.fn() } as unknown as ExecutionContext);
 expect(processRestaurantEvents).toHaveBeenCalledOnce();
});
