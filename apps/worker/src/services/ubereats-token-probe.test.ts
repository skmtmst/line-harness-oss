import { describe, expect, it } from 'vitest';
import { UBER_SANDBOX_HOSTS } from './uber-eats-hosts.js';
import {
  UBER_PROBE_COOLDOWN_MS,
  probeUberSandboxToken,
  type UberProbeCooldownStore,
  type UberProbeEnv,
} from './ubereats-token-probe.js';
import type { FetchLike } from './uber-eats.js';

/**
 * Uber Sandbox への接続確認（トークン1回）の試験。
 * 試験用の値はすべて作り物で、本物のID・秘密値は置かない。
 */

const SECRET = 'test-client-secret';
const NOW_MS = 1_760_000_000_000;

const sandboxEnv: UberProbeEnv = {
  RT_DELIVERY_UBEREATS_CLIENT_ID: 'test-client-id',
  RT_DELIVERY_UBEREATS_CLIENT_SECRET: SECRET,
  RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox',
  WORKER_PUBLIC_URL: 'https://stg-api.example.test',
};

function store(lastMs: number | null = null): UberProbeCooldownStore & { written: number[] } {
  const written: number[] = [];
  return {
    written,
    read: async () => lastMs,
    write: async (nowMs: number) => {
      written.push(nowMs);
    },
  };
}

function fetchFrom(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: Array<{ url: string; body: string }>;
} {
  const calls: Array<{ url: string; body: string }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: String(init?.body ?? '') });
    return handler(url, init);
  };
  return { fetch, calls };
}

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const okBody = { access_token: 'test-access-token', expires_in: 2_592_000, scope: 'eats.order' };

describe('Uber Sandbox への接続確認', () => {
  it('接続先が Sandbox でないときは送らない。本番の Uber へは行かない', async () => {
    for (const environment of [undefined, 'production']) {
      const { fetch, calls } = fetchFrom(() => tokenResponse(okBody));
      const outcome = await probeUberSandboxToken({
        env: { ...sandboxEnv, RT_DELIVERY_UBEREATS_ENVIRONMENT: environment },
        store: store(),
        fetch,
        nowMs: NOW_MS,
      });
      expect(outcome).toEqual({ kind: 'sandbox_only' });
      expect(calls).toHaveLength(0);
    }
  });

  it('接続先の書き間違い・ID未設定のときは送らず、口が開いていないと返す', async () => {
    const { fetch, calls } = fetchFrom(() => tokenResponse(okBody));
    const typo = await probeUberSandboxToken({
      env: { ...sandboxEnv, RT_DELIVERY_UBEREATS_ENVIRONMENT: 'stg' },
      store: store(),
      fetch,
      nowMs: NOW_MS,
    });
    expect(typo).toEqual({ kind: 'not_configured' });
    const missing = await probeUberSandboxToken({
      env: { ...sandboxEnv, RT_DELIVERY_UBEREATS_CLIENT_ID: undefined },
      store: store(),
      fetch,
      nowMs: NOW_MS,
    });
    expect(missing).toEqual({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('成功したら権限の名と残り秒だけを返す。トークンの値・秘密値は返さない', async () => {
    const { fetch, calls } = fetchFrom(() => tokenResponse(okBody));
    const outcome = await probeUberSandboxToken({ env: sandboxEnv, store: store(), fetch, nowMs: NOW_MS });
    expect(outcome).toEqual({ kind: 'ok', scope: ['eats.order'], expiresInSec: 2_592_000 });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(okBody.access_token);
    expect(serialized).not.toContain(SECRET);
    // 宛先は TEST APP 側の口。頼む権限は注文の受け取りひとつだけ。
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(UBER_SANDBOX_HOSTS.tokenUrl);
    expect(calls[0]?.body).toContain('grant_type=client_credentials');
    expect(calls[0]?.body).toContain('scope=eats.order');
  });

  it('冷却時間の中の2回目は送らず、待ち秒を返す', async () => {
    const { fetch, calls } = fetchFrom(() => tokenResponse(okBody));
    const outcome = await probeUberSandboxToken({
      env: sandboxEnv,
      store: store(NOW_MS - 60_000),
      fetch,
      nowMs: NOW_MS,
    });
    expect(outcome).toEqual({ kind: 'cooldown', retryAfterSec: (UBER_PROBE_COOLDOWN_MS - 60_000) / 1000 });
    expect(calls).toHaveLength(0);
  });

  it('冷却時間が明けたら送る', async () => {
    const { fetch, calls } = fetchFrom(() => tokenResponse(okBody));
    const outcome = await probeUberSandboxToken({
      env: sandboxEnv,
      store: store(NOW_MS - UBER_PROBE_COOLDOWN_MS),
      fetch,
      nowMs: NOW_MS,
    });
    expect(outcome).toMatchObject({ kind: 'ok' });
    expect(calls).toHaveLength(1);
  });

  it('断られたらHTTP状態と分類済みの符号だけを返す', async () => {
    const { fetch } = fetchFrom(() => tokenResponse({ error: 'invalid_client' }, 401));
    const outcome = await probeUberSandboxToken({ env: sandboxEnv, store: store(), fetch, nowMs: NOW_MS });
    expect(outcome).toEqual({
      kind: 'uber_error',
      status: 401,
      code: 'auth_expired',
      uberCode: 'uber_token_invalid_client',
    });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it('権限が足りないときも符号だけを返す', async () => {
    const { fetch } = fetchFrom(() => tokenResponse({ error: 'invalid_scope' }, 403));
    const outcome = await probeUberSandboxToken({ env: sandboxEnv, store: store(), fetch, nowMs: NOW_MS });
    expect(outcome).toEqual({
      kind: 'uber_error',
      status: 403,
      code: 'no_permission',
      uberCode: 'uber_token_invalid_scope',
    });
  });

  it('届かなかったときは通信の失敗として返し、本文は持たない', async () => {
    const { fetch } = fetchFrom(() => {
      throw new TypeError('fetch failed: dns error for test-host');
    });
    const outcome = await probeUberSandboxToken({ env: sandboxEnv, store: store(), fetch, nowMs: NOW_MS });
    expect(outcome).toEqual({ kind: 'network_failed' });
    expect(JSON.stringify(outcome)).not.toContain('dns');
  });

  it('送る前に時刻を残す。途中で落ちても1回分として数える', async () => {
    const counter = store();
    const { fetch } = fetchFrom(() => {
      throw new TypeError('fetch failed');
    });
    await probeUberSandboxToken({ env: sandboxEnv, store: counter, fetch, nowMs: NOW_MS });
    expect(counter.written).toEqual([NOW_MS]);
  });

  it('送らなかったときは時刻を残さない', async () => {
    const counter = store(NOW_MS - 60_000);
    const { fetch } = fetchFrom(() => tokenResponse(okBody));
    await probeUberSandboxToken({ env: sandboxEnv, store: counter, fetch, nowMs: NOW_MS });
    expect(counter.written).toEqual([]);
  });
});
