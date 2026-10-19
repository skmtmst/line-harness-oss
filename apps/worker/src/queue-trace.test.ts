import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentInvocation, currentRequestId, logger, traceQueueMessage, tracedFetch, withInvocation } from '@line-crm/shared/server';
import type { CodexMentionQueueMessage } from './services/codex-cloud-types.js';
import type { Env } from './worker-env.js';

const processor = vi.hoisted(() => vi.fn());
vi.mock('./services/codex-cloud-monitor.js', async original => ({
  ...await original<typeof import('./services/codex-cloud-monitor.js')>(), processCodexMentionMessage: processor,
}));
import worker from './index.js';

beforeEach(() => { processor.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const payload: CodexMentionQueueMessage = { kind: 'inspect_relay', slackEventId: 'event', channelId: 'channel', threadTs: 'thread' };
const delivery = (body: CodexMentionQueueMessage) => ({ body, attempts: 1, ack: vi.fn(), retry: vi.fn() });
const batch = (...messages: ReturnType<typeof delivery>[]) => ({ messages } as unknown as MessageBatch<CodexMentionQueueMessage>);

it('HTTPから保存したキューの番号を、再開・外部呼出・ログへ渡し、次のメッセージへ混ぜない', async () => {
  const stored = withInvocation('http', () => JSON.parse(JSON.stringify(traceQueueMessage(payload))) as CodexMentionQueueMessage);
  const snapshots: ReturnType<typeof currentInvocation>[] = [];
  const transport = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', transport);
  processor.mockImplementation(async () => {
    snapshots.push(currentInvocation());
    logger.info('queue.trace.test');
    await tracedFetch('https://provider.invalid/send', { method: 'POST', body: 'unchanged', redirect: 'manual', headers: { Authorization: 'Bearer queue-secret' } });
  });
  const first = delivery(stored), legacy = delivery({ ...payload, requestId: 'private-customer@example.invalid' });
  const malformed = delivery({ ...payload, requestId: { toString: 'private-customer' } } as unknown as CodexMentionQueueMessage);
  await expect(worker.queue(batch(first, legacy, malformed), {} as Env['Bindings'])).resolves.toBeUndefined();
  expect(snapshots[0]).toMatchObject({ requestId: stored.requestId, source: 'queue' });
  expect(snapshots[0]!.invocationId).not.toBe(stored.requestId);
  expect(snapshots[1]!.requestId).toBe(snapshots[1]!.invocationId);
  expect(snapshots[1]!.requestId).not.toBe(stored.requestId);
  expect(snapshots[2]!.requestId).toBe(snapshots[2]!.invocationId);
  expect(new Set(snapshots.map(row => row!.invocationId)).size).toBe(3);
  for (let i = 0; i < 3; i++) {
    const options = transport.mock.calls[i][1] as RequestInit;
    expect(new Headers(options.headers).get('X-Request-ID')).toBe(snapshots[i]!.requestId);
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer queue-secret');
    expect(options).toMatchObject({ method: 'POST', body: 'unchanged', redirect: 'manual' });
  }
  expect(first.ack).toHaveBeenCalledOnce(); expect(legacy.ack).toHaveBeenCalledOnce();
  expect(first.retry).not.toHaveBeenCalled(); expect(legacy.retry).not.toHaveBeenCalled();
  expect(malformed.ack).toHaveBeenCalledOnce(); expect(malformed.retry).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-customer|queue-secret|unchanged|provider.invalid/);
  expect(currentRequestId()).toBeUndefined();
});

it('失敗のログも元の番号を使い、再試行の回数・待機とackの条件は変えない', async () => {
  const stored = withInvocation('http', () => traceQueueMessage(payload));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  processor.mockRejectedValue(new Error('private-prompt token=queue-secret'));
  const message = delivery(stored);
  await worker.queue(batch(message), { CODEX_QUEUE_MAX_ATTEMPTS: '5' } as Env['Bindings']);
  expect(message.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
  expect(message.ack).not.toHaveBeenCalled();
  expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ requestId: stored.requestId, source: 'queue', code: 'src_index_failed' });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-prompt|queue-secret/);
});
