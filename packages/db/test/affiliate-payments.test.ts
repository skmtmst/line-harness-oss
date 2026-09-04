import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { getAffiliatePaymentSummaries } from '../src/affiliate-payments.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async all<T>() {
              return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('getAffiliatePaymentSummaries', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT);
      CREATE TABLE affiliates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
        commission_rate REAL NOT NULL, friend_id TEXT, hold_days INTEGER, payout_cycle TEXT
      );
      CREATE TABLE conversion_points (id TEXT PRIMARY KEY, value INTEGER);
      CREATE TABLE affiliate_offers (
        id TEXT PRIMARY KEY, reward_amount INTEGER NOT NULL, line_account_id TEXT
      );
      CREATE TABLE affiliate_links (
        id TEXT PRIMARY KEY, affiliate_id TEXT NOT NULL, ref_code TEXT NOT NULL UNIQUE,
        line_account_id TEXT, offer_id TEXT
      );
      CREATE TABLE conversion_events (
        id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL, friend_id TEXT NOT NULL,
        affiliate_id TEXT, affiliate_code TEXT, attributed_ref_code TEXT,
        approval_status TEXT, approved_at TEXT, value_snapshot REAL
      );
      INSERT INTO friends VALUES ('friend-1', 'account-1'), ('friend-2', 'account-2');
      INSERT INTO conversion_points VALUES ('purchase', 99999);
    `);
    db = asD1(sqlite);
  });

  test('割合方式と定額方式を選択中アカウントの承認済み成果だけから集計する', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES
        ('rate', '割合さん', 'rate-code', 10, NULL, 0, '月末締め'),
        ('fixed', '定額さん', 'fixed-code', 0, NULL, 0, NULL);
      INSERT INTO affiliate_offers VALUES ('offer-fixed', 3000, 'account-1');
      INSERT INTO affiliate_links VALUES ('link-fixed', 'fixed', 'fixed-ref', 'account-1', 'offer-fixed');
      INSERT INTO conversion_events VALUES
        ('rate-approved', 'purchase', 'friend-1', 'rate', NULL, NULL, 'approved', '2026-09-01T00:00:00Z', 10000),
        ('rate-pending', 'purchase', 'friend-1', 'rate', NULL, NULL, 'pending', NULL, 10000),
        ('fixed-approved', 'purchase', 'friend-1', 'fixed', NULL, 'fixed-ref', 'approved', '2026-09-01T00:00:00Z', 10000);
    `);

    const rows = await getAffiliatePaymentSummaries(db, 'account-1', '2026-09-04T00:00:00Z');
    expect(rows.find((row) => row.affiliateId === 'rate')).toMatchObject({
      approvedConversions: 1,
      approvedReward: 1000,
    });
    expect(rows.find((row) => row.affiliateId === 'fixed')).toMatchObject({
      approvedConversions: 1,
      approvedReward: 3000,
    });
  });

  test('別アカウントの紹介者名と成果金額を返さない', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES
        ('mine', '自店', 'mine-code', 10, 'friend-1', 0, NULL),
        ('other', '他店', 'other-code', 10, 'friend-2', 0, NULL);
      INSERT INTO conversion_events VALUES
        ('mine-cv', 'purchase', 'friend-1', 'mine', NULL, NULL, 'approved', '2026-09-01T00:00:00Z', 1000),
        ('other-cv', 'purchase', 'friend-2', 'other', NULL, NULL, 'approved', '2026-09-01T00:00:00Z', 50000);
    `);

    const rows = await getAffiliatePaymentSummaries(db, 'account-1', '2026-09-04T00:00:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ affiliateId: 'mine', approvedReward: 100 });
  });

  test('保留期間内と承認日時が無い成果を区別し、成果なしは実値0を返す', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES
        ('held', '保留あり', 'held-code', 10, 'friend-1', 7, '毎月末締め'),
        ('empty', '成果なし', 'empty-code', 0, 'friend-1', NULL, NULL);
      INSERT INTO conversion_events VALUES
        ('recent', 'purchase', 'friend-1', 'held', NULL, NULL, 'approved', '2026-09-03T00:00:00Z', 10000),
        ('old', 'purchase', 'friend-1', 'held', NULL, NULL, 'approved', '2026-08-01T00:00:00Z', 10000),
        ('unknown', 'purchase', 'friend-1', 'held', NULL, NULL, 'approved', NULL, 10000);
    `);

    const rows = await getAffiliatePaymentSummaries(db, 'account-1', '2026-09-04T00:00:00Z');
    expect(rows.find((row) => row.affiliateId === 'held')).toMatchObject({
      approvedConversions: 3,
      approvedReward: 3000,
      heldConversions: 1,
      heldReward: 1000,
      holdStatusUnknown: 1,
    });
    expect(rows.find((row) => row.affiliateId === 'empty')).toMatchObject({
      approvedConversions: 0,
      approvedReward: 0,
      heldConversions: 0,
      heldReward: 0,
      holdStatusUnknown: 0,
    });
  });
});
