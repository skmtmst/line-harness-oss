import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  confirmAffiliateSettlement,
  ensureConversionRewardSnapshot,
  previewAffiliateSettlement,
} from '../src/affiliate-settlements.js';
import { setConversionApproval } from '../src/affiliate-offers.js';
import { asD1 } from './d1-test-helper.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
let sqlite: Database.Database;
let db: D1Database;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run('account-1', 'channel-1', '本店', TENANT_ID);
  sqlite.exec(`
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U1', '田中', 'account-1'), ('friend-2', 'U2', '佐藤', 'account-1');
    INSERT INTO affiliates
      (id, name, code, commission_rate, friend_id, tenant_id, line_account_id, hold_days)
    VALUES
      ('affiliate-rate', '割合さん', 'rate-code', 10, 'friend-1', '${TENANT_ID}', 'account-1', 0),
      ('affiliate-fixed', '定額さん', 'fixed-code', 0, 'friend-2', '${TENANT_ID}', 'account-1', 0);
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', '2026-08-01', '2026-08-01');
    INSERT INTO affiliate_offers (id, name, reward_amount, line_account_id, created_at)
    VALUES ('offer-1', '定期便', 3000, 'account-1', '2026-08-01');
    INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
    VALUES ('link-1', 'affiliate-fixed', 'ref-1', 'account-1', 'offer-1', '2026-08-01');
    INSERT INTO conversion_events
      (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
       approval_status, approved_at, value_snapshot)
    VALUES
      ('conversion-rate-1', 'point-1', 'friend-1', 'affiliate-rate', NULL,
       'approved', '2026-08-10T00:00:00.000Z', 10000),
      ('conversion-fixed-1', 'point-1', 'friend-1', 'affiliate-fixed', 'ref-1',
       'approved', '2026-08-10T00:00:00.000Z', 10000);
  `);
  db = asD1(sqlite);
  // 承認済みfixtureは承認時に版がある状態にする(本番の承認フローと移行の前提)。
  await ensureConversionRewardSnapshot(db, 'conversion-rate-1', '2026-08-10T00:00:00.000Z');
  await ensureConversionRewardSnapshot(db, 'conversion-fixed-1', '2026-08-10T00:00:00.000Z');
});

function confirmRate(key: string, expectedAmount = 1000) {
  return confirmAffiliateSettlement(db, {
    tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-rate',
    actorId: 'staff-1', idempotencyKey: key, expectedAmount,
    now: '2026-09-01T00:00:00.000Z',
  });
}

describe('migration 349 承認済み報酬の版固定', () => {
  it('確定時に金額と計算根拠を保存し、entryへ紐付ける', async () => {
    const created = await confirmRate('settle-rate-1');
    expect(created).toMatchObject({ kind: 'created', amount: 1000, conversionCount: 1 });

    const calc = sqlite.prepare('SELECT * FROM affiliate_reward_calculations').get() as Record<string, unknown>;
    expect(calc).toMatchObject({
      formula: 'rate', commission_rate_snapshot: 10, base_amount_snapshot: 10000,
      fixed_reward_snapshot: null, amount_minor: 1000, currency: 'JPY',
    });
    const entry = sqlite.prepare('SELECT * FROM affiliate_reward_entries').get() as Record<string, unknown>;
    expect(entry).toMatchObject({ amount_minor: 1000, reward_calculation_id: calc.id });

    const fixed = await confirmAffiliateSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-fixed',
      actorId: 'staff-1', idempotencyKey: 'settle-fixed-1', expectedAmount: 3000,
      now: '2026-09-01T00:00:00.000Z',
    });
    expect(fixed).toMatchObject({ kind: 'created', amount: 3000 });
    const fixedCalc = sqlite.prepare(
      "SELECT * FROM affiliate_reward_calculations WHERE affiliate_id = 'affiliate-fixed'",
    ).get() as Record<string, unknown>;
    expect(fixedCalc).toMatchObject({
      formula: 'fixed', commission_rate_snapshot: null, base_amount_snapshot: null,
      fixed_reward_snapshot: 3000, offer_name_snapshot: '定期便', amount_minor: 3000,
    });
  });

  it('確定後の設定編集で台帳の金額と根拠が変わらない', async () => {
    const created = await confirmRate('settle-rate-1');
    if (created.kind !== 'created') throw new Error('settlement was not created');
    await confirmAffiliateSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-fixed',
      actorId: 'staff-1', idempotencyKey: 'settle-fixed-1', expectedAmount: 3000,
      now: '2026-09-01T00:00:00.000Z',
    });

    sqlite.exec(`
      UPDATE affiliates SET commission_rate = 50 WHERE id = 'affiliate-rate';
      UPDATE affiliate_offers SET reward_amount = 99999, name = '改名後' WHERE id = 'offer-1';
    `);

    expect(sqlite.prepare('SELECT total_amount_minor AS t FROM affiliate_settlements').all())
      .toEqual([{ t: 1000 }, { t: 3000 }]);
    expect(sqlite.prepare('SELECT amount_minor AS a FROM affiliate_reward_entries').all())
      .toEqual([{ a: 1000 }, { a: 3000 }]);
    const rateCalc = sqlite.prepare(
      "SELECT * FROM affiliate_reward_calculations WHERE affiliate_id = 'affiliate-rate'",
    ).get() as Record<string, unknown>;
    expect(rateCalc).toMatchObject({ commission_rate_snapshot: 10, base_amount_snapshot: 10000, amount_minor: 1000 });
    const fixedCalc = sqlite.prepare(
      "SELECT * FROM affiliate_reward_calculations WHERE affiliate_id = 'affiliate-fixed'",
    ).get() as Record<string, unknown>;
    expect(fixedCalc).toMatchObject({ fixed_reward_snapshot: 3000, offer_name_snapshot: '定期便' });
  });

  it('同じ冪等キーの再試行は二重計上せず同じ確定を返す', async () => {
    const first = await confirmRate('settle-rate-retry');
    if (first.kind !== 'created') throw new Error('settlement was not created');
    const second = await confirmRate('settle-rate-retry');
    expect(second).toMatchObject({ kind: 'duplicate', settlementId: first.settlementId, amount: 1000 });
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM affiliate_reward_entries').get()).toEqual({ c: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM affiliate_settlement_lines').get()).toEqual({ c: 1 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-rate-1'`).get())
      .toEqual({ c: 1 });
  });

  it('確定済みを別キーで再確定しても空になり、二重計上しない', async () => {
    expect((await confirmRate('settle-rate-1')).kind).toBe('created');
    expect(await confirmRate('settle-rate-2')).toEqual({ kind: 'empty' });
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM affiliate_settlements').get()).toEqual({ c: 1 });
  });

  it('他アカウントからは確定も参照も届かない', async () => {
    expect(await previewAffiliateSettlement(db, { tenantId: TENANT_ID, affiliateId: 'affiliate-rate', lineAccountId: 'account-2' }))
      .toBeNull();
    expect(await confirmAffiliateSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-2', affiliateId: 'affiliate-rate',
      actorId: 'staff-1', idempotencyKey: 'settle-other-account', expectedAmount: 1000,
    })).toEqual({ kind: 'not_found' });
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM affiliate_settlements').get()).toEqual({ c: 0 });
  });

  it('承認時に計算根拠の版を作り、却下では作らない', async () => {
    sqlite.exec(`
      INSERT INTO conversion_events
        (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
         approval_status, approved_at, value_snapshot)
      VALUES
        ('conversion-pending-1', 'point-1', 'friend-1', 'affiliate-rate', NULL,
         'pending', NULL, 10000),
        ('conversion-pending-2', 'point-1', 'friend-1', 'affiliate-rate', NULL,
         'pending', NULL, 10000);
    `);
    expect(await setConversionApproval(db, 'conversion-pending-1', 'approved')).toBe(true);
    const calc = sqlite.prepare(
      `SELECT * FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-pending-1'`,
    ).get() as Record<string, unknown>;
    expect(calc).toMatchObject({
      formula: 'rate', commission_rate_snapshot: 10, base_amount_snapshot: 10000, amount_minor: 1000,
    });
    expect(await setConversionApproval(db, 'conversion-pending-2', 'rejected')).toBe(true);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS c FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-pending-2'`,
    ).get()).toEqual({ c: 0 });
    expect(await setConversionApproval(db, 'conversion-pending-1', 'approved')).toBe('already_set');
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-pending-1'`).get())
      .toEqual({ c: 1 });
  });

  it('承認後・締め前の設定編集でプレビューと確定額が変わらない', async () => {
    sqlite.exec(`DELETE FROM affiliate_reward_calculations; DELETE FROM conversion_events;`);
    sqlite.exec(`
      INSERT INTO conversion_events
        (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
         approval_status, approved_at, value_snapshot)
      VALUES ('cv-snap', 'point-1', 'friend-2', 'affiliate-fixed', 'ref-1',
        'pending', NULL, 10000);
    `);
    expect(await setConversionApproval(db, 'cv-snap', 'approved')).toBe(true);
    const input = {
      tenantId: TENANT_ID, affiliateId: 'affiliate-fixed', lineAccountId: 'account-1',
    };
    expect(await previewAffiliateSettlement(db, input)).toMatchObject({ amount: 3000, conversionCount: 1 });
    sqlite.exec(`
      UPDATE affiliates SET commission_rate = 50 WHERE id = 'affiliate-fixed';
      UPDATE affiliate_offers SET reward_amount = 99999, name = '改名後' WHERE id = 'offer-1';
      UPDATE conversion_points SET value = 77777 WHERE id = 'point-1';
    `);
    const after = await previewAffiliateSettlement(db, input);
    expect(after).toMatchObject({
      amount: 3000, conversionCount: 1,
      breakdown: [{ offerName: '定期便', conversions: 1, unitReward: 3000, subtotal: 3000 }],
    });
    expect(await confirmAffiliateSettlement(db, {
      ...input, actorId: 'staff-1', idempotencyKey: 'snap-key-1', expectedAmount: 3000,
    })).toMatchObject({ kind: 'created', amount: 3000 });
    expect(sqlite.prepare(
      `SELECT formula, commission_rate_snapshot, fixed_reward_snapshot, offer_name_snapshot, amount_minor
         FROM affiliate_reward_calculations WHERE conversion_event_id = 'cv-snap'`,
    ).get()).toEqual({
      formula: 'fixed', commission_rate_snapshot: null,
      fixed_reward_snapshot: 3000, offer_name_snapshot: '定期便', amount_minor: 3000,
    });
  });

  it('同じキーで別紹介者を確定しようとすると競合になる', async () => {
    expect((await confirmRate('shared-key-1')).kind).toBe('created');
    expect(await confirmAffiliateSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-fixed',
      actorId: 'staff-1', idempotencyKey: 'shared-key-1', expectedAmount: 3000,
      now: '2026-09-01T00:00:00.000Z',
    })).toEqual({ kind: 'idempotency_conflict' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM affiliate_settlements`).get()).toEqual({ c: 1 });
  });

  it('他テナントの紹介者は確定も参照もできない', async () => {
    expect(await previewAffiliateSettlement(db, {
      tenantId: 'other-tenant', affiliateId: 'affiliate-rate', lineAccountId: 'account-1',
    })).toBeNull();
    expect(await confirmAffiliateSettlement(db, {
      tenantId: 'other-tenant', lineAccountId: 'account-1', affiliateId: 'affiliate-rate',
      actorId: 'staff-1', idempotencyKey: 'other-tenant-key', expectedAmount: 1000,
    })).toEqual({ kind: 'not_found' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM affiliate_settlements`).get()).toEqual({ c: 0 });
  });

  it('0円の承認も版を保存し、後の値上げで過去分が上がらない', async () => {
    sqlite.exec(`DELETE FROM affiliate_reward_calculations; DELETE FROM conversion_events;`);
    sqlite.exec(`
      INSERT INTO affiliate_offers (id, name, reward_amount, line_account_id, created_at)
      VALUES ('offer-0', '無料枠', 0, 'account-1', '2026-08-01');
      INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
      VALUES ('link-0', 'affiliate-fixed', 'ref-0', 'account-1', 'offer-0', '2026-08-01');
      INSERT INTO conversion_events
        (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
         approval_status, approved_at, value_snapshot)
      VALUES ('cv-zero', 'point-1', 'friend-2', 'affiliate-fixed', 'ref-0',
        'pending', NULL, 10000);
    `);
    expect(await setConversionApproval(db, 'cv-zero', 'approved')).toBe(true);
    expect(sqlite.prepare(
      `SELECT formula, amount_minor FROM affiliate_reward_calculations WHERE conversion_event_id = 'cv-zero'`,
    ).get()).toEqual({ formula: 'fixed', amount_minor: 0 });
    const input = { tenantId: TENANT_ID, affiliateId: 'affiliate-fixed', lineAccountId: 'account-1' };
    expect(await previewAffiliateSettlement(db, input)).toMatchObject({ amount: 0, conversionCount: 0 });
    sqlite.exec(`UPDATE affiliate_offers SET reward_amount = 3000 WHERE id = 'offer-0'`);
    expect(await previewAffiliateSettlement(db, input)).toMatchObject({ amount: 0, conversionCount: 0 });
  });

  it('移行が承認済み未締めを凍結し、移行後の編集で動かない', async () => {
    // 移行前の状態に戻して349を通す(承認済み・未締め・版なし)。
    sqlite.exec(`DELETE FROM affiliate_reward_calculations`);
    sqlite.exec(readFileSync(
      join(import.meta.dirname, '..', 'migrations', '349_affiliate_settlement_snapshot.sql'), 'utf8'));
    expect(sqlite.prepare(
      `SELECT id, amount_minor FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-rate-1'`,
    ).get()).toMatchObject({ id: 'calc-349:conversion-rate-1', amount_minor: 1000 });
    expect(sqlite.prepare(
      `SELECT id, amount_minor FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-fixed-1'`,
    ).get()).toMatchObject({ id: 'calc-349:conversion-fixed-1', amount_minor: 3000 });
    sqlite.exec(`
      UPDATE affiliates SET commission_rate = 50 WHERE id = 'affiliate-rate';
      UPDATE affiliate_offers SET reward_amount = 99999 WHERE id = 'offer-1';
      UPDATE conversion_points SET value = 77777 WHERE id = 'point-1';
    `);
    expect((await confirmRate('migrated-key-1')).kind).toBe('created');
    expect(await confirmAffiliateSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-fixed',
      actorId: 'staff-1', idempotencyKey: 'migrated-key-2', expectedAmount: 3000,
    })).toMatchObject({ kind: 'created', amount: 3000 });
  });

  it('所有tenantが空の紹介者は移行で決定し、決まらない行は遮断される', async () => {
    sqlite.exec(`
      UPDATE affiliates SET tenant_id = NULL WHERE id = 'affiliate-fixed';
      INSERT INTO affiliates (id, name, code, tenant_id, line_account_id)
      VALUES ('affiliate-ambiguous', '不明', 'ambiguous', NULL, NULL);
    `);
    sqlite.exec(readFileSync(
      join(import.meta.dirname, '..', 'migrations', '349_affiliate_settlement_snapshot.sql'), 'utf8'));
    expect(sqlite.prepare(
      `SELECT tenant_id AS t FROM affiliates WHERE id = 'affiliate-fixed'`,
    ).get()).toEqual({ t: TENANT_ID });
    expect(sqlite.prepare(
      `SELECT tenant_id AS t FROM affiliates WHERE id = 'affiliate-ambiguous'`,
    ).get()).toEqual({ t: null });
    expect(await previewAffiliateSettlement(db, {
      tenantId: TENANT_ID, affiliateId: 'affiliate-ambiguous', lineAccountId: 'account-1',
    })).toBeNull();
  });

  it('真の同時実行でも二重確定を作らず同一操作は回収する', async () => {
    const [a, b] = await Promise.all([confirmRate('race-key-1'), confirmRate('race-key-1')]);
    expect([a.kind, b.kind].sort()).toEqual(['created', 'duplicate']);
    const ids = [a, b].map((r) => (r as { settlementId: string }).settlementId);
    expect(ids[0]).toBe(ids[1]);
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM affiliate_settlements`).get()).toEqual({ c: 1 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM affiliate_reward_entries`).get()).toEqual({ c: 1 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-rate-1'`).get())
      .toEqual({ c: 1 });
  });

  it('真の同時承認でも版は1つで失敗しない', async () => {
    sqlite.exec(`
      INSERT INTO conversion_events
        (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
         approval_status, approved_at, value_snapshot)
      VALUES ('conversion-race', 'point-1', 'friend-1', 'affiliate-rate', NULL,
        'pending', NULL, 10000);
    `);
    const results = await Promise.all([
      setConversionApproval(db, 'conversion-race', 'approved'),
      setConversionApproval(db, 'conversion-race', 'approved'),
    ]);
    expect(results.sort()).toEqual(['already_set', true]);
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS c FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-race'`,
    ).get()).toEqual({ c: 1 });
  });

  it('移行前の確定分は金額だけを引き継ぎ、根拠なしと分かる形にする', async () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY, tenant_id TEXT);
      CREATE TABLE affiliates (
        id TEXT PRIMARY KEY, code TEXT, commission_rate REAL,
        tenant_id TEXT, line_account_id TEXT
      );
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT);
      CREATE TABLE conversion_points (id TEXT PRIMARY KEY, name TEXT, value REAL, line_account_id TEXT);
      CREATE TABLE affiliate_links (ref_code TEXT PRIMARY KEY, affiliate_id TEXT, line_account_id TEXT, offer_id TEXT);
      CREATE TABLE conversion_events (
        id TEXT PRIMARY KEY, conversion_point_id TEXT, friend_id TEXT,
        affiliate_id TEXT, affiliate_code TEXT, attributed_ref_code TEXT,
        approval_status TEXT, approved_at TEXT, value_snapshot REAL, point_name_snapshot TEXT
      );
      CREATE TABLE affiliate_offers (id TEXT PRIMARY KEY, name TEXT, reward_amount INTEGER, line_account_id TEXT);
      INSERT INTO tenants VALUES ('${TENANT_ID}');
      INSERT INTO line_accounts VALUES ('account-1', '${TENANT_ID}');
      INSERT INTO affiliates VALUES ('affiliate-rate', 'rate-code', 10, '${TENANT_ID}', 'account-1');
      INSERT INTO friends VALUES ('friend-1', 'account-1');
      INSERT INTO conversion_points VALUES ('point-1', '購入', 10000, 'account-1');
      INSERT INTO conversion_events VALUES (
        'conversion-legacy-1', 'point-1', 'friend-1', 'affiliate-rate', NULL, NULL,
        'approved', '2026-08-20T00:00:00.000Z', 10000, NULL);
      INSERT INTO affiliate_offers VALUES ('offer-1', '定期便', 3000, 'account-1');
      CREATE TABLE affiliate_reward_entries (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
        affiliate_id TEXT NOT NULL, conversion_event_id TEXT NOT NULL, offer_id TEXT,
        reward_calculation_id TEXT,
        entry_type TEXT NOT NULL, amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'JPY', created_at TEXT NOT NULL
      );
      INSERT INTO affiliate_reward_entries
        (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
         offer_id, reward_calculation_id, entry_type, amount_minor, currency, created_at)
      VALUES ('entry-legacy-1', '${TENANT_ID}', 'account-1', 'affiliate-rate',
        'conversion-legacy-1', 'offer-1', NULL, 'credit', 1000, 'JPY', '2026-08-20T00:00:00.000Z'),
        ('entry-legacy-2', '${TENANT_ID}', 'account-1', 'affiliate-rate',
        'conversion-legacy-2', 'offer-1', 'calc-kept', 'credit', 2000, 'JPY', '2026-08-21T00:00:00.000Z');
    `);
    legacy.exec(`INSERT INTO conversion_events VALUES (
      'conversion-legacy-2', 'point-1', 'friend-1', 'affiliate-rate', NULL, NULL,
      'approved', '2026-08-21T00:00:00.000Z', 20000, NULL)`);
    legacy.exec(readFileSync(
      join(import.meta.dirname, '..', 'migrations', '349_affiliate_settlement_snapshot.sql'), 'utf8'));
    const row = legacy.prepare(
      `SELECT * FROM affiliate_reward_calculations WHERE conversion_event_id = 'conversion-legacy-1'`,
    ).get() as Record<string, unknown>;
    expect(row).toMatchObject({
      conversion_event_id: 'conversion-legacy-1', formula: 'legacy', amount_minor: 1000,
      commission_rate_snapshot: null, base_amount_snapshot: null, fixed_reward_snapshot: null,
    });
    // 対応するlegacy版へ決定的に紐付き、既に版がある行は触らない。
    expect(legacy.prepare(
      `SELECT reward_calculation_id AS c FROM affiliate_reward_entries WHERE id = 'entry-legacy-1'`,
    ).get()).toEqual({ c: row.id });
    expect(legacy.prepare(
      `SELECT reward_calculation_id AS c FROM affiliate_reward_entries WHERE id = 'entry-legacy-2'`,
    ).get()).toEqual({ c: 'calc-kept' });
  });
});
