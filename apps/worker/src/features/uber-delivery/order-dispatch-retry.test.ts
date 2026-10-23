import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryEnv } from '../../services/restaurant-delivery.js';
import type { FetchLike } from '../../services/uber-eats.js';
import { UBER_PRODUCTION_HOSTS } from '../../services/uber-eats-hosts.js';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { runUberOrderMutation, type UberMutationOrder, type UberOrderMutationInput } from './order-dispatch.js';

const NOW = 1_760_000_000;
const TENANT = '00000000-0000-4000-8000-000000000001';
const STORE = { id: 'retry-store', lineAccountId: 'retry-account' };
const ORDER: UberMutationOrder = {
  id: 'retry-order', account_id: STORE.lineAccountId, store_id: STORE.id, service: 'ubereats',
  external_order_id: 'uber-retry-order', status: 'new', version: 1,
};
const ENV: DeliveryEnv & { LINE_CREDENTIAL_ENCRYPTION_KEY: string } = {
  RT_DELIVERY_SEND_ENABLED: 'true',
  RT_DELIVERY_UBEREATS_CLIENT_ID: 'retry-client',
  RT_DELIVERY_UBEREATS_CLIENT_SECRET: 'retry-secret',
  LINE_CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

let sqlite: SqliteD1;

function seed(): void {
  sqlite.raw.prepare(`UPDATE tenants SET status = 'active', feature_packs = '["restaurant"]' WHERE id = ?`).run(TENANT);
  sqlite.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, 'retry-channel', 'Retry', 'token', 'secret', 1, ?)`).run(STORE.lineAccountId, TENANT);
  sqlite.raw.prepare(`INSERT INTO rt_organizations (id, account_id, tenant_id, name)
    VALUES ('retry-org', ?, ?, 'Retry')`).run(STORE.lineAccountId, TENANT);
  sqlite.raw.prepare(`INSERT INTO rt_stores
    (id, organization_id, name, code, status, line_account_id)
    VALUES (?, 'retry-org', 'Retry', 'RETRY', 'active', ?)`).run(STORE.id, STORE.lineAccountId);
  sqlite.raw.prepare(`INSERT INTO rt_delivery_orders
    (id, account_id, store_id, service, external_order_id, order_number, status,
     total_amount, currency, item_count, received_at, version, created_at, updated_at)
    VALUES (?, ?, ?, 'ubereats', ?, '#RETRY', 'new', 1000, 'JPY', 1, ?, 1, ?, ?)`)
    .run(ORDER.id, ORDER.account_id, ORDER.store_id, ORDER.external_order_id, NOW, NOW, NOW);
  sqlite.raw.prepare(`INSERT INTO rt_delivery_uber_connections
    (store_id, account_id, uber_store_id, status, provisioned_at, version, created_at, updated_at)
    VALUES (?, ?, 'uber-retry-store', 'connected', ?, 1, ?, ?)`)
    .run(STORE.id, STORE.lineAccountId, NOW * 1000, NOW * 1000, NOW * 1000);
}

function tokenResponse(): Response {
  return Response.json({
    access_token: 'retry-access-token',
    expires_in: 3600,
    scope: 'eats.order eats.store.orders.read',
    token_type: 'Bearer',
  });
}

function request(fetcher: FetchLike, overrides: Partial<UberOrderMutationInput> = {}): UberOrderMutationInput {
  return { db: sqlite.db, env: ENV, store: STORE, order: ORDER, action: 'accept', to: 'cooking',
    timeColumn: 'accepted_at', now: NOW, fetcher, ...overrides };
}

function transport(statuses: number[]) {
  let actionCalls = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
    const status = statuses[Math.min(actionCalls, statuses.length - 1)] ?? 204;
    actionCalls += 1;
    return new Response(null, { status });
  }) as unknown as FetchLike;
  return { fetcher, actionCalls: () => actionCalls };
}

function dispatch(): Record<string, unknown> | undefined {
  return sqlite.raw.prepare(`SELECT action, status, error_code, attempts, next_attempt_at, completed_at
    FROM rt_delivery_dispatches WHERE target_id = ?`).get(ORDER.id) as Record<string, unknown> | undefined;
}

function dbAfterRetryClaim(mutate: () => void): D1Database {
  const originalPrepare = sqlite.db.prepare.bind(sqlite.db);
  return {
    prepare(sql: string) {
      const prepared = originalPrepare(sql);
      if (!sql.includes("SET status = 'pending', error_code = 'delivery_result_unknown', attempts = attempts + 1")) {
        return prepared;
      }
      return {
        ...prepared,
        bind(...values: unknown[]) {
          const bound = prepared.bind(...values);
          return {
            ...bound,
            async run() {
              const result = await bound.run();
              mutate();
              return result;
            },
          } as unknown as D1PreparedStatement;
        },
      } as unknown as D1PreparedStatement;
    },
    batch: sqlite.db.batch.bind(sqlite.db),
  } as unknown as D1Database;
}

beforeEach(() => { sqlite = createTestD1(); seed(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); sqlite.raw.close(); });

describe('Uber Eats 429 bounded retry', () => {
  it('期限到来までPOSTせず、60秒後の同一操作だけを再送して成功する', async () => {
    const remote = transport([429, 204]);
    await expect(runUberOrderMutation(request(remote.fetcher))).resolves.toMatchObject({
      ok: false, error: { code: 'delivery_rate_limited' }, nextAttemptAt: NOW + 60,
    });
    expect(dispatch()).toMatchObject({ status: 'retryable_failed', attempts: 1, next_attempt_at: NOW + 60 });

    await expect(runUberOrderMutation(request(remote.fetcher, { now: NOW + 59 }))).resolves.toMatchObject({
      ok: false, error: { code: 'delivery_rate_limited' }, nextAttemptAt: NOW + 60,
    });
    expect(remote.actionCalls()).toBe(1);
    await expect(runUberOrderMutation(request(remote.fetcher, { now: NOW + 60 }))).resolves.toEqual({ ok: true });
    expect(remote.actionCalls()).toBe(2);
    expect(dispatch()).toMatchObject({ status: 'succeeded', attempts: 2, next_attempt_at: null });
    expect(sqlite.raw.prepare('SELECT status, version FROM rt_delivery_orders WHERE id = ?').get(ORDER.id))
      .toEqual({ status: 'cooking', version: 2 });
  });

  it('同時に期限到来した再試行でも外部POSTは1回だけ増える', async () => {
    const first = transport([429]);
    await runUberOrderMutation(request(first.fetcher));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let retryPosts = 0;
    const retryFetch = vi.fn(async () => {
      retryPosts += 1;
      entered();
      await gate;
      return new Response(null, { status: 204 });
    }) as unknown as FetchLike;

    const winner = runUberOrderMutation(request(retryFetch, { now: NOW + 60 }));
    await started;
    const contender = await runUberOrderMutation(request(retryFetch, { now: NOW + 60 }));
    release();

    await expect(winner).resolves.toEqual({ ok: true });
    expect(contender).toMatchObject({ ok: false });
    expect(retryPosts).toBe(1);
    expect(dispatch()).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('60/300/1800秒の後退で合計4送信に制限し、失敗確定後は再送しない', async () => {
    const remote = transport([429]);
    for (const [now, next] of [
      [NOW, NOW + 60], [NOW + 60, NOW + 360], [NOW + 360, NOW + 2_160],
    ] as const) {
      await expect(runUberOrderMutation(request(remote.fetcher, { now }))).resolves.toMatchObject({
        ok: false, error: { code: 'delivery_rate_limited' }, nextAttemptAt: next,
      });
    }
    await expect(runUberOrderMutation(request(remote.fetcher, { now: NOW + 2_160 }))).resolves.toMatchObject({
      ok: false, error: { code: 'delivery_operation_failed' }, nextAttemptAt: null,
    });
    expect(dispatch()).toMatchObject({ status: 'failed', attempts: 4, next_attempt_at: null });
    await expect(runUberOrderMutation(request(remote.fetcher, { now: NOW + 9_999 }))).resolves.toMatchObject({
      ok: false, error: { code: 'delivery_operation_failed' },
    });
    expect(remote.actionCalls()).toBe(4);
  });

  it('期限到来後も別操作には予約を転用しない', async () => {
    const remote = transport([429, 204]);
    await runUberOrderMutation(request(remote.fetcher));
    const result = await runUberOrderMutation(request(remote.fetcher, {
      now: NOW + 60, action: 'reject', to: 'rejected', timeColumn: 'canceled_at', reasonCode: 'store_busy',
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_order_conflict' } });
    expect(remote.actionCalls()).toBe(1);
  });

  it.each([
    ['注文版', "UPDATE rt_delivery_orders SET version = 2 WHERE id = 'retry-order'", 'delivery_order_conflict', 2],
    ['接続版', "UPDATE rt_delivery_uber_connections SET version = 2 WHERE store_id = 'retry-store'", 'delivery_not_configured', 1],
    ['テナント所属', `INSERT INTO tenants (id, name, feature_packs)
      VALUES ('00000000-0000-4000-8000-000000000002', 'Other', '["restaurant"]');
      UPDATE rt_organizations SET tenant_id = '00000000-0000-4000-8000-000000000002'
      WHERE id = 'retry-org'`, 'delivery_not_configured', 1],
  ])('%sが変わった予約は期限到来後も送らない', async (_label, sql, code, version) => {
    const remote = transport([429, 204]);
    await runUberOrderMutation(request(remote.fetcher));
    sqlite.raw.exec(sql);
    const result = await runUberOrderMutation(request(remote.fetcher, {
      now: NOW + 60,
      order: { ...ORDER, version },
    }));
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(remote.actionCalls()).toBe(1);
  });

  it('再試行claimの直後に接続版が変わったらPOSTせず結果不明を保つ', async () => {
    const remote = transport([429, 204]);
    await runUberOrderMutation(request(remote.fetcher));
    let changed = false;
    const racingDb = dbAfterRetryClaim(() => {
      sqlite.raw.prepare(`UPDATE rt_delivery_uber_connections
        SET version = version + 1 WHERE store_id = ?`).run(STORE.id);
      changed = true;
    });

    const result = await runUberOrderMutation(request(remote.fetcher, {
      db: racingDb,
      now: NOW + 60,
    }));
    expect(changed).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(remote.actionCalls()).toBe(1);
    expect(dispatch()).toMatchObject({ status: 'pending', error_code: 'delivery_result_unknown', attempts: 2 });
  });

  it('再試行claimの直後に注文版が変わったらPOSTせず結果不明を保つ', async () => {
    const remote = transport([429, 204]);
    await runUberOrderMutation(request(remote.fetcher));
    const racingDb = dbAfterRetryClaim(() => {
      sqlite.raw.prepare('UPDATE rt_delivery_orders SET version = version + 1 WHERE id = ?').run(ORDER.id);
    });
    const result = await runUberOrderMutation(request(remote.fetcher, { db: racingDb, now: NOW + 60 }));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(remote.actionCalls()).toBe(1);
    expect(dispatch()).toMatchObject({ status: 'pending', error_code: 'delivery_result_unknown', attempts: 2 });
  });

  it('再試行claimの直後に送信停止になったらPOSTせず結果不明を保つ', async () => {
    const remote = transport([429, 204]);
    await runUberOrderMutation(request(remote.fetcher));
    const retryEnv = { ...ENV };
    const racingDb = dbAfterRetryClaim(() => { retryEnv.RT_DELIVERY_SEND_ENABLED = 'false'; });
    const result = await runUberOrderMutation(request(remote.fetcher, {
      db: racingDb,
      env: retryEnv,
      now: NOW + 60,
    }));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(remote.actionCalls()).toBe(1);
    expect(dispatch()).toMatchObject({ status: 'pending', error_code: 'delivery_result_unknown', attempts: 2 });
  });

  it.each([408, 500])('%iの結果不明は再送しない', async (status) => {
    const remote = transport([status, 204]);
    const first = await runUberOrderMutation(request(remote.fetcher));
    const second = await runUberOrderMutation(request(remote.fetcher, { now: NOW + 9_999 }));
    expect(first).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(second).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(remote.actionCalls()).toBe(1);
  });
});

describe('Uber Eats order mutation serialization', () => {
  it('トークン取得中に注文lockの所有権を失ったら送信予約も外部POSTも作らない', async () => {
    let actionCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) {
        sqlite.raw.prepare(`UPDATE rt_resource_locks SET owner_token = 'replacement-owner'
          WHERE resource_key = ?`).run(`uber-webhook-order:${ORDER.external_order_id}`);
        return tokenResponse();
      }
      actionCalls += 1;
      return new Response(null, { status: 204 });
    }) as unknown as FetchLike;
    const result = await runUberOrderMutation(request(fetcher));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_order_conflict' } });
    expect(actionCalls).toBe(0);
    expect(dispatch()).toBeUndefined();
  });

  it('トークン取得がlease期限を越えたら送信台帳も外部POSTも作らない', async () => {
    let fakeNow = NOW * 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    let actionCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) {
        fakeNow = (NOW + 61) * 1000;
        return tokenResponse();
      }
      actionCalls += 1;
      return new Response(null, { status: 204 });
    }) as unknown as FetchLike;
    const result = await runUberOrderMutation(request(fetcher));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_temporary_failure' } });
    expect(actionCalls).toBe(0);
    expect(dispatch()).toBeUndefined();
  });

  it('取消受信台帳があれば送信予約も外部POSTも作らない', async () => {
    sqlite.raw.prepare(`INSERT INTO rt_delivery_events
      (id, account_id, service, external_event_id, event_type, external_order_id,
       status, payload_json, attempts, received_at, version)
      VALUES ('cancel-tombstone', ?, 'ubereats', 'cancel-tombstone', 'orders.cancel', ?,
       'received', ?, 0, ?, 1)`).run(ORDER.account_id, ORDER.external_order_id, JSON.stringify({
      meta: { resource_id: ORDER.external_order_id, user_id: 'uber-retry-store' },
    }), NOW);
    const remote = transport([204]);
    const result = await runUberOrderMutation(request(remote.fetcher));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_order_conflict' } });
    expect(remote.actionCalls()).toBe(0);
    expect(dispatch()).toBeUndefined();
  });

  it('同一注文のwebhook lockが有効な間は外部POSTしない', async () => {
    sqlite.raw.prepare(`INSERT INTO rt_resource_locks (resource_key, owner_token, expires_at, created_at)
      VALUES (?, 'webhook-owner', ?, ?)`).run(
      `uber-webhook-order:${ORDER.external_order_id}`,
      new Date((NOW + 60) * 1000).toISOString(),
      new Date(NOW * 1000).toISOString(),
    );
    const remote = transport([204]);
    const result = await runUberOrderMutation(request(remote.fetcher));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_order_conflict' } });
    expect(remote.actionCalls()).toBe(0);
    expect(dispatch()).toBeUndefined();
  });

  it('外部応答中にlock所有権を失ったら注文を進めず結果不明にする', async () => {
    let actionCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
      actionCalls += 1;
      sqlite.raw.prepare(`UPDATE rt_resource_locks SET owner_token = 'replacement-owner'
        WHERE resource_key = ?`).run(`uber-webhook-order:${ORDER.external_order_id}`);
      return new Response(null, { status: 204 });
    }) as unknown as FetchLike;
    const result = await runUberOrderMutation(request(fetcher));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(actionCalls).toBe(1);
    expect(sqlite.raw.prepare('SELECT status, version FROM rt_delivery_orders WHERE id = ?').get(ORDER.id))
      .toEqual({ status: 'new', version: 1 });
    expect(dispatch()).toMatchObject({ status: 'pending', error_code: 'delivery_result_unknown', attempts: 1 });
  });

  it('外部応答待ちでleaseが期限切れしたら所有者が同じでも注文を進めない', async () => {
    let fakeNow = NOW * 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
      fakeNow = (NOW + 61) * 1000;
      return new Response(null, { status: 204 });
    }) as unknown as FetchLike;
    const result = await runUberOrderMutation(request(fetcher));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(sqlite.raw.prepare('SELECT status, version FROM rt_delivery_orders WHERE id = ?').get(ORDER.id))
      .toEqual({ status: 'new', version: 1 });
    expect(dispatch()).toMatchObject({ status: 'pending', error_code: 'delivery_result_unknown', attempts: 1 });
  });

  it('外部応答中に取消台帳が入ったらfinalize CASで注文を進めない', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
      sqlite.raw.prepare(`INSERT INTO rt_delivery_events
        (id, account_id, service, external_event_id, event_type, external_order_id,
         status, payload_json, attempts, received_at, version)
        VALUES ('cancel-during-post', ?, 'ubereats', 'cancel-during-post', 'orders.cancel', ?,
         'received', ?, 0, ?, 1)`).run(ORDER.account_id, ORDER.external_order_id, JSON.stringify({
        meta: { resource_id: ORDER.external_order_id, user_id: 'uber-retry-store' },
      }), NOW);
      return new Response(null, { status: 204 });
    }) as unknown as FetchLike;
    const result = await runUberOrderMutation(request(fetcher));
    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(sqlite.raw.prepare('SELECT status, version FROM rt_delivery_orders WHERE id = ?').get(ORDER.id))
      .toEqual({ status: 'new', version: 1 });
    expect(dispatch()).toMatchObject({ status: 'pending', error_code: 'delivery_result_unknown', attempts: 1 });
  });
});
