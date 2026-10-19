import { afterEach, expect, test, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';
import { API_RETRY_WAIT, createCallState, createExternalCall, createHttpAttempt, lineTransport, MemoryCircuitStore } from '../lib/external-call/index.js';
import { type CallState } from '../lib/external-call/types.js';
import { QA_STAGING_DATABASE, withQaOutboundBoundary } from './staging-qa-safety.js';
import type { WorkerBindings } from '../worker-bindings.js';

const staging = {
  DEPLOY_ENV: 'staging', WORKER_NAME: 'nen-line-stg', D1_DATABASE_ID: QA_STAGING_DATABASE,
  WORKER_PUBLIC_URL: 'https://stg-api.musubo.jp', STAGING_QA_ENABLED: 'true', STAGING_QA_OUTBOUND_DISABLED: 'true',
} as WorkerBindings;
afterEach(() => vi.unstubAllGlobals());

test('共通の外部実行器でもQAの送信止めを通り、不明の書込みを再送しない', async () => {
  const network = vi.fn(async () => Response.json({ id: 'real-acceptance' }));
  vi.stubGlobal('fetch', network);
  const now = Date.now();
  let state = createCallState({ scope: { accountId: 'qa-account', storeId: 'qa-store', destination: 'stripe', connectionId: 'qa-connection' },
    operationId: 'qa-operation', idempotencyKey: 'qa-key', snapshotId: 'qa-snapshot', effect: 'write',
  }, { category: 'api', maxAttempts: 1, timeoutMs: 1000, deadlineAt: now + 60_000, wait: API_RETRY_WAIT }, now);
  const journal = { compareAndSwap: async (previous: Readonly<CallState>, next: Readonly<CallState>) => {
    if (state.revision !== previous.revision) return false;
    state = structuredClone(next);
    return true;
  } };
  const execute = createHttpAttempt({ url: 'https://api.stripe.com/v1/charges', method: 'POST', body: '{}', maxResponseBytes: 1024,
    interpret: async response => ({ kind: 'success', value: await response.json() }),
  });
  const call = createExternalCall({ circuits: new MemoryCircuitStore() });
  const run = () => call({ state, journal, authorize: async () => true, execute });
  expect(await withQaOutboundBoundary(staging, run)).toMatchObject({ kind: 'unknown', state: { phase: 'unknown', attempts: 1 } });
  expect(await withQaOutboundBoundary(staging, run)).toMatchObject({ kind: 'unknown', state: { attempts: 1 } });
  expect(network).not.toHaveBeenCalled();
  // The same adapter has a working transport when QA is inactive; no real network is used.
  expect(await withQaOutboundBoundary({ ...staging, DEPLOY_ENV: 'production' }, () => execute(new AbortController().signal, state.identity)))
    .toMatchObject({ kind: 'success', value: { id: 'real-acceptance' } });
  expect(network).toHaveBeenCalledOnce();
});

test('共通LINE transportを注入したSDKもQA中はネットワーク送信0、通常時は模擬の通信先へ1回', async () => {
  const network = vi.fn(async () => Response.json({ sentMessages: [] }));
  vi.stubGlobal('fetch', network);
  const send = () => {
    const client = new LineClient('non-qa-connection', { transport: lineTransport(new AbortController().signal) });
    return client.pushMessage('U' + 'a'.repeat(32), [{ type: 'text', text: 'Synthetic QA' }]);
  };
  // The SDK intentionally hides transport errors; assert its public error and zero requests.
  await expect(withQaOutboundBoundary(staging, send)).rejects.toThrow('LINE API network error');
  expect(network).not.toHaveBeenCalled();
  await withQaOutboundBoundary({ ...staging, DEPLOY_ENV: 'production' }, send);
  expect(network).toHaveBeenCalledOnce();
});
