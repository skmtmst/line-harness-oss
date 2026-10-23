import { beforeEach, expect, test, vi } from 'vitest';
import type { WorkerBindings } from '../worker-bindings.js';
import { ACCOUNT_WORK_CRON, type AccountWorkMessage } from './account-work-types.js';
const mocks = vi.hoisted(() => ({ consume: vi.fn(), dispatch: vi.fn(), codex: vi.fn() }));
vi.mock('./account-work-consumer.js', async original => ({
  ...await original<typeof import('./account-work-consumer.js')>(), consumeAccountWork:mocks.consume,
}));
vi.mock('./account-work-dispatch.js', () => ({dispatchAccountWork:mocks.dispatch}));
vi.mock('./codex-cloud-monitor.js', () => ({processCodexMentionMessage:mocks.codex,markCodexMentionFailed:vi.fn(),shouldStopCodexQueueRetry:vi.fn()}));
import { consumeWorkerQueue } from './worker-queue.js';
import { AccountWorkBusyError } from './account-work-consumer.js';
import { scheduled } from '../cron/scheduled.js';
const body: AccountWorkMessage = {kind:'account_work',task:'analytics',accountId:'store-a',windowStartedAt:'2026-10-23T00:00:00.000Z',sequence:0};
const delivery = () => ({body,attempts:100,ack:vi.fn(),retry:vi.fn()});
beforeEach(() => { vi.resetAllMocks(); });
test('account jobs have their own retry policy and do not fall through to the developer queue', async () => {
  const message = delivery();
  mocks.consume.mockRejectedValueOnce(new Error('fixture failure'));
  await consumeWorkerQueue({messages:[message]} as unknown as MessageBatch<AccountWorkMessage>,{} as WorkerBindings);
  expect(message.retry).toHaveBeenCalledWith({delaySeconds:60});
  expect(message.ack).not.toHaveBeenCalled(); expect(mocks.codex).not.toHaveBeenCalled();
});
test('lease contention waits 21 minutes without acknowledging the unfinished message', async () => {
  const message = delivery();
  mocks.consume.mockRejectedValueOnce(new AccountWorkBusyError());
  await consumeWorkerQueue({messages:[message]} as unknown as MessageBatch<AccountWorkMessage>,{} as WorkerBindings);
  expect(message.retry).toHaveBeenCalledExactlyOnceWith({delaySeconds:21*60});
  expect(message.ack).not.toHaveBeenCalled(); expect(mocks.codex).not.toHaveBeenCalled();
});
test('an ordinary error with the busy text keeps the normal 60-second retry', async () => {
  const message = delivery();
  mocks.consume.mockRejectedValueOnce(new Error('account_work_busy'));
  await consumeWorkerQueue({messages:[message]} as unknown as MessageBatch<AccountWorkMessage>,{} as WorkerBindings);
  expect(message.retry).toHaveBeenCalledExactlyOnceWith({delaySeconds:60});
  expect(message.ack).not.toHaveBeenCalled();
});
test('a batch-size configuration error still runs at most one account per invocation', async () => {
  const first = delivery(), second = delivery();
  await consumeWorkerQueue({messages:[first,second]} as unknown as MessageBatch<AccountWorkMessage>,{} as WorkerBindings);
  expect(mocks.consume).toHaveBeenCalledOnce(); expect(first.ack).toHaveBeenCalledOnce();
  expect(second.retry).toHaveBeenCalledWith({delaySeconds:1}); expect(second.ack).not.toHaveBeenCalled();
});
test('the reserved producer cron dispatches separately from the existing delivery work', async () => {
  const env = {} as WorkerBindings;
  await scheduled({cron:ACCOUNT_WORK_CRON,scheduledTime:0} as ScheduledEvent,env,{} as ExecutionContext);
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(env,0);
});
