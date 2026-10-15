import { describe, expect, it } from 'vitest';
import { UBER_SANDBOX_HOSTS } from './uber-eats-hosts.js';
import {
  UBER_PROBE_COOLDOWN_MS,
  UBER_PROBE_SECRET_MIN_LENGTH,
  probeUberSandboxToken,
  uberProbeReadiness,
  uberProbeSecret,
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

/**
 * 合言葉の読み取り。
 *
 * 配備先で「秘密設定の名前はあるのに未設定と返る」ときに、
 * 「値が届いていない」のか「短すぎる」のかを分けて返せることを確かめる。
 */
describe('接続確認の口の合言葉', () => {
  const LONG = 'probe-secret-0123456789abcdefghij';

  it('値が届いていないときは、届いていないと分かる符号を返す', () => {
    for (const value of [undefined, '', '   ']) {
      expect(uberProbeSecret({ ...sandboxEnv, RT_DELIVERY_UBEREATS_PROBE_SECRET: value })).toEqual({
        ok: false,
        code: 'probe_secret_missing',
      });
    }
  });

  it('下限より短いときは、短いと分かる符号を返す。値は返さない', () => {
    const short = 'x'.repeat(UBER_PROBE_SECRET_MIN_LENGTH - 1);
    const state = uberProbeSecret({ ...sandboxEnv, RT_DELIVERY_UBEREATS_PROBE_SECRET: short });
    expect(state).toEqual({ ok: false, code: 'probe_secret_too_short' });
    expect(JSON.stringify(state)).not.toContain(short);
  });

  it('下限を満たすときは前後の空白を落として渡す', () => {
    expect(LONG.length).toBeGreaterThanOrEqual(UBER_PROBE_SECRET_MIN_LENGTH);
    expect(uberProbeSecret({ ...sandboxEnv, RT_DELIVERY_UBEREATS_PROBE_SECRET: ` ${LONG}\n` })).toEqual({
      ok: true,
      secret: LONG,
    });
  });
});

/**
 * 下見の答え。Uber へは送らないので、トークンの口の回数も冷却時間も使わない。
 * 返すのは接続先の名と設定の有無だけで、ID・秘密値は返さない。
 */
describe('接続確認の口の下見', () => {
  it('Sandbox 向けで設定が揃っているときは、そのまま伝える', () => {
    const readiness = uberProbeReadiness(sandboxEnv);
    expect(readiness).toEqual({ environment: 'sandbox', oauthConfigured: true });
    expect(JSON.stringify(readiness)).not.toContain(SECRET);
    expect(JSON.stringify(readiness)).not.toContain('test-client-id');
  });

  it('本番向けのときは Sandbox とは言わない', () => {
    expect(uberProbeReadiness({ ...sandboxEnv, RT_DELIVERY_UBEREATS_ENVIRONMENT: 'production' })).toEqual({
      environment: 'other',
      oauthConfigured: true,
    });
  });

  // 書き間違いは本番へ落とさず接続先を決めないので、設定も揃っていない扱いになる。
  it('接続先の書き間違いは分からないとして返す', () => {
    expect(uberProbeReadiness({ ...sandboxEnv, RT_DELIVERY_UBEREATS_ENVIRONMENT: 'stg' })).toEqual({
      environment: 'unknown',
      oauthConfigured: false,
    });
  });

  it('ID・秘密値が足りないときは、揃っていないと返す', () => {
    expect(uberProbeReadiness({ ...sandboxEnv, RT_DELIVERY_UBEREATS_CLIENT_SECRET: undefined })).toEqual({
      environment: 'sandbox',
      oauthConfigured: false,
    });
  });
});
