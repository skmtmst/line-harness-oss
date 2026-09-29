/*
 * ECから届く会員ランク・マイル（`membership`）の写し方を実D1で固定する（★V6 37-1）。
 *  1. membership が届いたら、その値を正にする（通年・ライフタイム・ランク・残高）
 *  2. 届いていない（EC未対応）ときは暫定として足し算の累計と残高だけを追い、ランクキーは触らない
 *  3. 一度ECのランクが入った友だちは、古い形のイベントで上書きされない
 */
import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

vi.mock('../services/nen-tag-sync.js', () => ({ syncNenEcTags: vi.fn(), syncNenPetTags: vi.fn() }));
vi.mock('../services/nen-engagement.js', () => ({ enqueuePostShippingFollowUps: vi.fn() }));

const { syncMemberSnapshot } = await import('./ec-integrations.js');

let sql: Database.Database;
let db: D1Database;
const NOW = '2026-09-16 10:00:00';

beforeEach(() => {
  const created = createTestD1();
  sql = created.raw;
  db = created.db;
  sql.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '然', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, created_at, updated_at)
    VALUES ('friend-a', 'U-a', '山田', 'account-a', 1, '2026-09-01', '2026-09-01');
  `);
});

const snapshot = () => sql.prepare(`SELECT * FROM nen_ec_member_snapshots WHERE friend_id = 'friend-a'`).get() as Record<string, unknown>;

describe('syncMemberSnapshot membership', () => {
  it('membership が届いたらその値を正にする', async () => {
    await syncMemberSnapshot(db, 'friend-a', {
      event_id: 'e1', event_type: 'ec.customer.profile_updated', occurred_at: '2026-09-16T09:00:00+09:00', customer_id: 10231,
      order_history: [],
      membership: {
        annual_miles_yen: 138_600, lifetime_miles_yen: 412_300, member_rank_key: 'platinum', member_rank_name: 'プラチナ',
        mile_rate_percent: 3, rank_valid_until: '2027-12-31', mile_balance: 2_840, miles_used_this_month: 500, last_purchased_at: '2026-09-12',
      },
    }, NOW);
    const row = snapshot();
    expect(row).toMatchObject({
      customer_id: '10231', annual_miles_yen: 138_600, lifetime_miles_yen: 412_300, member_rank_key: 'platinum',
      member_rank: 'プラチナ', mile_rate_percent: 3, rank_valid_until: '2027-12-31', mile_balance: 2_840,
      miles_used_this_month: 500, last_purchased_at: '2026-09-12',
    });
  });

  it('membership が無い注文イベントは暫定の累計・残高だけを追い、ランクキーは触らない', async () => {
    await syncMemberSnapshot(db, 'friend-a', {
      event_id: 'e2', event_type: 'ec.order.confirmed', occurred_at: '2026-09-16T09:00:00+09:00', customer_id: 10231,
      order: { number: 'N-1', total: 5_960 },
    }, NOW);
    expect(snapshot()).toMatchObject({
      purchase_amount: 5_960, lifetime_miles_yen: 5_960, annual_miles_yen: 0, member_rank_key: null,
      last_purchased_at: '2026-09-16T09:00:00+09:00',
    });
  });

  it('一度ECのランクが入った友だちは、古い形のイベントで上書きされない', async () => {
    await syncMemberSnapshot(db, 'friend-a', {
      event_id: 'e3', event_type: 'ec.customer.profile_updated', occurred_at: '2026-09-16T09:00:00+09:00', customer_id: 10231,
      order_history: [], membership: { annual_miles_yen: 72_400, lifetime_miles_yen: 96_800, member_rank_key: 'gold', member_rank_name: 'ゴールド', mile_rate_percent: 2, mile_balance: 1_120 },
    }, NOW);
    await syncMemberSnapshot(db, 'friend-a', {
      event_id: 'e4', event_type: 'ec.order.confirmed', occurred_at: '2026-09-17T09:00:00+09:00', customer_id: 10231,
      order: { number: 'N-2', total: 3_000 },
    }, NOW);
    expect(snapshot()).toMatchObject({ annual_miles_yen: 72_400, lifetime_miles_yen: 96_800, member_rank_key: 'gold', mile_balance: 1_120 });
  });
});
