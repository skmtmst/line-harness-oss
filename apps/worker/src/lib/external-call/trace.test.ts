import { afterEach, expect, it, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';
import { currentInvocation, currentRequestId, logger, withInvocation } from '@line-crm/shared/server';
import { createCallState, createExternalCall, API_RETRY_WAIT, MemoryCircuitStore } from './index.js';
import { type CallState } from './types.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('LINEの差し替えたtransportにも3つの低層通信から同じ番号を渡す', async () => {
  const transport = vi.fn().mockImplementation(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  const network = vi.fn(); vi.stubGlobal('fetch', network);
  await withInvocation('http', async () => {
    const id = currentRequestId();
    const client = new LineClient('synthetic-secret', { transport });
    await client.pushMessage('U-fixture', [], 'retry-key');
    await client.getDefaultRichMenuId();
    await client.uploadRichMenuImage('menu-fixture', new ArrayBuffer(2));
    for (const [, init] of transport.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(id);
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-secret');
      expect(init.redirect).toBe('manual');
    }
    expect(new Headers(transport.mock.calls[0][1].headers).get('X-Line-Retry-Key')).toBe('retry-key');
  });
  expect(transport).toHaveBeenCalledTimes(3);
  expect(network).not.toHaveBeenCalled();
});
it('保存済みの依頼をcronで再開し、LINE送信・台帳・ログへ同じIDを渡す', async () => {
  const now = Date.now();
  const initial = withInvocation('http', () => createCallState({
    scope: { accountId: 'a', storeId: 's', destination: 'line', connectionId: 'c' },
    operationId: 'job', idempotencyKey: 'retry-key', snapshotId: 'snapshot', effect: 'write',
  }, { category: 'api', maxAttempts: 4, timeoutMs: 1000, deadlineAt: now + 60_000, wait: API_RETRY_WAIT }, now));
  let stored: CallState = JSON.parse(JSON.stringify(initial));
  const originalId = stored.requestId;
  const send = vi.fn().mockImplementation(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', send);
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const writes: Array<{ trace: string | undefined; stored: CallState }> = [];
  await withInvocation('cron', async () => {
    const executionId = currentRequestId();
    const result = await createExternalCall({ circuits: new MemoryCircuitStore(), now: () => now })({
      state: stored,
      journal: { compareAndSwap: async (_before, next) => {
        stored = JSON.parse(JSON.stringify(next));
        writes.push({ trace: currentRequestId(), stored });
        return true;
      } },
      authorize: async () => true,
      execute: async () => {
        expect(currentRequestId()).toBe(originalId);
        expect(currentInvocation()?.invocationId).toBe(executionId);
        logger.info('line.attempt');
        await new LineClient('secret').pushMessage('U-fixture', [], 'retry-key');
        return { kind: 'success', value: 'sent' };
      },
    });
    expect(result.kind).toBe('success');
    expect(currentRequestId()).toBe(executionId);
    expect(executionId).not.toBe(originalId);
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(new Headers(send.mock.calls[0][1].headers).get('X-Request-ID')).toBe(originalId);
  expect(new Headers(send.mock.calls[0][1].headers).get('X-Line-Retry-Key')).toBe('retry-key');
  expect(writes).toHaveLength(2);
  expect(writes.every(row => row.trace === originalId && row.stored.requestId === originalId)).toBe(true);
  expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ requestId: originalId, source: 'cron', code: 'line.attempt' });
});
