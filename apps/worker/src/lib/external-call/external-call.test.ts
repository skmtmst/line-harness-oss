import { afterEach, describe, expect, test, vi } from 'vitest';
import { API_RETRY_WAIT, createCallState, createExternalCall, createHttpAttempt, MemoryCircuitStore, parseRetryAfter } from './index.js';
import { type CallIdentity, type CallJournal, type CallPolicy, type CallRequest, type CallState, type Outcome } from './types.js';

const start = 1_800_000_000_000;
const identity: CallIdentity = { scope: { accountId: 'account-a', storeId: 'store-a', destination: 'line', connectionId: 'connection-a' },
  operationId: 'operation-a', idempotencyKey: 'stable-key', snapshotId: 'snapshot-a', effect: 'read' };
const policy: CallPolicy = { category: 'api', maxAttempts: 4, timeoutMs: 100, deadlineAt: start + 3_600_000, wait: API_RETRY_WAIT };
class Journal implements CallJournal {
  state: CallState;
  writes = 0;
  failWrite = 0;
  constructor(state: CallState) { this.state = structuredClone(state); }
  async compareAndSwap(previous: Readonly<CallState>, next: Readonly<CallState>) {
    this.writes++;
    if (this.writes === this.failWrite) throw new Error('secret-storage');
    if (JSON.stringify(this.state) !== JSON.stringify(previous)) return false;
    this.state = structuredClone(next);
    return true;
  }
}
function setup(input: { effect?: 'read' | 'write'; policy?: Partial<CallPolicy>; circuits?: MemoryCircuitStore } = {}) {
  let clock = start;
  const state = createCallState({ ...identity, effect: input.effect ?? 'read' }, { ...policy, ...input.policy }, clock);
  const journal = new Journal(state);
  const circuits = input.circuits ?? new MemoryCircuitStore(1, 1_000);
  const run = createExternalCall({ circuits, now: () => clock, random: () => 0.5 });
  const execute = vi.fn<CallRequest<string>['execute']>().mockResolvedValue({ kind: 'success', value: 'receipt' });
  const authorize = vi.fn().mockResolvedValue(true);
  const call = () => run({ state: journal.state, journal, execute, authorize });
  return { state, journal, run, execute, authorize, call, circuits, now: () => clock, at: (time: number) => { clock = time; } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('one durable external budget', () => {
  test('fixed 1/5/30 minutes, exactly four actual attempts, no Worker sleep or nested budget', async () => {
    const h = setup({ circuits: new MemoryCircuitStore(10) });
    h.execute.mockResolvedValue({ kind: 'transient', reason: 'http', status: 503 });
    let time = start;
    for (const delay of [60_000, 300_000, 1_800_000]) {
      const result = await h.call();
      time += delay;
      expect(result).toMatchObject({ kind: 'deferred', nextAt: time });
      expect(h.journal.state.attempts).toBe(h.execute.mock.calls.length);
      const calls = h.execute.mock.calls.length;
      expect(await h.call()).toMatchObject({ kind: 'deferred', nextAt: time });
      expect(h.execute).toHaveBeenCalledTimes(calls);
      h.at(time);
    }
    expect(await h.call()).toMatchObject({ kind: 'stopped', state: { attempts: 4 } });
    expect(await h.call()).toMatchObject({ kind: 'stopped' });
    expect(h.execute).toHaveBeenCalledTimes(4);
  });
  test('shorter feature budget stays shorter', async () => {
    const h = setup({ policy: { maxAttempts: 1 } });
    h.execute.mockResolvedValue({ kind: 'transient', reason: 'http', status: 429 });
    expect(await h.call()).toMatchObject({ kind: 'stopped', state: { attempts: 1 } });
    await h.call();
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  test.each([5, 8, 9])('ordinary APIs reject an increased budget of %i', maxAttempts => {
    expect(() => setup({ policy: { maxAttempts } })).toThrow('budget');
  });
  test('webhook exception is at most eight attempts in 24h', () => {
    expect(() => setup({ policy: { category: 'outgoing_webhook', maxAttempts: 8, deadlineAt: start + 86_400_000,
      wait: { kind: 'exponential', baseMs: 60_000, capMs: 28_800_000, jitterRatio: 0.1 } } })).not.toThrow();
    expect(() => setup({ policy: { category: 'outgoing_webhook', maxAttempts: 9 } })).toThrow();
    expect(() => setup({ policy: { category: 'outgoing_webhook', deadlineAt: start + 86_400_001 } })).toThrow();
  });
  test('exponential policy uses same executor and preserves webhook +/-10% jitter', async () => {
    for (const random of [0, 0.5, 1]) {
      const h = setup({ policy: { wait: { kind: 'exponential', baseMs: 1000, capMs: 2000, jitterRatio: 0.1 } }, circuits: new MemoryCircuitStore(10) });
      h.execute.mockResolvedValue({ kind: 'transient', reason: 'network' });
      const run = createExternalCall({ circuits: h.circuits, now: h.now, random: () => random });
      let time = start;
      for (const delay of [1000, 2000, 2000]) {
        const result = await run({ state: h.journal.state, journal: h.journal, execute: h.execute, authorize: h.authorize });
        time += Math.ceil(delay * (1 + 0.1 * (random * 2 - 1)));
        expect(result).toMatchObject({ kind: 'deferred', nextAt: time });
        h.at(time);
      }
    }
  });
  test.each([401, 403, 400, 404, 409, 422])('HTTP %i cannot be retried even if an adapter misclassifies it', async status => {
    const h = setup();
    h.execute.mockResolvedValue({ kind: 'transient', reason: 'http', status });
    expect(await h.call()).toMatchObject({ kind: 'stopped' });
    await h.call();
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  test('Retry-After is never shortened; deadline overflow stops instead of retrying early', async () => {
    const h = setup();
    const retryAt = start + 2_000_000;
    h.execute.mockResolvedValue({ kind: 'transient', reason: 'http', status: 429, retryAt });
    expect(await h.call()).toMatchObject({ kind: 'deferred', nextAt: retryAt });
    const expired = setup();
    expired.execute.mockResolvedValue({ kind: 'transient', reason: 'http', status: 429, retryAt: policy.deadlineAt });
    expect(await expired.call()).toMatchObject({ kind: 'stopped', state: { reason: 'budget' } });
  });
  test('expired budget and failed live guard make zero requests', async () => {
    const h = setup();
    h.at(policy.deadlineAt);
    expect(await h.call()).toMatchObject({ kind: 'stopped' });
    expect(h.execute).not.toHaveBeenCalled();
    const denied = setup();
    denied.authorize.mockResolvedValue(false);
    expect(await denied.call()).toMatchObject({ kind: 'stopped' });
    expect(denied.execute).not.toHaveBeenCalled();
    expect(denied.journal.state.attempts).toBe(0);
  });
  test('authorization is rechecked after every deferred attempt', async () => {
    const h = setup();
    h.execute.mockResolvedValue({ kind: 'transient', reason: 'network' });
    await h.call(); h.at(h.journal.state.nextAt); h.authorize.mockResolvedValue(false);
    await h.call();
    expect(h.authorize).toHaveBeenCalledTimes(2);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  test('only one concurrent claim consumes an attempt', async () => {
    const h = setup();
    const state = structuredClone(h.state);
    const results = await Promise.all([1, 2].map(() => h.run({ state, journal: h.journal, execute: h.execute, authorize: h.authorize })));
    expect(results.map(r => r.kind).sort()).toEqual(['conflict', 'success']);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.journal.state.attempts).toBe(1);
  });
  test('identity, sender/body snapshot and policy cannot be changed between attempts', async () => {
    const h = setup();
    h.execute.mockResolvedValue({ kind: 'transient', reason: 'http', status: 503 });
    await h.call(); h.at(h.journal.state.nextAt);
    for (const field of ['idempotencyKey', 'snapshotId', 'operationId'] as const) {
      const changed = structuredClone(h.journal.state);
      changed.identity[field] = 'changed';
      expect(await h.run({ state: changed, journal: h.journal, execute: h.execute, authorize: h.authorize })).toMatchObject({ kind: 'conflict' });
    }
    const changed = structuredClone(h.journal.state); changed.identity.scope.storeId = 'other';
    expect(await h.run({ state: changed, journal: h.journal, execute: h.execute, authorize: h.authorize })).toMatchObject({ kind: 'conflict' });
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  test('retry uses the same identity and snapshot; caller mutations across awaits cannot change it', async () => {
    const h = setup();
    h.execute.mockResolvedValueOnce({ kind: 'transient', reason: 'network' });
    await h.call(); h.at(h.journal.state.nextAt); await h.call();
    expect(h.journal.state).toMatchObject({ phase: 'succeeded' });
    expect(h.journal.state.reason).toBeUndefined();
    expect(h.journal.state.status).toBeUndefined();
    expect(h.execute.mock.calls.map(call => call[1])).toEqual([identity, identity]);
    const again = setup();
    const state = structuredClone(again.state);
    again.authorize.mockImplementation(async () => { state.identity.idempotencyKey = 'replaced'; return true; });
    await again.run({ state, journal: again.journal, authorize: again.authorize, execute: again.execute });
    expect(again.execute.mock.calls[0]![1].idempotencyKey).toBe('stable-key');
  });
});

describe('unknown results and durable start', () => {
  test.each(['write', 'read'] as const)('%s: success is not repeated after restart or a stale attempt', async effect => {
    const h = setup({ effect });
    await h.call();
    expect(await h.call()).toMatchObject({ kind: 'succeeded' });
    expect(await h.run({ state: h.state, journal: h.journal, execute: h.execute, authorize: h.authorize })).toMatchObject({ kind: 'conflict' });
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  test.each(['transient', 'permanent'] as const)('do not blindly retry thrown mutation errors (%s label is irrelevant)', async () => {
    const h = setup({ effect: 'write' });
    h.execute.mockRejectedValue(new Error('secret-token-in-url-and-body'));
    expect(await h.call()).toMatchObject({ kind: 'unknown', state: { attempts: 1 } });
    await h.call(); expect(h.execute).toHaveBeenCalledTimes(1);
  });
  test('start save failure sends nothing', async () => {
    const h = setup(); h.journal.failWrite = 1;
    expect(await h.call()).toMatchObject({ kind: 'storage_error' });
    expect(h.execute).not.toHaveBeenCalled();
  });
  test('external acceptance immediately before result save failure stays unknown across restart / lease reacquisition', async () => {
    const h = setup({ effect: 'write' }); h.journal.failWrite = 2;
    expect(await h.call()).toMatchObject({ kind: 'unknown', state: { reason: 'storage' } });
    expect(h.journal.state.phase).toBe('started');
    const restarted = createExternalCall({ circuits: new MemoryCircuitStore(), now: () => start + 100_000 });
    expect(await restarted({ state: h.journal.state, journal: h.journal, execute: h.execute, authorize: h.authorize })).toMatchObject({ kind: 'unknown' });
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  test('stop after durable start never resends', async () => {
    const h = setup({ effect: 'write' });
    h.journal.state = { ...h.state, phase: 'started', attempts: 1, revision: 1 };
    expect(await h.call()).toMatchObject({ kind: 'unknown' });
    expect(h.execute).not.toHaveBeenCalled();
  });
  test.each(['read', 'write'] as const)('timeout of %s covers body and ignores late success', async effect => {
    vi.useFakeTimers();
    const h = setup({ effect });
    let resolve!: (outcome: Outcome<string>) => void;
    h.execute.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = h.call();
    await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result.kind).toBe(effect === 'write' ? 'unknown' : 'deferred');
    expect(h.execute.mock.calls[0]![0].aborted).toBe(true);
    resolve({ kind: 'success', value: 'late' });
    await Promise.resolve();
    expect(h.journal.state.phase).toBe(effect === 'write' ? 'unknown' : 'ready');
  });
  test('caller cancellation before transport sends zero; cancellation after mutation start is unknown', async () => {
    const h = setup({ effect: 'write' });
    const signal = new AbortController(); signal.abort();
    expect(await h.run({ state: h.state, journal: h.journal, execute: h.execute, authorize: h.authorize, signal: signal.signal })).toMatchObject({ kind: 'stopped' });
    expect(h.execute).not.toHaveBeenCalled();
    const second = new AbortController();
    h.execute.mockImplementation(async () => { second.abort(); return new Promise(() => {}); });
    expect(await h.run({ state: h.state, journal: h.journal, execute: h.execute, authorize: h.authorize, signal: second.signal })).toMatchObject({ kind: 'unknown' });
  });
});

describe('circuit scope and staged recovery', () => {
  test('open -> zero fetches; half-open -> exactly one concurrent probe; two serial successes resume', async () => {
    let now = start;
    const store = new MemoryCircuitStore(1, 1_000);
    const first = await store.acquire(identity.scope, now); if (!first.allowed) throw new Error('expected lease');
    await store.settle(first.lease, 'failure', now);
    const h = setup({ circuits: store });
    expect(await h.call()).toMatchObject({ kind: 'deferred', reason: 'circuit', state: { attempts: 0 } });
    expect(h.execute).not.toHaveBeenCalled();
    now += 1_000;
    const admissions = await Promise.all(Array.from({ length: 20 }, () => store.acquire(identity.scope, now)));
    expect(admissions.filter(a => a.allowed)).toHaveLength(1);
    const probe = admissions.find(a => a.allowed)!; if (!probe.allowed) throw new Error('expected probe');
    await store.settle(probe.lease, 'success', now);
    const recovery = await store.acquire(identity.scope, now); if (!recovery.allowed) throw new Error('expected recovery');
    expect(recovery.lease.probe).toBe(true);
    expect((await store.acquire(identity.scope, now)).allowed).toBe(false);
    await store.settle(recovery.lease, 'success', now);
    const healthy = await store.acquire(identity.scope, now); if (!healthy.allowed) throw new Error('expected healthy');
    expect(healthy.lease.probe).toBe(false);
  });
  test('failed probe reopens; auth failure is not recovery; stale success cannot clear a newer open', async () => {
    const store = new MemoryCircuitStore(1, 1_000);
    const one = await store.acquire(identity.scope, start), stale = await store.acquire(identity.scope, start);
    if (!one.allowed || !stale.allowed) throw new Error('expected leases');
    await store.settle(one.lease, 'failure', start);
    await store.settle(stale.lease, 'success', start);
    expect((await store.acquire(identity.scope, start)).allowed).toBe(false);
    const probe = await store.acquire(identity.scope, start + 1_000); if (!probe.allowed) throw new Error('expected probe');
    await store.settle(probe.lease, 'neutral', start + 1_000);
    const auth = await store.acquire(identity.scope, start + 1_000); if (!auth.allowed) throw new Error('expected serial probe');
    expect(auth.lease.probe).toBe(true);
    await store.settle(auth.lease, 'failure', start + 1_000, start + 50_000);
    expect(await store.acquire(identity.scope, start + 2_000)).toEqual({ allowed: false, nextAt: start + 50_000 });
  });
  test.each(['accountId', 'storeId', 'destination', 'connectionId'] as const)('failure cannot bleed across %s', async key => {
    const store = new MemoryCircuitStore(1);
    const one = await store.acquire(identity.scope, start); if (!one.allowed) throw new Error('expected lease');
    await store.settle(one.lease, 'failure', start);
    expect((await store.acquire({ ...identity.scope, [key]: 'other' }, start)).allowed).toBe(true);
  });
});

describe('HTTP adapter, no live network', () => {
  test.each(['90', new Date(start + 90_000).toUTCString()])('Retry-After %s parsed as absolute lower bound', value => {
    expect(parseRetryAfter(value, start)).toBe(start + 90_000);
  });
  test('oversize numeric Retry-After cannot wrap or disappear into an early retry', () => {
    expect(parseRetryAfter('9'.repeat(400), start)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseRetryAfter('not-a-date', start)).toBeUndefined();
  });
  test.each([429, 500, 502, 503, 504, 408])('%i: reads retry, writes unknown, auth never retries', async status => {
    for (const effect of ['read', 'write'] as const) {
      const execute = createHttpAttempt({ url: 'https://provider.test/api', maxResponseBytes: 200,
        fetch: vi.fn().mockResolvedValue(new Response('secret-provider-body', { status, headers: { 'retry-after': '90' } })),
        now: () => start, interpret: async () => ({ kind: 'success', value: 'unused' }) });
      expect(await execute(new AbortController().signal, { ...identity, effect })).toMatchObject({ kind: effect === 'read' ? 'transient' : 'unknown', status, retryAt: start + 90_000 });
    }
  });
  test('explicit provider rejection can be retried without treating arbitrary keyed POST as safe', async () => {
    const execute = createHttpAttempt({ url: 'https://provider.test', method: 'POST', headers: { 'Idempotency-Key': 'key' }, maxResponseBytes: 200,
      fetch: vi.fn().mockResolvedValue(new Response('', { status: 429 })), rejectedWithoutEffect: status => status === 429,
      interpret: async () => ({ kind: 'success', value: null }) });
    expect(await execute(new AbortController().signal, { ...identity, effect: 'write' })).toMatchObject({ kind: 'transient' });
  });
  test('immutable HTTP request snapshot, manual redirects, original retry key', async () => {
    const headers = new Headers({ 'X-Line-Retry-Key': 'stable-key' });
    const body = new Uint8Array([1, 2]).buffer;
    const transport = vi.fn().mockResolvedValue(new Response('{}'));
    const execute = createHttpAttempt({ url: 'https://provider.test/path', method: 'POST', headers, body, maxResponseBytes: 100,
      fetch: transport, interpret: async r => ({ kind: 'success', value: await r.json() }) });
    headers.set('X-Line-Retry-Key', 'changed'); new Uint8Array(body)[0] = 99;
    await execute(new AbortController().signal, identity);
    const init = transport.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('X-Line-Retry-Key')).toBe('stable-key');
    expect(Array.from(new Uint8Array(init.body as ArrayBuffer))).toEqual([1, 2]);
    expect(init.redirect).toBe('manual');
  });
  test('HTTP 200 business failure and 409 interpretation are provider owned', async () => {
    for (const status of [200, 409]) {
      const execute = createHttpAttempt({ url: 'https://provider.test', maxResponseBytes: 100,
        fetch: vi.fn().mockResolvedValue(new Response('{"ok":false}', { status })),
        interpret: async () => ({ kind: 'permanent', reason: 'http', status }) });
      expect(await execute(new AbortController().signal, identity)).toMatchObject({ kind: 'permanent', status });
    }
  });
  test('body limit and stalled body cannot bypass deadline', async () => {
    const h = setup({ effect: 'write' });
    const execute = createHttpAttempt({ url: 'https://provider.test', maxResponseBytes: 1,
      fetch: vi.fn().mockResolvedValue(new Response('too big')), interpret: async () => ({ kind: 'success', value: 'bad' }) });
    expect(await h.run({ state: h.state, journal: h.journal, authorize: h.authorize, execute })).toMatchObject({ kind: 'unknown', state: { reason: 'invalid_response' } });
    vi.useFakeTimers();
    const stalled = setup();
    const slow = createHttpAttempt({ url: 'https://provider.test', maxResponseBytes: 100,
      fetch: vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }))), interpret: async () => ({ kind: 'success', value: 'bad' }) });
    const pending = stalled.run({ state: stalled.state, journal: stalled.journal, authorize: stalled.authorize, execute: slow });
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ kind: 'deferred' });
  });
  test('safe diagnostics contain no secrets, upstream body, URL, token or thrown message', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const h = setup({ effect: 'write' });
    h.execute.mockRejectedValue(new Error('SECRET-TOKEN https://provider.test/?customer=Alice'));
    const result = await h.call();
    expect(JSON.stringify(result)).not.toMatch(/SECRET|Alice|https:/);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

test('corrupted counters cannot expand the attempt budget', async () => {
  const h = setup();
  await expect(h.run({ state: { ...h.state, attempts: -1 }, journal: h.journal, execute: h.execute, authorize: h.authorize })).rejects.toThrow('state');
  expect(h.execute).not.toHaveBeenCalled();
});
