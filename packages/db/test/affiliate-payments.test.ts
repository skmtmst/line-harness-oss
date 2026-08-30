import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { getAffiliatePaymentSummaries } from '../src/affiliate-payments.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
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
      CREATE TABLE affiliates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        commission_rate REAL NOT NULL,
        hold_days INTEGER,
        payout_cycle TEXT
      );
      CREATE TABLE conversion_points (
        id TEXT PRIMARY KEY,
        value INTEGER
      );
      CREATE TABLE affiliate_offers (
        id TEXT PRIMARY KEY,
        reward_amount INTEGER NOT NULL
      );
      CREATE TABLE affiliate_links (
        id TEXT PRIMARY KEY,
        affiliate_id TEXT NOT NULL,
        ref_code TEXT NOT NULL UNIQUE,
        offer_id TEXT
      );
      CREATE TABLE conversion_events (
        id TEXT PRIMARY KEY,
        conversion_point_id TEXT NOT NULL,
        affiliate_id TEXT,
        affiliate_code TEXT,
        attributed_ref_code TEXT,
        approval_status TEXT,
        approved_at TEXT
      );
    `);
    db = asD1(sqlite);
  });

  test('割合方式と定額方式を承認済み成果だけから集計する', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES ('rate', '割合さん', 'rate-code', 10, 0, '月末締め');
      INSERT INTO affiliates VALUES ('fixed', '定額さん', 'fixed-code', 0, 0, NULL);
      INSERT INTO conversion_points VALUES ('purchase', 10000);
      INSERT INTO affiliate_offers VALUES ('offer-fixed', 3000);
      INSERT INTO affiliate_links VALUES ('link-fixed', 'fixed', 'fixed-ref', 'offer-fixed');
      INSERT INTO conversion_events VALUES
        ('rate-approved', 'purchase', 'rate', NULL, NULL, 'approved', datetime('now')),
        ('rate-pending', 'purchase', 'rate', NULL, NULL, 'pending', NULL),
        ('fixed-approved', 'purchase', 'fixed', NULL, 'fixed-ref', 'approved', datetime('now')),
        ('fixed-rejected', 'purchase', 'fixed', NULL, 'fixed-ref', 'rejected', datetime('now'));
    `);

    const rows = await getAffiliatePaymentSummaries(db);
    expect(rows.find((row) => row.affiliateId === 'rate')).toMatchObject({
      approvedConversions: 1,
      approvedReward: 1000,
    });
    expect(rows.find((row) => row.affiliateId === 'fixed')).toMatchObject({
      approvedConversions: 1,
      approvedReward: 3000,
    });
  });

  test('保留期間内と承認日時が無い成果を別々に返す', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES ('fixed', '定額さん', 'fixed-code', 0, 7, '毎月末締め');
      INSERT INTO conversion_points VALUES ('purchase', 10000);
      INSERT INTO affiliate_offers VALUES ('offer-fixed', 3000);
      INSERT INTO affiliate_links VALUES ('link-fixed', 'fixed', 'fixed-ref', 'offer-fixed');
      INSERT INTO conversion_events VALUES
        ('recent', 'purchase', 'fixed', NULL, 'fixed-ref', 'approved', datetime('now', '-1 day')),
        ('old', 'purchase', 'fixed', NULL, 'fixed-ref', 'approved', datetime('now', '-20 days')),
        ('unknown', 'purchase', 'fixed', NULL, 'fixed-ref', 'approved', NULL);
    `);

    const [row] = await getAffiliatePaymentSummaries(db);
    expect(row).toMatchObject({
      approvedConversions: 3,
      approvedReward: 9000,
      heldConversions: 1,
      heldReward: 3000,
      holdStatusUnknown: 1,
    });
  });

  test('成果が無い紹介者は実値0を返す', async () => {
    sqlite.exec(`INSERT INTO affiliates VALUES ('empty', '成果なし', 'empty-code', 0, NULL, NULL);`);
    const [row] = await getAffiliatePaymentSummaries(db);
    expect(row).toMatchObject({
      approvedConversions: 0,
      approvedReward: 0,
      heldConversions: 0,
      heldReward: 0,
      holdStatusUnknown: 0,
    });
  });
});
