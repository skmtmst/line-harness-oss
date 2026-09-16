/*
 * LIFF マイページ（★V6 37-2）に出す会員ランク・マイル（`membership`）を実D1で固定する。
 *  1. ECからランクが届いている友だちは、その値（通年・ランク・還元率・残高）を返す
 *  2. 届いていない友だちは、設定のしきい値と暫定の累計（購入額の足し算）からランクを求める
 *  3. 連携前（スナップショット無し）はレギュラー・0
 *  4. 呼び名は「マイル」。応答に「ポイント」という文字を含めない
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const liffAuth = vi.hoisted(() => ({
  verifyCallerLineIdentity: vi.fn(),
  verifyCallerLineUserId: vi.fn(),
}));
vi.mock('../services/liff-auth.js', () => liffAuth);
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));

const { nenMembers } = await import('./nen-members.js');

let sql: Database.Database;
let db: D1Database;

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  sql.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-nen', 'channel-nen', '然', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at) VALUES
      ('friend-a', 'U-a', '山田 太郎', 'account-nen', 1, '2026-09-01', '2026-09-01'),
      ('friend-b', 'U-b', '鈴木 一郎', 'account-nen', 1, '2026-09-01', '2026-09-01'),
      ('friend-c', 'U-c', '新しい人', 'account-nen', 1, '2026-09-01', '2026-09-01');
    INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, purchase_count, purchase_amount, point_balance, member_rank, synced_at,
      annual_miles_yen, lifetime_miles_yen, member_rank_key, mile_rate_percent, mile_balance, rank_valid_until) VALUES
      ('friend-a', '10877', 5, 96800, 1120, 'ゴールド', '2026-09-16', 72400, 96800, 'gold', 2, 1120, '2027-12-31'),
      ('friend-b', '11402', 3, 34200, 640, '会員', '2026-09-16', 0, 0, NULL, NULL, 0, NULL);
  `);
});

function app(lineUserId: string) {
  liffAuth.verifyCallerLineIdentity.mockResolvedValue({ lineUserId, lineAccountId: 'account-nen' });
  const harness = new Hono<any>();
  harness.use('*', async (c, next) => { c.env = { DB: db }; await next(); });
  harness.route('/', nenMembers);
  return harness;
}

async function member(lineUserId: string) {
  const res = await app(lineUserId).request('/api/liff/nen/member', { headers: { Authorization: 'Bearer token' } });
  expect(res.status).toBe(200);
  return res.json() as Promise<any>;
}

describe('GET /api/liff/nen/member membership', () => {
  it('ECからランクが届いている友だちはその値を返す', async () => {
    const body = await member('U-a');
    expect(body.data.membership).toMatchObject({
      rankKey: 'gold', rankName: 'ゴールド', mileRatePercent: 2, annualMilesYen: 72_400, lifetimeMilesYen: 96_800, mileBalance: 1_120,
      validUntil: '2027-12-31', next: { name: 'プラチナ', thresholdYen: 120_000, remainingYen: 47_600 },
    });
    expect(body.data.membership.ranks.map((r: any) => r.thresholdYen)).toEqual([0, 30_000, 60_000, 120_000]);
    expect(body.data.membership.nextMilestone).toMatchObject({ thresholdYen: 300_000, title: 'NEN FAMILY', remainingYen: 203_200 });
    expect(JSON.stringify(body.data.membership)).not.toContain('ポイント');
  });

  it('ECのランク未着の友だちは、設定のしきい値と暫定の累計からランクを求める', async () => {
    const body = await member('U-b');
    expect(body.data.membership).toMatchObject({ rankKey: 'silver', rankName: 'シルバー', mileRatePercent: 1.5, annualMilesYen: 34_200, lifetimeMilesYen: 34_200, mileBalance: 640 });
  });

  it('連携前の友だちはレギュラーで 0', async () => {
    const body = await member('U-c');
    expect(body.data.membership).toMatchObject({ rankKey: 'regular', rankName: 'レギュラー', annualMilesYen: 0, lifetimeMilesYen: 0, mileBalance: 0, next: { name: 'シルバー' } });
  });
});
