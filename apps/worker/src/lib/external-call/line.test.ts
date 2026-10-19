import { afterEach, expect, test, vi } from 'vitest';
import { LineApiError, LineClient } from '@line-crm/line-sdk';
import { createCallState, API_RETRY_WAIT, createExternalCall, MemoryCircuitStore } from './index.js';
import { type CallIdentity, type CallState } from './types.js';
import { lineFailure, lineTransport } from './line.js';

const identity: CallIdentity = { scope: { accountId: 'a', storeId: 's', destination: 'line', connectionId: 'c' },
  operationId: 'job', idempotencyKey: 'retry-key', snapshotId: 'snapshot', effect: 'write' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('all three SDK low-level paths use injected single-attempt transport', async () => {
  const globalFetch = vi.fn(); vi.stubGlobal('fetch', globalFetch);
  const transport = vi.fn().mockImplementation(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const client = new LineClient('secret-token', { transport });
  await client.pushMessage('U1', [{ type: 'text', text: 'snapshot' }], 'retry-key');
  await client.getDefaultRichMenuId();
  await client.uploadRichMenuImage('menu', new ArrayBuffer(2));
  expect(globalFetch).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledTimes(3);
  for (const [, init] of transport.mock.calls as [string, RequestInit][]) expect(init.redirect).toBe('manual');
});

test('LINE documented retry endpoints accept 409; arbitrary endpoint / keyless 409 is not success', async () => {
  const transport = vi.fn().mockResolvedValue(new Response('secret-upstream-body', { status: 409 }));
  expect(await new LineClient('token', { transport }).pushMessageWithRequestId('U1', [], 'retry-key')).toEqual({ data: { retryAccepted: true }, requestId: null });
  const accepted = () => new Response('{}', { status: 409, headers: { 'x-line-accepted-request-id': 'original-request' } });
  const actual = vi.fn().mockImplementation(async () => accepted());
  const client = new LineClient('token', { transport: actual });
  expect(await client.pushMessageWithRequestId('U1', [], 'retry-key')).toEqual({ data: { retryAccepted: true }, requestId: 'original-request' });
  await expect(client.request('POST', '/v2/bot/richmenu', {}, { 'X-Line-Retry-Key': 'retry-key' })).rejects.toMatchObject({ status: 409 });
  await expect(client.pushMessage('U1', [])).rejects.toMatchObject({ status: 409 });
  expect(await client.request('POST', '/v2/bot/message/push', {}, { 'x-line-retry-key': 'retry-key' })).toMatchObject({ data: { retryAccepted: true } });
  expect(await client.request('post', '/v2/bot/message/push', {}, { 'X-Line-Retry-Key': 'retry-key' })).toMatchObject({ data: { retryAccepted: true } });
});

test('404 default rich menu stays null; empty 200 and binary upload stay compatible', async () => {
  const transport = vi.fn().mockImplementation(async () => new Response('secret', { status: 404 }));
  const client = new LineClient('token', { transport });
  expect(await client.getDefaultRichMenuId()).toBeNull();
  transport.mockImplementation(async () => new Response(null, { status: 200 }));
  expect(await client.replyMessage('reply-token', [])).toBeUndefined();
  await expect(client.uploadRichMenuImage('menu', new ArrayBuffer(1))).resolves.toBeUndefined();
});

test.each([401, 403, 429, 503])('SDK %i safe error preserves numeric status and valid Retry-After without provider body/statusText', async status => {
  const transport = vi.fn().mockImplementation(async () => new Response('SECRET-BODY', { status, statusText: 'SECRET-TEXT', headers: { 'retry-after': '90' } }));
  const client = new LineClient('SECRET-TOKEN', { transport });
  try { await client.pushMessage('U1', [], 'retry-key'); throw new Error('expected error'); }
  catch (error) {
    expect(error).toBeInstanceOf(LineApiError);
    expect(error).toMatchObject({ status, retryAfter: '90', message: `LINE API error: ${status}` });
    expect(String(error)).not.toContain('SECRET');
    expect(lineFailure(error, identity, 1000)).toMatchObject({ kind: status < 429 ? 'permanent' : 'unknown', status, retryAt: 91_000 });
  }
  expect(transport).toHaveBeenCalledTimes(1);
});

test('SDK network and JSON errors do not expose thrown secrets', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('SECRET-URL-TOKEN'));
  const client = new LineClient('token', { transport });
  await expect(client.replyMessage('reply-token', [])).rejects.toThrow('LINE API network error');
  transport.mockImplementation(async () => new Response('SECRET-BAD-JSON', { headers: { 'content-type': 'application/json' } }));
  await expect(client.getProfile('U1')).rejects.toThrow('LINE API invalid response');
});

test('SDK + executor counts ONE physical request and stops ambiguous mutations even with a retry key', async () => {
  const now = 1_800_000_000_000;
  let state = createCallState(identity, { category: 'api', maxAttempts: 4, timeoutMs: 100, deadlineAt: now + 100_000, wait: API_RETRY_WAIT }, now);
  const transport = vi.fn().mockRejectedValue(new Error('SECRET accepted then disconnected'));
  const call = createExternalCall({ circuits: new MemoryCircuitStore(), now: () => now });
  const journal = { compareAndSwap: async (previous: Readonly<CallState>, next: Readonly<CallState>) => {
    if (JSON.stringify(previous) !== JSON.stringify(state)) return false;
    state = structuredClone(next); return true;
  } };
  const execute = async (signal: AbortSignal, same: Readonly<CallIdentity>) => {
    try {
      const client = new LineClient('token', { transport: lineTransport(signal, transport) });
      const value = await client.pushMessageWithRequestId('U1', [{ type: 'text', text: 'snapshot' }], same.idempotencyKey);
      return { kind: 'success' as const, value };
    } catch (error) { return lineFailure(error, same, now); }
  };
  expect(await call({ state, journal, authorize: async () => true, execute })).toMatchObject({ kind: 'unknown', state: { attempts: 1 } });
  await call({ state, journal, authorize: async () => true, execute });
  expect(transport).toHaveBeenCalledTimes(1);
  const [, init] = transport.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)['X-Line-Retry-Key']).toBe(identity.idempotencyKey);
  expect(init.redirect).toBe('manual');
});

test('untrusted Retry-After header cannot smuggle provider text into SDK errors', () => {
  expect(new LineApiError(429, 'SECRET upstream customer').retryAfter).toBeNull();
  expect(new LineApiError(429, '9'.repeat(400)).retryAfter).toBe('9007199254740');
});
