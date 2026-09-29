/*
 * 失敗した交換の「追跡」と「やり直し」が、統括(tenant)と店(account)の壁を
 * 越えないことを、本物の SQLite で確かめる(#641)。
 *
 * 手書きモックだと「WHERE に店が入っているか」を確かめられない。ここは
 * 実物の `scoring` ルートを実 D1 に載せ、
 *   - 別の店の交換が一覧に出ないこと
 *   - 許された店の名前を添えても、別の店の交換IDは単票で見えず、
 *     やり直しも通らないこと（行が動いていないことで確かめる）
 *   - 別統括の店は名前を知っていても 404 になること
 *   - 担当店だけのスタッフには担当外の店が 404 になること
 * を当てる。境界を落とす逆変異で赤になる形にしている。
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  createMileageRewardDraft,
  importMileageRewardCodes,
  publishMileageReward,
  recordMileageRedemptionAttempt,
  reserveMileageRewardRedemption,
} from '@line-crm/db';

import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { scoring } from './scoring';

const tenantOwner: AuthenticatedStaff = {
  id: 'owner-1', name: '統括1のオーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

const otherTenantOwner: AuthenticatedStaff = {
  id: 'owner-2', name: '統括2のオーナー', role: 'owner', readOnly: false, tenantId: 'tenant-2',
};

const scopedAdmin: AuthenticatedStaff = {
  id: 'admin-scoped', name: '店1だけの管理者', role: 'admin', readOnly: false, tenantId: 'tenant-1',
};

function app(db: D1Database, staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', scoring);
  return instance;
}

function seedTenants(testDb: SqliteD1): void {
  const raw = testDb.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
  for (const [id, tenant, label] of [
    ['account-1', 'tenant-1', '公式A'],
    ['account-2', 'tenant-1', '公式B'],
    ['account-3', 'tenant-2', '公式C'],
  ]) {
    raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, label, tenant);
  }
  // 担当店だけのスタッフ。account-1 しか割り当てない。
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('admin-scoped', '店1だけの管理者', 'admin', 'key-scoped', 'tenant-1', 'accounts')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('admin-scoped', 'account-1', '2026-09-01T00:00:00.000Z')`,
  ).run();
  // 統括1のオーナーは範囲の絞り込みを持たない。
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', '統括1のオーナー', 'owner', 'key-owner-1', 'tenant-1', 'all')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-2', '統括2のオーナー', 'owner', 'key-owner-2', 'tenant-2', 'all')`,
  ).run();
}

/** 店ごとに、失敗中の交換を1件作る。 */
async function seedFailedRedemption(
  testDb: SqliteD1,
  accountId: string,
  suffix: string,
): Promise<string> {
  const raw = testDb.raw;
  raw.prepare(`INSERT INTO users (id, display_name) VALUES (?, ?)`)
    .run(`user-${suffix}`, `利用者${suffix}`);
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, picture_url, user_id, line_account_id)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(`friend-${suffix}`, `U-${suffix}`, `利用者${suffix}`, `user-${suffix}`, accountId);
  raw.prepare(
    `INSERT INTO mileage_ledger
       (id, program_id, beneficiary_user_id, beneficiary_friend_id, entry_type, status,
        amount, reason, source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
     VALUES (?, 'default', ?, ?, 'grant', 'available', 1000, '初期付与', 'test', ?, ?, '{}',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  ).run(
    `grant-${suffix}`, `user-${suffix}`, `friend-${suffix}`,
    `event-${suffix}`, `grant-${suffix}`,
  );

  const draft = await createMileageRewardDraft(testDb.db, {
    lineAccountId: accountId,
    draft: { name: `${suffix}の500円引き`, rewardKind: 'coupon', requiredMiles: 300 },
  });
  await importMileageRewardCodes(testDb.db, {
    rewardId: draft.id,
    lineAccountId: accountId,
    codes: [{ ciphertext: `encrypted-${suffix}`, fingerprint: `fingerprint-${suffix}` }],
  });
  await publishMileageReward(testDb.db, { id: draft.id, lineAccountId: accountId });
  const reserved = await reserveMileageRewardRedemption(testDb.db, {
    lineAccountId: accountId,
    friendId: `friend-${suffix}`,
    rewardId: draft.id,
    idempotencyKey: `redeem-${suffix}`,
    requestFingerprint: `fp-${suffix}`,
  });
  await recordMileageRedemptionAttempt(testDb.db, {
    redemptionId: reserved.redemption.id,
    status: 'failed',
    errorCode: 'reward_delivery_failed',
    errorMessage: '特典を渡せませんでした',
  });
  return reserved.redemption.id;
}

interface ListBody {
  success: boolean;
  data?: { items: Array<{ id: string; failureMessage: string | null; attemptCount: number }> };
}

/** 行が動いていない=やり直しが実際に走っていない、の観測。 */
function redemptionRow(testDb: SqliteD1, id: string) {
  return testDb.raw.prepare(
    `SELECT status, attempt_count AS attemptCount FROM mileage_redemptions WHERE id = ?`,
  ).get(id);
}

describe('失敗した交換の追跡とやり直しの店境界(実D1)', () => {
  it('自分の店の失敗だけを理由つきで返し、別の店の交換は混ぜない', async () => {
    const testDb = createTestD1();
    seedTenants(testDb);
    const mine = await seedFailedRedemption(testDb, 'account-1', 'a1');
    const theirs = await seedFailedRedemption(testDb, 'account-2', 'a2');
    const target = app(testDb.db, tenantOwner);

    const listed = await target.request('/api/mileage/redemptions?accountId=account-1');
    expect(listed.status).toBe(200);
    const body = await listed.json() as ListBody;
    expect(body.data?.items.map((item) => item.id)).toEqual([mine]);
    // 追跡になっている: どの交換がなぜ何回失敗したかが行から分かる。
    expect(body.data?.items[0]).toMatchObject({
      failureMessage: '特典を渡せませんでした', attemptCount: 1,
    });
    // 別の店の交換IDは、どこにも出てこない。
    expect(JSON.stringify(body)).not.toContain(theirs);
  });

  it('許された店の名前を添えても、別の店の交換は見えずやり直せない', async () => {
    const testDb = createTestD1();
    seedTenants(testDb);
    await seedFailedRedemption(testDb, 'account-1', 'a1');
    const theirs = await seedFailedRedemption(testDb, 'account-2', 'a2');
    const target = app(testDb.db, tenantOwner);
    const before = redemptionRow(testDb, theirs);

    // 単票。account-1 は見られる店だが、交換は account-2 のもの。
    const detail = await target.request(
      `/api/mileage/redemptions/${theirs}?accountId=account-1`,
    );
    expect(detail.status).toBe(404);

    // やり直し。通ると別の店の特典を配ってしまう。
    const retried = await target.request(
      `/api/mileage/redemptions/${theirs}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-1' }),
      },
    );
    expect(retried.status).toBe(404);
    // 配送が走っていないことを行で確かめる。試行回数も状態も動かない。
    expect(redemptionRow(testDb, theirs)).toEqual(before);
    expect(testDb.raw.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemption_step_deliveries`,
    ).get()).toEqual({ count: 0 });
  });

  it('別統括の店は名前を知っていても一覧・やり直しとも404', async () => {
    const testDb = createTestD1();
    seedTenants(testDb);
    const outside = await seedFailedRedemption(testDb, 'account-3', 'a3');
    const target = app(testDb.db, tenantOwner);
    const before = redemptionRow(testDb, outside);

    expect((await target.request('/api/mileage/redemptions?accountId=account-3')).status).toBe(404);
    expect((await target.request(
      `/api/mileage/redemptions/${outside}?accountId=account-3`,
    )).status).toBe(404);
    const retried = await target.request(
      `/api/mileage/redemptions/${outside}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-3' }),
      },
    );
    expect(retried.status).toBe(404);
    expect(redemptionRow(testDb, outside)).toEqual(before);

    // 持ち主の統括からは見え、やり直しの門も店の壁では止まらない。
    const owner = app(testDb.db, otherTenantOwner);
    const visible = await owner.request('/api/mileage/redemptions?accountId=account-3');
    expect(visible.status).toBe(200);
    expect((await visible.json() as ListBody).data?.items.map((item) => item.id))
      .toEqual([outside]);
  });

  it('担当店だけのスタッフには担当外の店が404', async () => {
    const testDb = createTestD1();
    seedTenants(testDb);
    const mine = await seedFailedRedemption(testDb, 'account-1', 'a1');
    const theirs = await seedFailedRedemption(testDb, 'account-2', 'a2');
    const target = app(testDb.db, scopedAdmin);
    const before = redemptionRow(testDb, theirs);

    const listed = await target.request('/api/mileage/redemptions?accountId=account-1');
    expect(listed.status).toBe(200);
    expect((await listed.json() as ListBody).data?.items.map((item) => item.id)).toEqual([mine]);

    expect((await target.request('/api/mileage/redemptions?accountId=account-2')).status).toBe(404);
    const retried = await target.request(
      `/api/mileage/redemptions/${theirs}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'account-2' }),
      },
    );
    expect(retried.status).toBe(404);
    expect(redemptionRow(testDb, theirs)).toEqual(before);
  });

  it('店を渡さない一覧・やり直しは通らない', async () => {
    const testDb = createTestD1();
    seedTenants(testDb);
    const mine = await seedFailedRedemption(testDb, 'account-1', 'a1');
    const target = app(testDb.db, tenantOwner);
    const before = redemptionRow(testDb, mine);

    expect((await target.request('/api/mileage/redemptions')).status).toBe(404);
    const retried = await target.request(
      `/api/mileage/redemptions/${mine}/retry-fulfillment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(retried.status).toBe(404);
    expect(redemptionRow(testDb, mine)).toEqual(before);
  });
});
