import { CredentialEncryptionKeyError, decryptCredential, encryptCredential } from '@line-crm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UBER_PRODUCTION_HOSTS, UBER_SANDBOX_HOSTS } from '../../services/uber-eats-hosts.js';
import { UberEatsError, type FetchLike } from '../../services/uber-eats.js';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { getUberApplicationToken } from './application-token.js';

const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_ENCRYPTION_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const NOW_MS = 1_760_000_000_000;
const SCOPES = 'eats.order eats.store.orders.read';

const productionClient = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  hosts: UBER_PRODUCTION_HOSTS,
};

function tokenResponse(accessToken: string, options?: { expiresIn?: number; scope?: string }): Response {
  return Response.json({
    access_token: accessToken,
    expires_in: options?.expiresIn ?? 3_600,
    scope: options?.scope ?? SCOPES,
    token_type: 'Bearer',
  });
}

function fetchSequence(responses: Response[]): { fetcher: FetchLike; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('synthetic_fetch_exhausted');
    return response;
  });
  return { fetcher: calls as FetchLike, calls };
}

function request(input: {
  d1: SqliteD1;
  fetcher: FetchLike;
  nowMs?: number;
  client?: typeof productionClient;
  encryptionKey?: string;
}) {
  return getUberApplicationToken({
    db: input.d1.db,
    client: input.client ?? productionClient,
    encryptionKey: input.encryptionKey ?? ENCRYPTION_KEY,
    fetcher: input.fetcher,
    nowMs: input.nowMs ?? NOW_MS,
  });
}

const opened: SqliteD1[] = [];
function database(): SqliteD1 {
  const d1 = createTestD1();
  opened.push(d1);
  return d1;
}

afterEach(() => {
  vi.useRealTimers();
  while (opened.length > 0) opened.pop()!.raw.close();
});

describe('Uber Eats のアプリトークン', () => {
  it('初回だけ1回取得し、有効な暗号化済みキャッシュでは外部へ送らない', async () => {
    const d1 = database();
    const { fetcher, calls } = fetchSequence([tokenResponse('synthetic-token-1')]);

    const first = await request({ d1, fetcher });
    const second = await request({ d1, fetcher, nowMs: NOW_MS + 1_000 });

    expect(first).toEqual(second);
    expect(calls).toHaveBeenCalledTimes(1);
    const row = d1.raw.prepare('SELECT access_token_enc FROM rt_delivery_uber_app_tokens').get() as {
      access_token_enc: string;
    };
    expect(row.access_token_enc).not.toContain('synthetic-token-1');
    await expect(decryptCredential(row.access_token_enc, ENCRYPTION_KEY)).resolves.toBe('synthetic-token-1');
  });

  it('短い有効期間でも小さい余裕だけを取り、期限が近づいたときに1回更新する', async () => {
    const d1 = database();
    const { fetcher, calls } = fetchSequence([
      tokenResponse('short-token-1', { expiresIn: 100 }),
      tokenResponse('short-token-2', { expiresIn: 100 }),
    ]);

    await request({ d1, fetcher });
    const stillValid = await request({ d1, fetcher, nowMs: NOW_MS + 89_000 });
    const renewed = await request({ d1, fetcher, nowMs: NOW_MS + 91_000 });
    const cachedRenewal = await request({ d1, fetcher, nowMs: NOW_MS + 173_000 });

    expect(stillValid.accessToken).toBe('short-token-1');
    expect(renewed.accessToken).toBe('short-token-2');
    expect(cachedRenewal.accessToken).toBe('short-token-2');
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('実際に返った権限が足りなければ保存せず止める', async () => {
    const d1 = database();
    const { fetcher, calls } = fetchSequence([
      tokenResponse('insufficient-token', { scope: 'eats.order' }),
    ]);

    await expect(request({ d1, fetcher })).rejects.toMatchObject({
      name: 'UberEatsError',
      kind: 'no_permission',
    });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_uber_app_tokens').get()).toEqual({ n: 0 });
  });

  it('接続先・クライアント・秘密値・暗号鍵が変わると別のキャッシュを使う', async () => {
    const d1 = database();
    const { fetcher, calls } = fetchSequence([
      tokenResponse('production-token'),
      tokenResponse('sandbox-token'),
      tokenResponse('other-client-token'),
      tokenResponse('rotated-client-token'),
      tokenResponse('rotated-key-token'),
    ]);
    const sandboxClient = { ...productionClient, hosts: UBER_SANDBOX_HOSTS };
    const otherClient = { ...productionClient, clientId: 'other-synthetic-client' };
    const rotatedClient = { ...productionClient, clientSecret: 'rotated-synthetic-secret' };

    await request({ d1, fetcher });
    await request({ d1, fetcher, client: sandboxClient });
    await request({ d1, fetcher, client: otherClient });
    await request({ d1, fetcher, client: rotatedClient });
    await request({ d1, fetcher, encryptionKey: OTHER_ENCRYPTION_KEY });
    await request({ d1, fetcher, nowMs: NOW_MS + 1_000 });

    expect(calls).toHaveBeenCalledTimes(5);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_uber_app_tokens').get()).toEqual({ n: 5 });
  });

  it('同時の空キャッシュでは1つだけが取得し、後発は待たず固定のbusyで止まる', async () => {
    const d1 = database();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const fetcher = vi.fn(async () => {
      started();
      await gate;
      return tokenResponse('winner-token');
    }) as FetchLike;

    const winner = request({ d1, fetcher });
    await entered;
    await expect(request({ d1, fetcher })).rejects.toMatchObject({
      message: 'uber_application_token_busy',
    });
    release();

    await expect(winner).resolves.toMatchObject({ accessToken: 'winner-token' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('429のあと冷却中は再送せず、冷却後に1回だけ回復する', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    const d1 = database();
    const { fetcher, calls } = fetchSequence([
      Response.json({ error: 'rate_limited', detail: 'provider-body-must-not-escape' }, { status: 429 }),
      tokenResponse('recovered-token'),
    ]);

    const firstError = await request({ d1, fetcher }).catch((error: unknown) => error);
    expect(firstError).toBeInstanceOf(UberEatsError);
    expect(String(firstError)).not.toContain('provider-body-must-not-escape');
    await expect(request({ d1, fetcher, nowMs: NOW_MS + 1_000 })).rejects.toMatchObject({
      message: 'uber_application_token_cooldown',
    });
    expect(calls).toHaveBeenCalledTimes(1);

    await expect(request({ d1, fetcher, nowMs: NOW_MS + 5 * 60_000 + 1 })).resolves.toMatchObject({
      accessToken: 'recovered-token',
    });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('取得中にリースが切れて新しい所有者へ移ったら、新しい値もロックも上書きしない', async () => {
    const d1 = database();
    const newerCiphertext = await encryptCredential('newer-token', ENCRYPTION_KEY);
    const fetcher: FetchLike = vi.fn(async () => {
      const row = d1.raw
        .prepare("SELECT resource_key, owner_token FROM rt_resource_locks WHERE resource_key LIKE 'uber-application-token-refresh:v1:%'")
        .get() as { resource_key: string; owner_token: string };
      const identity = row.resource_key.slice('uber-application-token-refresh:v1:'.length);
      const cacheId = `uber-application-token:v1:${identity}`;
      d1.raw.prepare('UPDATE rt_resource_locks SET expires_at = ? WHERE resource_key = ? AND owner_token = ?')
        .run(new Date(NOW_MS - 1).toISOString(), row.resource_key, row.owner_token);
      d1.raw.prepare(
        `INSERT INTO rt_resource_locks(resource_key, owner_token, expires_at, created_at)
         VALUES(?, 'new-owner', ?, ?)
         ON CONFLICT(resource_key) DO UPDATE SET owner_token = excluded.owner_token,
           expires_at = excluded.expires_at, created_at = excluded.created_at
         WHERE julianday(rt_resource_locks.expires_at) <= julianday(?)`,
      ).run(
        row.resource_key,
        new Date(NOW_MS + 60_000).toISOString(),
        new Date(NOW_MS).toISOString(),
        new Date(NOW_MS).toISOString(),
      );
      d1.raw.prepare(
        `INSERT INTO rt_delivery_uber_app_tokens
          (id, access_token_enc, access_token_expires_at, granted_scope, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(cacheId, newerCiphertext, NOW_MS + 3_600_000, SCOPES, NOW_MS, NOW_MS);
      return tokenResponse('stale-owner-token');
    });

    await expect(request({ d1, fetcher })).rejects.toMatchObject({
      message: 'uber_application_token_busy',
    });
    const tokenRow = d1.raw.prepare('SELECT access_token_enc FROM rt_delivery_uber_app_tokens').get() as {
      access_token_enc: string;
    };
    await expect(decryptCredential(tokenRow.access_token_enc, ENCRYPTION_KEY)).resolves.toBe('newer-token');
    expect(d1.raw.prepare("SELECT owner_token FROM rt_resource_locks WHERE resource_key LIKE 'uber-application-token-refresh:v1:%'").get())
      .toEqual({ owner_token: 'new-owner' });
  });

  it('取得中にリースが切れたら、後続所有者がまだいなくても保存しない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    const d1 = database();
    const fetcher = vi.fn(async () => {
      vi.setSystemTime(NOW_MS + 15_001);
      return tokenResponse('expired-lease-token');
    }) as FetchLike;

    await expect(request({ d1, fetcher })).rejects.toMatchObject({
      message: 'uber_application_token_busy',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_uber_app_tokens').get()).toEqual({ n: 0 });
  });

  it.each([
    ['未設定', undefined],
    ['形式不正', 'not-a-valid-key'],
  ])('暗号鍵が%sなら外部へ送る前に止める', async (_label, encryptionKey) => {
    const d1 = database();
    const fetcher = vi.fn(async () => tokenResponse('must-not-be-requested')) as FetchLike;

    await expect(getUberApplicationToken({
      db: d1.db,
      client: productionClient,
      encryptionKey,
      fetcher,
      nowMs: NOW_MS,
    })).rejects.toBeInstanceOf(CredentialEncryptionKeyError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['expires_inなし', { access_token: 'token', scope: SCOPES }],
    ['expires_inが文字', { access_token: 'token', expires_in: '3600', scope: SCOPES }],
    ['tokenなし', { expires_in: 3600, scope: SCOPES }],
    ['scopeなし', { access_token: 'token', expires_in: 3600 }],
  ])('成功応答が不正（%s）なら既定の30日を採用せず止める', async (_label, body) => {
    const d1 = database();
    const fetcher = vi.fn(async () => Response.json(body)) as FetchLike;

    await expect(request({ d1, fetcher })).rejects.toMatchObject({
      message: 'uber_application_token_invalid_response',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_uber_app_tokens').get()).toEqual({ n: 0 });
  });

  it('取得が終わる前に期限が切れたトークンは保存せず返さない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    const d1 = database();
    const fetcher = vi.fn(async () => {
      vi.setSystemTime(NOW_MS + 2_000);
      return tokenResponse('already-expired-token', { expiresIn: 1 });
    }) as FetchLike;

    await expect(request({ d1, fetcher })).rejects.toMatchObject({
      message: 'uber_application_token_invalid_response',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(d1.raw.prepare('SELECT COUNT(*) AS n FROM rt_delivery_uber_app_tokens').get()).toEqual({ n: 0 });
  });

  it('JSONでない成功応答とfetcherの自由文を外へ出さない', async () => {
    const malformedDb = database();
    const malformedFetcher = vi.fn(async () => new Response('secret provider body')) as FetchLike;
    const malformed = await request({ d1: malformedDb, fetcher: malformedFetcher }).catch((error: unknown) => error);
    expect(String(malformed)).toContain('uber_application_token_invalid_response');
    expect(String(malformed)).not.toContain('secret provider body');

    const networkDb = database();
    const networkFetcher = vi.fn(async () => { throw new Error('synthetic-client-secret leaked'); }) as FetchLike;
    const network = await request({ d1: networkDb, fetcher: networkFetcher }).catch((error: unknown) => error);
    expect(String(network)).toContain('uber_application_token_unavailable');
    expect(String(network)).not.toContain('synthetic-client-secret leaked');
  });
});
