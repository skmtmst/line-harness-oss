import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryEnv } from '../../services/restaurant-delivery.js';
import { UBER_PRODUCTION_HOSTS } from '../../services/uber-eats-hosts.js';
import type { FetchLike } from '../../services/uber-eats.js';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { getUberApplicationToken } from './application-token.js';
import {
  runUberOrderMutation,
  type UberMutationOrder,
  type UberOrderMutationInput,
} from './order-dispatch.js';

const NOW = 1_760_000_000;
const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CLIENT_ID = 'synthetic-client';
const CLIENT_SECRET = 'synthetic-secret';
const TENANT = '00000000-0000-4000-8000-000000000001';
const STORE = { id: 'store-1', lineAccountId: 'account-1' };
const ENV: DeliveryEnv & { LINE_CREDENTIAL_ENCRYPTION_KEY: string } = {
  RT_DELIVERY_SEND_ENABLED: 'true',
  RT_DELIVERY_UBEREATS_CLIENT_ID: CLIENT_ID,
  RT_DELIVERY_UBEREATS_CLIENT_SECRET: CLIENT_SECRET,
  LINE_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
};
const ORDER: UberMutationOrder = {
  id: 'order-1',
  account_id: 'account-1',
  store_id: 'store-1',
  service: 'ubereats',
  external_order_id: 'uber-order-1',
  status: 'new',
  version: 1,
};

let sqlite: SqliteD1;

function seed(): void {
  sqlite.raw.prepare(`UPDATE tenants SET status = 'active', feature_packs = '["restaurant"]' WHERE id = ?`)
    .run(TENANT);
  sqlite.raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES (?, 'channel-1', '店舗', 'synthetic-line-token', 'synthetic-line-secret', 1, ?)`,
  ).run(STORE.lineAccountId, TENANT);
  sqlite.raw.prepare(
    `INSERT INTO rt_organizations (id, account_id, tenant_id, name)
     VALUES ('organization-1', ?, ?, '統括')`,
  ).run(STORE.lineAccountId, TENANT);
  sqlite.raw.prepare(
    `INSERT INTO rt_stores
       (id, organization_id, name, code, status, line_account_id)
     VALUES (?, 'organization-1', '店舗', 'STORE-1', 'active', ?)`,
  ).run(STORE.id, STORE.lineAccountId);
  sqlite.raw.prepare(
    `INSERT INTO rt_delivery_orders
       (id, account_id, store_id, service, external_order_id, order_number, status,
        total_amount, currency, item_count, received_at, version, created_at, updated_at)
     VALUES (?, ?, ?, 'ubereats', ?, '#UE-1', 'new', 1800, 'JPY', 2, ?, 1, ?, ?)`,
  ).run(ORDER.id, ORDER.account_id, ORDER.store_id, ORDER.external_order_id, NOW, NOW, NOW);
  sqlite.raw.prepare(
    `INSERT INTO rt_delivery_uber_connections
       (store_id, account_id, uber_store_id, status, provisioned_at, last_error,
        version, created_at, updated_at)
     VALUES (?, ?, 'uber-store-1', 'connected', ?, NULL, 1, ?, ?)`,
  ).run(STORE.id, STORE.lineAccountId, NOW * 1000, NOW * 1000, NOW * 1000);
}

function tokenResponse(): Response {
  return Response.json({
    access_token: 'synthetic-access-token',
    expires_in: 3600,
    scope: 'eats.order eats.store.orders.read',
    token_type: 'Bearer',
  });
}

function input(
  fetcher: FetchLike,
  overrides: Partial<Omit<UberOrderMutationInput, 'db' | 'fetcher'>> = {},
): UberOrderMutationInput {
  return {
    db: sqlite.db,
    env: ENV,
    store: STORE,
    order: ORDER,
    action: 'accept',
    to: 'cooking',
    timeColumn: 'accepted_at',
    now: NOW,
    fetcher,
    ...overrides,
  };
}

function normalFetcher(actionStatus = 204): { fetcher: FetchLike; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn(async (url: string) => {
    if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
    return new Response(null, { status: actionStatus });
  });
  return { fetcher: calls as FetchLike, calls };
}

async function warmToken(fetcher: FetchLike): Promise<void> {
  await getUberApplicationToken({
    db: sqlite.db,
    client: {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      hosts: UBER_PRODUCTION_HOSTS,
    },
    encryptionKey: ENCRYPTION_KEY,
    fetcher,
    nowMs: NOW * 1000,
  });
}

function dispatchRow(): Record<string, unknown> | undefined {
  return sqlite.raw.prepare(
    `SELECT action, status, error_code, attempts, next_attempt_at, completed_at
       FROM rt_delivery_dispatches WHERE target_id = ?`,
  ).get(ORDER.id) as Record<string, unknown> | undefined;
}

beforeEach(() => {
  sqlite = createTestD1();
  seed();
});

afterEach(() => sqlite.raw.close());

describe('Uber Eats注文操作の一送信予約', () => {
  it('accept成功時だけ注文CASと送信台帳を同じbatchで完了する', async () => {
    const { fetcher, calls } = normalFetcher();

    await expect(runUberOrderMutation(input(fetcher))).resolves.toEqual({ ok: true });

    expect(calls).toHaveBeenCalledTimes(2);
    expect(sqlite.raw.prepare(
      'SELECT status, accepted_at, version FROM rt_delivery_orders WHERE id = ?',
    ).get(ORDER.id)).toEqual({ status: 'cooking', accepted_at: NOW, version: 2 });
    expect(dispatchRow()).toEqual({
      action: 'accept',
      status: 'succeeded',
      error_code: null,
      attempts: 1,
      next_attempt_at: null,
      completed_at: NOW,
    });
  });

  it('同じ注文版のacceptとrejectが競合しても外部POSTは1回だけ', async () => {
    const tokenFetch = vi.fn(async () => tokenResponse()) as FetchLike;
    await warmToken(tokenFetch);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const actionFetch = vi.fn(async () => {
      entered();
      await gate;
      return new Response(null, { status: 204 });
    }) as FetchLike;

    const accept = runUberOrderMutation(input(actionFetch));
    await started;
    const reject = await runUberOrderMutation(input(actionFetch, {
      action: 'reject',
      to: 'rejected',
      timeColumn: 'canceled_at',
      reasonCode: 'store_busy',
    }));
    release();

    await expect(accept).resolves.toEqual({ ok: true });
    expect(reject).toMatchObject({ ok: false, error: { code: 'delivery_order_conflict' } });
    expect(actionFetch).toHaveBeenCalledTimes(1);
    expect(dispatchRow()).toMatchObject({ action: 'accept', status: 'succeeded', attempts: 1 });
  });

  it('通信結果不明はpending予約を残し、同じ注文版を再送しない', async () => {
    let mutationCalls = 0;
    let markerAtPost: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
      mutationCalls += 1;
      markerAtPost = dispatchRow();
      throw new Error('provider detail must stay private');
    }) as FetchLike;

    const first = await runUberOrderMutation(input(fetcher));
    const second = await runUberOrderMutation(input(fetcher));

    expect(first).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown', retryable: false } });
    expect(second).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown', retryable: false } });
    expect(mutationCalls).toBe(1);
    expect(markerAtPost).toMatchObject({
      status: 'pending',
      error_code: 'delivery_result_unknown',
      attempts: 1,
    });
    expect(dispatchRow()).toEqual({
      action: 'accept',
      status: 'pending',
      error_code: 'delivery_result_unknown',
      attempts: 1,
      next_attempt_at: null,
      completed_at: null,
    });
  });

  it('外部成功後に注文更新が失敗しても結果不明として再送しない', async () => {
    sqlite.raw.exec(
      `CREATE TRIGGER synthetic_order_update_failure
       BEFORE UPDATE OF status ON rt_delivery_orders
       BEGIN SELECT RAISE(ABORT, 'synthetic'); END`,
    );
    let mutationCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
      mutationCalls += 1;
      return new Response(null, { status: 204 });
    }) as FetchLike;

    const first = await runUberOrderMutation(input(fetcher));
    const second = await runUberOrderMutation(input(fetcher));

    expect(first).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(second).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(mutationCalls).toBe(1);
    expect(sqlite.raw.prepare('SELECT status, version FROM rt_delivery_orders WHERE id = ?').get(ORDER.id))
      .toEqual({ status: 'new', version: 1 });
    expect(dispatchRow()).toMatchObject({ status: 'pending', error_code: 'delivery_result_unknown', attempts: 1 });
  });

  it('外部応答中に台帳が変わったら注文だけを成功状態へ進めない', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
      sqlite.raw.prepare(
        `UPDATE rt_delivery_dispatches
            SET status = 'failed', error_code = 'delivery_operation_failed'
          WHERE target_id = ?`,
      ).run(ORDER.id);
      return new Response(null, { status: 204 });
    }) as FetchLike;

    const result = await runUberOrderMutation(input(fetcher));

    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_result_unknown' } });
    expect(sqlite.raw.prepare('SELECT status, version FROM rt_delivery_orders WHERE id = ?').get(ORDER.id))
      .toEqual({ status: 'new', version: 1 });
    expect(dispatchRow()).toMatchObject({ status: 'failed', error_code: 'delivery_operation_failed', attempts: 1 });
  });

  it('トークン取得中に接続版が変わったら古い接続では予約もPOSTもしない', async () => {
    let mutationCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) {
        sqlite.raw.prepare(
          `UPDATE rt_delivery_uber_connections
             SET uber_store_id = 'reconnected-store', version = version + 1 WHERE store_id = ?`,
        ).run(STORE.id);
        return tokenResponse();
      }
      mutationCalls += 1;
      return new Response(null, { status: 204 });
    }) as FetchLike;

    const result = await runUberOrderMutation(input(fetcher));

    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_not_configured' } });
    expect(mutationCalls).toBe(0);
    expect(dispatchRow()).toBeUndefined();
  });

  it('任意のキャンセル理由を外へ出さず、固定のotherとして保存する', async () => {
    let sentBody: string | null = null;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === UBER_PRODUCTION_HOSTS.tokenUrl) return tokenResponse();
      sentBody = String(init?.body);
      return new Response(null, { status: 200 });
    }) as FetchLike;

    await expect(runUberOrderMutation(input(fetcher, {
      action: 'cancel',
      to: 'canceled',
      timeColumn: 'canceled_at',
      reasonCode: 'provider-specific-free-text',
    }))).resolves.toEqual({ ok: true });

    expect(sentBody).toBe('{"reason":"OTHER"}');
    expect(sqlite.raw.prepare(
      'SELECT status, cancel_reason_code, canceled_by FROM rt_delivery_orders WHERE id = ?',
    ).get(ORDER.id)).toEqual({ status: 'canceled', cancel_reason_code: 'other', canceled_by: 'store' });
  });

  it('古い注文版はトークン取得も予約作成もせず競合にする', async () => {
    sqlite.raw.prepare('UPDATE rt_delivery_orders SET version = 2 WHERE id = ?').run(ORDER.id);
    const fetcher = vi.fn() as FetchLike;

    const result = await runUberOrderMutation(input(fetcher));

    expect(result).toMatchObject({ ok: false, error: { code: 'delivery_order_conflict' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(dispatchRow()).toBeUndefined();
  });

  it('送信停止または接続不足なら外部通信も予約も行わない', async () => {
    const fetcher = vi.fn() as FetchLike;
    const disabled = await runUberOrderMutation(input(fetcher, {
      env: { ...ENV, RT_DELIVERY_SEND_ENABLED: 'false' },
    }));
    sqlite.raw.prepare('DELETE FROM rt_delivery_uber_connections WHERE store_id = ?').run(STORE.id);
    const missingConnection = await runUberOrderMutation(input(fetcher));

    expect(disabled).toMatchObject({ ok: false, error: { code: 'delivery_send_disabled' } });
    expect(missingConnection).toMatchObject({ ok: false, error: { code: 'delivery_not_configured' } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(dispatchRow()).toBeUndefined();
  });

  it('停止店舗・無効アカウント・パック解除・Uber店舗ID重複を送信直前の資格外にする', async () => {
    const fetcher = vi.fn() as FetchLike;
    for (const [disable, restore] of [
      ["UPDATE rt_stores SET status = 'paused' WHERE id = 'store-1'", "UPDATE rt_stores SET status = 'active' WHERE id = 'store-1'"],
      ["UPDATE line_accounts SET is_active = 0 WHERE id = 'account-1'", "UPDATE line_accounts SET is_active = 1 WHERE id = 'account-1'"],
      [`UPDATE tenants SET feature_packs = '[]' WHERE id = '${TENANT}'`, `UPDATE tenants SET feature_packs = '["restaurant"]' WHERE id = '${TENANT}'`],
    ]) {
      sqlite.raw.exec(disable);
      await expect(runUberOrderMutation(input(fetcher))).resolves.toMatchObject({
        ok: false,
        error: { code: 'delivery_not_configured' },
      });
      sqlite.raw.exec(restore);
    }
    sqlite.raw.exec(`
      INSERT INTO rt_delivery_uber_connections
        (store_id, account_id, uber_store_id, status, provisioned_at, version, created_at, updated_at)
      VALUES ('duplicate-store', 'duplicate-account', 'uber-store-1', 'connected', ${NOW * 1000}, 1, ${NOW * 1000}, ${NOW * 1000})
    `);
    await expect(runUberOrderMutation(input(fetcher))).resolves.toMatchObject({
      ok: false,
      error: { code: 'delivery_not_configured' },
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(dispatchRow()).toBeUndefined();
  });

  it('未確認のready操作は安全に拒否し、確定4xxも再送経路を残さない', async () => {
    const unsupportedFetch = vi.fn() as FetchLike;
    const unsupported = await runUberOrderMutation(input(unsupportedFetch, {
      order: { ...ORDER, status: 'cooking' },
      action: 'ready',
      to: 'ready',
      timeColumn: 'ready_at',
    }));
    expect(unsupported).toMatchObject({ ok: false, error: { code: 'delivery_action_unsupported' } });
    expect(unsupportedFetch).not.toHaveBeenCalled();

    const { fetcher, calls } = normalFetcher(400);
    const failed = await runUberOrderMutation(input(fetcher));
    const repeated = await runUberOrderMutation(input(fetcher));
    expect(failed).toMatchObject({ ok: false, error: { code: 'delivery_operation_failed' } });
    expect(repeated).toMatchObject({ ok: false, error: { code: 'delivery_operation_failed' } });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(dispatchRow()).toMatchObject({ status: 'failed', error_code: 'delivery_operation_failed', attempts: 1 });
  });
});
