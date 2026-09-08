import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { getAffiliatePaymentSummaries } from '../src/affiliate-payments.js';
import {
  confirmAffiliateSettlement,
  ensureConversionRewardSnapshot,
  getAffiliateArchiveImpact,
  previewAffiliateSettlement,
  updateAffiliateLifecycle,
} from '../src/affiliate-settlements.js';
import { asD1 as asFullD1 } from './d1-test-helper.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
            async first<T>() {
              return (stmt.get(...params) as T | undefined) ?? null;
            },
            async run<T>() {
              const info = stmt.run(...params);
              return { success: true, meta: { changes: info.changes }, results: [] } as T;
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
        commission_rate REAL NOT NULL, friend_id TEXT, hold_days INTEGER, payout_cycle TEXT,
        line_account_id TEXT, tenant_id TEXT
      );
      CREATE TABLE conversion_points (id TEXT PRIMARY KEY, name TEXT, value INTEGER, line_account_id TEXT);
      CREATE TABLE affiliate_offers (
        id TEXT PRIMARY KEY, name TEXT, reward_amount INTEGER NOT NULL, line_account_id TEXT
      );
      CREATE TABLE affiliate_links (
        id TEXT PRIMARY KEY, affiliate_id TEXT NOT NULL, ref_code TEXT NOT NULL UNIQUE,
        line_account_id TEXT, offer_id TEXT
      );
      CREATE TABLE conversion_events (
        id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL, friend_id TEXT NOT NULL,
        affiliate_id TEXT, affiliate_code TEXT, attributed_ref_code TEXT,
        approval_status TEXT, approved_at TEXT, value_snapshot REAL, point_name_snapshot TEXT
      );
      CREATE TABLE affiliate_reward_entries (
        id TEXT PRIMARY KEY, conversion_event_id TEXT NOT NULL, entry_type TEXT NOT NULL,
        affiliate_id TEXT, line_account_id TEXT, amount_minor INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE affiliate_reward_calculations (
        id TEXT PRIMARY KEY, organization_id TEXT, line_account_id TEXT, affiliate_id TEXT,
        conversion_event_id TEXT NOT NULL, offer_id TEXT, formula TEXT,
        commission_rate_snapshot REAL, base_amount_snapshot REAL, fixed_reward_snapshot INTEGER,
        offer_name_snapshot TEXT, amount_minor INTEGER, currency TEXT, created_at TEXT,
        UNIQUE (conversion_event_id)
      );
      INSERT INTO friends VALUES ('friend-1', 'account-1'), ('friend-2', 'account-2');
      INSERT INTO conversion_points VALUES ('purchase', '購入', 99999, 'account-1');
    `);
    db = asD1(sqlite);
  });

  test('割合方式と定額方式を選択中アカウントの承認済み成果だけから集計する', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES
        ('rate', '割合さん', 'rate-code', 10, NULL, 0, '月末締め', 'account-1', 'tenant-1'),
        ('fixed', '定額さん', 'fixed-code', 0, NULL, 0, NULL, 'account-1', 'tenant-1');
      INSERT INTO affiliate_offers VALUES ('offer-fixed', '定期便', 3000, 'account-1');
      INSERT INTO affiliate_links VALUES ('link-fixed', 'fixed', 'fixed-ref', 'account-1', 'offer-fixed');
      INSERT INTO conversion_events VALUES
        ('rate-approved', 'purchase', 'friend-1', 'rate', NULL, NULL, 'approved', '2026-09-01T00:00:00Z', 10000, NULL),
        ('rate-pending', 'purchase', 'friend-1', 'rate', NULL, NULL, 'pending', NULL, 10000, NULL),
        ('fixed-approved', 'purchase', 'friend-1', 'fixed', NULL, 'fixed-ref', 'approved', '2026-09-01T00:00:00Z', 10000, NULL);
    `);
    // 承認済みは承認時に版がある状態にする(集計は版正本)。
    await ensureConversionRewardSnapshot(db, 'rate-approved', '2026-09-01T00:00:00Z');
    await ensureConversionRewardSnapshot(db, 'fixed-approved', '2026-09-01T00:00:00Z');

    const rows = await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', '2026-09-04T00:00:00Z');
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
        ('mine', '自店', 'mine-code', 10, 'friend-1', 0, NULL, 'account-1', 'tenant-1'),
        ('other', '他店', 'other-code', 10, 'friend-2', 0, NULL, 'account-2', 'tenant-1');
      INSERT INTO conversion_events VALUES
        ('mine-cv', 'purchase', 'friend-1', 'mine', NULL, NULL, 'approved', '2026-09-01T00:00:00Z', 1000, NULL),
        ('other-cv', 'purchase', 'friend-2', 'other', NULL, NULL, 'approved', '2026-09-01T00:00:00Z', 50000, NULL);
    `);
    await ensureConversionRewardSnapshot(db, 'mine-cv', '2026-09-01T00:00:00Z');

    const rows = await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', '2026-09-04T00:00:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ affiliateId: 'mine', approvedReward: 100 });
  });

  test('承認後の設定編集で承認/保留/未確定の表示が変わらない', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES
        ('rate', '割合さん', 'rate-code', 10, NULL, 0, '月末締め', 'account-1', 'tenant-1'),
        ('fixed', '定額さん', 'fixed-code', 0, NULL, 0, NULL, 'account-1', 'tenant-1');
      INSERT INTO affiliate_offers VALUES ('offer-fixed', '定期便', 3000, 'account-1');
      INSERT INTO affiliate_links VALUES ('link-fixed', 'fixed', 'fixed-ref', 'account-1', 'offer-fixed');
      INSERT INTO conversion_events VALUES
        ('rate-approved', 'purchase', 'friend-1', 'rate', NULL, NULL, 'approved', '2026-09-01T00:00:00Z', 10000, NULL),
        ('fixed-approved', 'purchase', 'friend-1', 'fixed', NULL, 'fixed-ref', 'approved', '2026-09-01T00:00:00Z', 10000, NULL);
    `);
    await ensureConversionRewardSnapshot(db, 'rate-approved', '2026-09-01T00:00:00Z');
    await ensureConversionRewardSnapshot(db, 'fixed-approved', '2026-09-01T00:00:00Z');
    const now = '2026-09-04T00:00:00Z';
    expect((await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', now))
      .find((row) => row.affiliateId === 'rate')).toMatchObject({ approvedReward: 1000, unsettledReward: 1000 });
    sqlite.exec(`
      UPDATE affiliates SET commission_rate = 50;
      UPDATE affiliate_offers SET reward_amount = 99999;
      UPDATE conversion_points SET value = 1;
    `);
    const rows = await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', now);
    expect(rows.find((row) => row.affiliateId === 'rate')).toMatchObject({ approvedReward: 1000, unsettledReward: 1000 });
    expect(rows.find((row) => row.affiliateId === 'fixed')).toMatchObject({ approvedReward: 3000, unsettledReward: 3000 });
  });

  test('保留期間内と承認日時が無い成果を区別し、成果なしは実値0を返す', async () => {
    sqlite.exec(`
      INSERT INTO affiliates VALUES
        ('held', '保留あり', 'held-code', 10, 'friend-1', 7, '毎月末締め', 'account-1', 'tenant-1'),
        ('empty', '成果なし', 'empty-code', 0, 'friend-1', NULL, NULL, 'account-1', 'tenant-1');
      INSERT INTO conversion_events VALUES
        ('recent', 'purchase', 'friend-1', 'held', NULL, NULL, 'approved', '2026-09-03T00:00:00Z', 10000, NULL),
        ('old', 'purchase', 'friend-1', 'held', NULL, NULL, 'approved', '2026-08-01T00:00:00Z', 10000, NULL),
        ('unknown', 'purchase', 'friend-1', 'held', NULL, NULL, 'approved', NULL, 10000, NULL);
    `);
    await ensureConversionRewardSnapshot(db, 'recent', '2026-09-03T00:00:00Z');
    await ensureConversionRewardSnapshot(db, 'old', '2026-08-01T00:00:00Z');
    await ensureConversionRewardSnapshot(db, 'unknown', '2026-09-04T00:00:00Z');

    const rows = await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', '2026-09-04T00:00:00Z');
    expect(rows.find((row) => row.affiliateId === 'held')).toMatchObject({
      approvedConversions: 3,
      approvedReward: 3000,
      heldConversions: 1,
      heldReward: 1000,
      holdStatusUnknown: 1,
      unsettledConversions: 1,
      unsettledReward: 1000,
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

describe('紹介停止と支払い確定の追記台帳', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY, tenant_id TEXT);
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT);
      CREATE TABLE affiliates (
        id TEXT PRIMARY KEY, tenant_id TEXT, line_account_id TEXT, name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE, commission_rate REAL NOT NULL, is_active INTEGER NOT NULL,
        friend_id TEXT, hold_days INTEGER, payout_cycle TEXT, created_at TEXT
      );
      CREATE TABLE conversion_points (
        id TEXT PRIMARY KEY, name TEXT, value INTEGER, line_account_id TEXT
      );
      CREATE TABLE affiliate_offers (
        id TEXT PRIMARY KEY, name TEXT, reward_amount INTEGER NOT NULL, line_account_id TEXT
      );
      CREATE TABLE affiliate_links (
        id TEXT PRIMARY KEY, affiliate_id TEXT NOT NULL, ref_code TEXT NOT NULL UNIQUE,
        line_account_id TEXT, offer_id TEXT, is_active INTEGER NOT NULL
      );
      CREATE TABLE conversion_events (
        id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL, friend_id TEXT NOT NULL,
        affiliate_id TEXT, affiliate_code TEXT, attributed_ref_code TEXT,
        approval_status TEXT, approved_at TEXT, value_snapshot REAL, point_name_snapshot TEXT
      );
      INSERT INTO tenants VALUES ('tenant-1');
      INSERT INTO line_accounts VALUES ('account-1', 'tenant-1');
    `);
    sqlite.exec(readFileSync(new URL('../migrations/293_affiliate_settlements.sql', import.meta.url), 'utf8'));
    // 本番schemaでは318で付く列。個別確定の指紋照合が読むためここで足す。
    sqlite.exec(`ALTER TABLE affiliate_settlements ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT ''`);
    sqlite.exec(readFileSync(new URL('../migrations/349_affiliate_settlement_snapshot.sql', import.meta.url), 'utf8'));
    sqlite.exec(`
      INSERT INTO friends VALUES ('friend-1', 'account-1');
      INSERT INTO affiliates
        (id, tenant_id, line_account_id, name, code, commission_rate, is_active,
         friend_id, hold_days, payout_cycle, created_at)
      VALUES ('affiliate-1', 'tenant-1', 'account-1', '合同会社ノース', 'north', 0, 1,
              'friend-1', 0, '月末締め', '2026-08-01T00:00:00Z');
      INSERT INTO conversion_points VALUES ('purchase', '購入', 0, 'account-1');
      INSERT INTO affiliate_offers VALUES ('offer-1', '定期便', 5000, 'account-1');
      INSERT INTO affiliate_links VALUES ('link-1', 'affiliate-1', 'north', 'account-1', 'offer-1', 1);
      INSERT INTO conversion_events VALUES
        ('cv-1', 'purchase', 'friend-1', 'affiliate-1', NULL, 'north', 'approved', '2026-08-01T00:00:00Z', 12000, '購入'),
        ('cv-2', 'purchase', 'friend-1', 'affiliate-1', NULL, 'north', 'approved', '2026-08-02T00:00:00Z', 15000, '購入'),
        ('cv-pending', 'purchase', 'friend-1', 'affiliate-1', NULL, 'north', 'pending', NULL, 15000, '購入');
    `);
    db = asFullD1(sqlite);
    // 承認済みfixtureは承認時に版がある状態にする(締めは版だけを使う)。
    await ensureConversionRewardSnapshot(db, 'cv-1', '2026-08-01T00:00:00Z');
    await ensureConversionRewardSnapshot(db, 'cv-2', '2026-08-02T00:00:00Z');
  });

  test('影響件数を返し、物理削除せず停止状態へ変える', async () => {
    const impact = await getAffiliateArchiveImpact(db, {
      tenantId: 'tenant-1', affiliateId: 'affiliate-1', lineAccountId: 'account-1',
      now: '2026-09-06T00:00:00Z',
    });
    expect(impact).toMatchObject({
      activeLinks: 1, unsettledConversions: 2, unsettledReward: 10000, pendingConversions: 1,
    });

    expect(await updateAffiliateLifecycle(db, {
      tenantId: 'tenant-1', affiliateId: 'affiliate-1', lineAccountId: 'account-1', lifecycle: 'paused',
      now: '2026-09-06T00:00:00Z',
    })).toBe(true);
    expect(sqlite.prepare('SELECT is_active, lifecycle_status FROM affiliates WHERE id = ?').get('affiliate-1'))
      .toEqual({ is_active: 0, lifecycle_status: 'paused' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM conversion_events').get()).toEqual({ count: 3 });
  });

  test('プレビューの金額を追記で固定し、同じ再試行を二重計上しない', async () => {
    const preview = await previewAffiliateSettlement(db, {
      tenantId: 'tenant-1', affiliateId: 'affiliate-1', lineAccountId: 'account-1', now: '2026-09-06T00:00:00Z',
    });
    expect(preview).toMatchObject({
      amount: 10000,
      conversionCount: 2,
      breakdown: [{ offerName: '定期便', conversions: 2, unitReward: 5000, subtotal: 10000 }],
    });

    const input = {
      tenantId: 'tenant-1', lineAccountId: 'account-1', affiliateId: 'affiliate-1',
      actorId: 'staff-1', idempotencyKey: 'settlement-key-1', expectedAmount: 10000,
      now: '2026-09-06T00:00:00Z',
    };
    expect(await confirmAffiliateSettlement(db, input)).toMatchObject({ kind: 'created', amount: 10000 });
    sqlite.prepare('UPDATE affiliate_offers SET reward_amount = 9999 WHERE id = ?').run('offer-1');
    expect(await confirmAffiliateSettlement(db, input)).toMatchObject({ kind: 'duplicate', amount: 10000 });
    expect(await confirmAffiliateSettlement(db, { ...input, idempotencyKey: 'settlement-key-2' }))
      .toEqual({ kind: 'empty' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM affiliate_settlements').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT state FROM affiliate_settlements').get()).toEqual({ state: 'partial' });
    expect(sqlite.prepare('SELECT SUM(amount_minor) AS amount FROM affiliate_settlement_lines').get())
      .toEqual({ amount: 10000 });
  });

  test('表示後に金額が変わったら確定せず読み直しを求める', async () => {
    expect(await confirmAffiliateSettlement(db, {
      tenantId: 'tenant-1', lineAccountId: 'account-1', affiliateId: 'affiliate-1',
      actorId: 'staff-1', idempotencyKey: 'settlement-stale-1', expectedAmount: 9999,
      now: '2026-09-06T00:00:00Z',
    })).toEqual({ kind: 'changed' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM affiliate_settlements').get()).toEqual({ count: 0 });
  });

  test('確定済み表示は台帳を優先し、確定後の設定編集で変わらない', async () => {
    sqlite.exec(`UPDATE conversion_events SET approval_status = 'pending', approved_at = NULL WHERE id = 'cv-2'`);
    expect(await confirmAffiliateSettlement(db, {
      tenantId: 'tenant-1', lineAccountId: 'account-1', affiliateId: 'affiliate-1',
      actorId: 'staff-1', idempotencyKey: 'summary-key-1', expectedAmount: 5000,
      now: '2026-09-06T00:00:00Z',
    })).toMatchObject({ kind: 'created', amount: 5000 });
    sqlite.exec(
      `UPDATE conversion_events SET approval_status = 'approved', approved_at = '2026-08-02T00:00:00Z' WHERE id = 'cv-2'`,
    );

    let rows = await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', '2026-09-06T00:00:00Z');
    expect(rows.find((row) => row.affiliateId === 'affiliate-1')).toMatchObject({
      settledConversions: 1, settledReward: 5000, unsettledConversions: 1, unsettledReward: 5000,
    });

    sqlite.exec(`UPDATE affiliate_offers SET reward_amount = 99999 WHERE id = 'offer-1'`);

    rows = await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', '2026-09-06T00:00:00Z');
    expect(rows.find((row) => row.affiliateId === 'affiliate-1')).toMatchObject({
      settledConversions: 1, settledReward: 5000, unsettledConversions: 1, unsettledReward: 5000,
    });
  });

  test('別アカウントの確定分を確定済み表示へ混ぜない', async () => {
    sqlite.exec(`
      INSERT INTO line_accounts VALUES ('account-2', 'tenant-1');
      INSERT INTO friends VALUES ('friend-2', 'account-2');
      INSERT INTO affiliates
        (id, tenant_id, line_account_id, name, code, commission_rate, is_active,
         friend_id, hold_days, payout_cycle, created_at)
      VALUES ('affiliate-2', 'tenant-1', 'account-2', '別店', 'other', 0, 1,
              'friend-2', 0, NULL, '2026-08-01T00:00:00Z');
      INSERT INTO conversion_points VALUES ('purchase-2', '購入', 0, 'account-2');
      INSERT INTO affiliate_offers VALUES ('offer-2', '別店商品', 7000, 'account-2');
      INSERT INTO affiliate_links VALUES ('link-2', 'affiliate-2', 'other', 'account-2', 'offer-2', 1);
      INSERT INTO conversion_events VALUES
        ('cv-other', 'purchase-2', 'friend-2', 'affiliate-2', NULL, 'other',
         'approved', '2026-08-03T00:00:00Z', 20000, '購入');
    `);
    await ensureConversionRewardSnapshot(db, 'cv-other', '2026-08-03T00:00:00Z');
    expect(await confirmAffiliateSettlement(db, {
      tenantId: 'tenant-1', lineAccountId: 'account-2', affiliateId: 'affiliate-2',
      actorId: 'staff-1', idempotencyKey: 'summary-key-other', expectedAmount: 7000,
      now: '2026-09-06T00:00:00Z',
    })).toMatchObject({ kind: 'created', amount: 7000 });

    const rows1 = await getAffiliatePaymentSummaries(db, 'account-1', 'tenant-1', '2026-09-06T00:00:00Z');
    expect(rows1.find((row) => row.affiliateId === 'affiliate-2')).toBeUndefined();
    expect(rows1.find((row) => row.affiliateId === 'affiliate-1')).toMatchObject({
      settledConversions: 0, settledReward: 0,
    });

    const rows2 = await getAffiliatePaymentSummaries(db, 'account-2', 'tenant-1', '2026-09-06T00:00:00Z');
    expect(rows2.find((row) => row.affiliateId === 'affiliate-1')).toBeUndefined();
    expect(rows2.find((row) => row.affiliateId === 'affiliate-2')).toMatchObject({
      settledConversions: 1, settledReward: 7000,
    });
  });

  test('他テナントからは集計が見えない', async () => {
    const rows = await getAffiliatePaymentSummaries(db, 'account-1', 'other-tenant', '2026-09-06T00:00:00Z');
    expect(rows).toEqual([]);
  });
});
