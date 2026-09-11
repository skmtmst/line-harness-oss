/*
 * 「もう一度届ける」を**失敗した直後に**押したときの道を、実物のルート＋
 * 実DB相当で当てる(#641 司令塔独立審査の差し戻し)。
 *
 * これまでの実D1試験は、やり直しを呼ぶときに `now` を +10分・+1時間へ
 * 進めていた。手順の貸出は失敗時刻+5分まで生きているので、**進めた試験は
 * 貸出が切れたあとの道しか通らない。** ところがルートは `now` を渡さず
 * 実時計を使うので、管理画面から押す実運用の道は一度も踏まれていなかった。
 * ここは `now` を一切触らず、ルートの実時計のまま押す。
 *
 * 数えるのは外部受け口への送信だけ。送信直前の安全検査が名前を引き直す
 * (本流 #1482)ぶんは DoH として分け、固定の公開IPで答える。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import {
  createMileageRewardDraft,
  publishMileageReward,
  reserveMileageRewardRedemption,
} from '@line-crm/db';

import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { scoring } from './scoring';

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function app(db: D1Database) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', owner);
    await next();
  });
  instance.route('/', scoring);
  return instance;
}

const DOH_PREFIX = 'https://cloudflare-dns.com/dns-query';

function isDohRequest(url: unknown): boolean {
  return String(url).startsWith(DOH_PREFIX);
}

function dohResponse(url: unknown): Response {
  const type = new URL(String(url)).searchParams.get('type');
  const answer = type === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [];
  return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
}

/** 外部受け口への送信だけ数える。`responder` は送信回数を受け取る。 */
function stubGlobalFetch(responder: (sends: number) => Response) {
  let sends = 0;
  globalThis.fetch = (async (url: unknown) => {
    if (isDohRequest(url)) return dohResponse(url);
    sends += 1;
    return responder(sends);
  }) as typeof globalThis.fetch;
  return { sends: () => sends };
}

function seed(testDb: SqliteD1): void {
  const raw: Database.Database = testDb.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('account-1', 'channel-1', '公式A', 'token', 'secret', 1, 'tenant-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'オーナー', 'owner', 'key-owner-1', 'tenant-1', 'all')`,
  ).run();
  raw.prepare(`INSERT INTO users (id, display_name) VALUES ('user-1', '利用者A')`).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, picture_url, user_id, line_account_id)
     VALUES ('friend-1', 'U1', '利用者A', NULL, 'user-1', 'account-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO mileage_ledger
       (id, program_id, beneficiary_user_id, beneficiary_friend_id, entry_type, status,
        amount, reason, source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
     VALUES ('grant-1', 'default', 'user-1', 'friend-1', 'grant', 'available',
             1000, '初期付与', 'test', 'event-1', 'grant-1', '{}',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  ).run();
  raw.prepare(
    `INSERT INTO outgoing_webhooks (id, name, url, line_account_id, is_active)
     VALUES ('webhook-1', '外部受け口', 'https://example.com/hook', 'account-1', 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO common_actions (id, line_account_id, name, status)
     VALUES ('action-1', 'account-1', '交換後の送信', 'published')`,
  ).run();
  raw.prepare(
    `INSERT INTO common_action_versions
       (id, common_action_id, version_number, status, action_config, published_at)
     VALUES ('action-version-1', 'action-1', 1, 'published',
             '[{"id":"w1","type":"send_webhook","params":{"webhookId":"webhook-1"},"onFailure":"stop"}]',
             '2026-08-01T00:00:00.000Z')`,
  ).run();
}

async function seedReward(db: D1Database): Promise<string> {
  const draft = await createMileageRewardDraft(db, {
    lineAccountId: 'account-1',
    draft: {
      name: '外部特典', rewardKind: 'template', requiredMiles: 300,
      commonActionVersionId: 'action-version-1',
    },
  });
  return (await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' })).id;
}

interface ListBody {
  data?: {
    items: Array<{ id: string; attemptCount: number; failureMessage: string | null; status: string }>;
    pagination: { total: number };
  };
}

interface RetryBody { success: boolean; data?: { status: string; message: string | null } }

/**
 * 実物のルートで交換を作り、外部受け口の500で `delivery_failed` にする。
 * `now` は触らない。ルートと同じ実時計のまま失敗させる。
 */
async function failedRedemption(
  target: ReturnType<typeof app>,
  db: D1Database,
  rewardId: string,
): Promise<string> {
  const reserved = await reserveMileageRewardRedemption(db, {
    lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
    idempotencyKey: 'realtime-1', requestFingerprint: 'fp-realtime-1',
  });
  const first = await target.request(
    `/api/mileage/redemptions/${reserved.redemption.id}/retry-fulfillment`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-1' }),
    },
  );
  // 予約直後は reserved なので、失敗させるのは deliver を直に通す必要がある。
  // ルートは失敗中しか受け付けないため、ここは 409 で構わない。
  expect([200, 202, 409]).toContain(first.status);
  return reserved.redemption.id;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('失敗直後のやり直し(実時計・実D1・実ルート)', () => {
  it('失敗した直後に押すと実際に送信が走り、直れば成功する', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const target = app(testDb.db);
    const rewardId = await seedReward(testDb.db);

    // 1回目は受け口が断る。2回目からは受け付ける。
    const net = stubGlobalFetch((sends) => (sends === 1
      ? new Response('ng', { status: 500 })
      : new Response('{}', { status: 200 })));

    const { deliverMileageReward } = await import('../services/mileage-reward-delivery.js');
    const reserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'realtime-ok', requestFingerprint: 'fp-realtime-ok',
    });
    // 初回配送。`now` を渡さない=実時計。
    const failed = await deliverMileageReward(testDb.db, reserved.redemption.id, {});
    expect(failed.status).toBe('delivery_failed');
    expect(net.sends()).toBe(1);

    // 一覧に理由つきで出ている。
    const listed = await target.request('/api/mileage/redemptions?accountId=account-1');
    expect((await listed.json() as ListBody).data?.items.map((item) => item.id))
      .toEqual([reserved.redemption.id]);

    // **失敗した直後に押す。時計は進めない。**
    const retried = await target.request(
      `/api/mileage/redemptions/${reserved.redemption.id}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-1' }),
      },
    );
    const body = await retried.json() as RetryBody;
    // 送信が実際に走る。空振りしない。
    expect(net.sends()).toBe(2);
    expect(retried.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { status: 'succeeded' } });
    expect(testDb.raw.prepare(
      `SELECT status, attempt_count AS attemptCount FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'succeeded', attemptCount: 2 });
    // 残高は予約の1回だけ減る。
    expect(testDb.raw.prepare(
      `SELECT available FROM mileage_wallets
        WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    // 直ったので失敗の一覧からは消える。全件では残る。
    expect((await (await target.request(
      '/api/mileage/redemptions?accountId=account-1',
    )).json() as ListBody).data?.pagination.total).toBe(0);
    expect((await (await target.request(
      '/api/mileage/redemptions?accountId=account-1&status=all',
    )).json() as ListBody).data?.items[0]).toMatchObject({ status: 'succeeded', attemptCount: 2 });
  });

  it('失敗直後に押して再び失敗しても一覧から消えず、押した記録が残る', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const target = app(testDb.db);
    const rewardId = await seedReward(testDb.db);
    // 受け口はいつも断る。
    const net = stubGlobalFetch(() => new Response('ng', { status: 500 }));

    const { deliverMileageReward } = await import('../services/mileage-reward-delivery.js');
    const reserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'realtime-ng', requestFingerprint: 'fp-realtime-ng',
    });
    await deliverMileageReward(testDb.db, reserved.redemption.id, {});
    expect(net.sends()).toBe(1);

    // **失敗した直後に押す。** 送信が走り、失敗のまま一覧に残る。
    const retried = await target.request(
      `/api/mileage/redemptions/${reserved.redemption.id}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-1' }),
      },
    );
    expect(net.sends()).toBe(2);
    expect(retried.status).toBe(202);
    const body = await retried.json() as RetryBody;
    // 送っていないのに「送信は終わっています」と言わない。
    expect(body.data?.message ?? '').not.toContain('送信は終わっています');

    const listed = await (await target.request(
      '/api/mileage/redemptions?accountId=account-1',
    )).json() as ListBody;
    // 追跡が切れない。行は残り、押した記録(試行回数・理由)が更新されている。
    expect(listed.data?.pagination.total).toBe(1);
    expect(listed.data?.items[0]).toMatchObject({
      id: reserved.redemption.id, status: 'delivery_failed', attemptCount: 2,
    });
    expect(listed.data?.items[0].failureMessage ?? '').not.toBe('');
    expect(testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemption_attempts WHERE redemption_id = ?`,
    ).get(reserved.redemption.id)).toEqual({ count: 2 });
  });

  it('失敗直後の連打でも毎回送信が走り、行が消えない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const target = app(testDb.db);
    const rewardId = await seedReward(testDb.db);
    const net = stubGlobalFetch(() => new Response('ng', { status: 500 }));

    const { deliverMileageReward } = await import('../services/mileage-reward-delivery.js');
    const reserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'realtime-burst', requestFingerprint: 'fp-realtime-burst',
    });
    await deliverMileageReward(testDb.db, reserved.redemption.id, {});

    for (const expected of [2, 3]) {
      const response = await target.request(
        `/api/mileage/redemptions/${reserved.redemption.id}/retry-fulfillment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: 'account-1' }),
        },
      );
      expect(response.status).toBe(202);
      expect(net.sends()).toBe(expected);
      const listed = await (await target.request(
        '/api/mileage/redemptions?accountId=account-1',
      )).json() as ListBody;
      expect(listed.data?.items[0]).toMatchObject({
        id: reserved.redemption.id, status: 'delivery_failed', attemptCount: expected,
      });
    }
  });

  it('失敗直後の同時2本でも送信は1回だけ増え、行は消えない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const target = app(testDb.db);
    const rewardId = await seedReward(testDb.db);
    const net = stubGlobalFetch(() => new Response('ng', { status: 500 }));

    const { deliverMileageReward } = await import('../services/mileage-reward-delivery.js');
    const reserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'realtime-race', requestFingerprint: 'fp-realtime-race',
    });
    await deliverMileageReward(testDb.db, reserved.redemption.id, {});
    expect(net.sends()).toBe(1);

    const press = () => target.request(
      `/api/mileage/redemptions/${reserved.redemption.id}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-1' }),
      },
    );
    const [a, b] = await Promise.all([press(), press()]);
    expect([a.status, b.status].sort()).toEqual([202, 202]);
    // 同時でも外部へ届くのは1回だけ。
    expect(net.sends()).toBe(2);
    const listed = await (await target.request(
      '/api/mileage/redemptions?accountId=account-1',
    )).json() as ListBody;
    expect(listed.data?.items[0]).toMatchObject({
      id: reserved.redemption.id, status: 'delivery_failed',
    });
  });

  it('別の走者が本当に送信中なら送らずに譲るが、行は失敗のまま残す', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const target = app(testDb.db);
    const rewardId = await seedReward(testDb.db);
    const net = stubGlobalFetch(() => new Response('ng', { status: 500 }));

    const { deliverMileageReward } = await import('../services/mileage-reward-delivery.js');
    const { claimRedemptionStep } = await import('@line-crm/db');
    const reserved = await reserveMileageRewardRedemption(testDb.db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId,
      idempotencyKey: 'realtime-busy', requestFingerprint: 'fp-realtime-busy',
    });
    await deliverMileageReward(testDb.db, reserved.redemption.id, {});
    expect(net.sends()).toBe(1);

    // 別の走者が生きた貸出を持っている状態を作る。証言は消してある
    // (=送っていないことは決まっている)が、貸出だけ生きている。
    const now = new Date().toISOString();
    await claimRedemptionStep(testDb.db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      idempotencyKey: 'busy-key', owner: 'runner-x', fenceToken: 'fence-x',
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), now,
    });
    testDb.raw.prepare(
      `UPDATE mileage_redemption_step_deliveries SET needs_reconcile = 0
        WHERE redemption_id = ?`,
    ).run(reserved.redemption.id);

    const retried = await target.request(
      `/api/mileage/redemptions/${reserved.redemption.id}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-1' }),
      },
    );
    expect(retried.status).toBe(202);
    const body = await retried.json() as RetryBody;
    // 送っていない。送ったとは言わない。
    expect(net.sends()).toBe(1);
    expect(body.data?.message ?? '').not.toContain('送信は終わっています');
    // 行は失敗のまま残る。一覧から消さない。
    expect(testDb.raw.prepare(
      `SELECT status FROM mileage_redemptions WHERE id = ?`,
    ).get(reserved.redemption.id)).toEqual({ status: 'delivery_failed' });
    const listed = await (await target.request(
      '/api/mileage/redemptions?accountId=account-1',
    )).json() as ListBody;
    expect(listed.data?.pagination.total).toBe(1);
    // もう一度押せる(409で閉じ込められない)。
    const again = await target.request(
      `/api/mileage/redemptions/${reserved.redemption.id}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-1' }),
      },
    );
    expect(again.status).not.toBe(409);
  });
});
