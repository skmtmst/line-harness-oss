import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeAffiliateAccountSettlement,
  createAffiliatePayoutBatch,
  getAffiliatePayoutBatchExport,
  prepareAffiliateStatement,
  previewAffiliateAccountSettlement,
  saveAffiliateBankProfile,
} from '../src/affiliate-payouts.js';
import { reverseSettledRewardOnRejection } from '../src/affiliate-settlements.js';
import { ensureConversionRewardSnapshot } from '../src/affiliate-settlements.js';
import { asD1 } from './d1-test-helper.js';

/*
 * R288: 締め後の取消は次の支払いで差し引く。実SQLite(bootstrap.sql)で
 * プレビュー・締め・明細・CSVの全工程を通す。
 * - 次回1000円と未適用取消300円から700円を算出し、締め→明細→CSVまで一致
 * - 次回200円・取消300円なら正の振込をせず残り100円を繰り越す
 * - 再試行や翌締めで同じ取消を二重控除しない
 * - 別アカウントの取消は混ぜない
 */

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
let sqlite: Database.Database;
let db: D1Database;

const AUG = {
  tenantId: TENANT_ID, lineAccountId: 'account-1',
  periodFrom: '2026-08-01T00:00:00.000Z', periodTo: '2026-08-31T23:59:59.000Z',
};
const SEPT = {
  tenantId: TENANT_ID, lineAccountId: 'account-1',
  periodFrom: '2026-09-01T00:00:00.000Z', periodTo: '2026-09-30T23:59:59.000Z',
};

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run('account-1', 'channel-1', '本店', TENANT_ID);
  sqlite.exec(`
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U1', '田中', 'account-1'),
           ('friend-2', 'U2', '佐藤', 'account-1');
    INSERT INTO affiliates
      (id, name, code, commission_rate, friend_id, tenant_id, line_account_id, hold_days)
    VALUES
      ('affiliate-1', '田中', 'tanaka', 0, 'friend-1', '${TENANT_ID}', 'account-1', 0),
      ('affiliate-2', '佐藤', 'sato', 0, 'friend-2', '${TENANT_ID}', 'account-1', 0);
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', '2026-08-01', '2026-08-01');
    INSERT INTO affiliate_offers (id, name, reward_amount, line_account_id, created_at)
    VALUES ('offer-old', '旧報酬', 300, 'account-1', '2026-08-01'),
           ('offer-new', '新報酬', 1000, 'account-1', '2026-08-01'),
           ('offer-b', 'B報酬', 200, 'account-1', '2026-08-01');
    INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
    VALUES ('link-old', 'affiliate-1', 'ref-old', 'account-1', 'offer-old', '2026-08-01'),
           ('link-new', 'affiliate-1', 'ref-new', 'account-1', 'offer-new', '2026-08-01'),
           ('link-b', 'affiliate-2', 'ref-b', 'account-1', 'offer-b', '2026-08-01'),
           ('link-b2', 'affiliate-2', 'ref-b2', 'account-1', 'offer-new', '2026-08-01');
    INSERT INTO conversion_events
      (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
       approval_status, approved_at, value_snapshot)
    VALUES
      ('old-event', 'point-1', 'friend-1', 'affiliate-1', 'ref-old', 'approved', '2026-08-20T00:00:00.000Z', 3000),
      ('new-event', 'point-1', 'friend-1', 'affiliate-1', 'ref-new', 'approved', '2026-09-20T00:00:00.000Z', 10000);
  `);
  db = asD1(sqlite);
  await ensureConversionRewardSnapshot(db, 'old-event', '2026-08-20T00:00:00.000Z');
  await ensureConversionRewardSnapshot(db, 'new-event', '2026-09-20T00:00:00.000Z');
});

async function closeAugust(key: string, fingerprint: string) {
  const preview = await previewAffiliateAccountSettlement(db, AUG);
  const closed = await closeAffiliateAccountSettlement(db, {
    ...AUG, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
    idempotencyKey: key, requestFingerprint: fingerprint, now: '2026-09-01T00:00:00.000Z',
  });
  if (closed.kind !== 'created') throw new Error(`august close failed: ${closed.kind}`);
  return closed;
}

async function rejectAndReverse(eventId: string) {
  sqlite.prepare(`UPDATE conversion_events SET approval_status = 'rejected' WHERE id = ?`).run(eventId);
  const reversal = await reverseSettledRewardOnRejection(db, eventId, '2026-09-21T10:00:00.000Z');
  expect(reversal?.amountMinor).toBe(300);
  return reversal;
}

describe('R288 締め後の取消は次の支払いで差し引く', () => {
  it('次回1000円と未適用取消300円から700円を算出する', async () => {
    await closeAugust('aug-1', 'fp-aug-1');
    await rejectAndReverse('old-event');
    const preview = await previewAffiliateAccountSettlement(db, SEPT);
    expect(preview.totalAmount).toBe(700);
    expect(preview.totalDeduction).toBe(300);
    expect(preview.carriedDeduction).toEqual({ count: 0, amount: 0 });
    expect(preview.affiliates.find((row) => row.affiliateId === 'affiliate-1')).toMatchObject({
      amount: 700, grossAmount: 1000, deduction: 300, conversionCount: 1,
    });
  });

  it('締め→明細→CSVまで700円で一致し、二重控除しない', async () => {
    await closeAugust('aug-1', 'fp-aug-1');
    await rejectAndReverse('old-event');
    const preview = await previewAffiliateAccountSettlement(db, SEPT);
    const closed = await closeAffiliateAccountSettlement(db, {
      ...SEPT, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
      idempotencyKey: 'sept-1', requestFingerprint: 'fp-sept-1', now: '2026-10-01T00:00:00.000Z',
    });
    expect(closed).toMatchObject({ kind: 'created', totalAmount: 700, conversionCount: 1 });
    if (closed.kind !== 'created') throw new Error('september close failed');

    // 取消行が負数で付いている。同じ取消は1行だけ。
    const septLines = sqlite.prepare(
      `SELECT affiliate_id, amount_minor FROM affiliate_settlement_lines
        WHERE settlement_id = (SELECT id FROM affiliate_settlements WHERE idempotency_key = 'sept-1')
        ORDER BY amount_minor DESC`,
    ).all() as Array<{ affiliate_id: string; amount_minor: number }>;
    expect(septLines.filter((line) => line.affiliate_id === 'affiliate-1').map((line) => line.amount_minor)).toEqual([1000, -300]);

    // 明細は元報酬・差し引き・純額が一致する。
    const snapshot = await prepareAffiliateStatement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      settlementId: closed.settlementId,
      affiliateId: 'affiliate-1',
    });
    expect(snapshot).toMatchObject({ totalAmount: 700, grossAmount: 1000, deductionAmount: 300 });

    // CSV用の行は純額700円で1行。
    await saveAffiliateBankProfile(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-1',
      bankCode: '0001', bankName: 'テスト銀行', branchCode: '001', branchName: '本店',
      accountType: 'ordinary', encryptedAccountNumber: 'encrypted-number', accountLast4: '4567',
      accountHolderName: 'ﾀﾅｶ', accountFingerprint: 'bank-fp', expectedVersion: 0,
      idempotencyKey: 'bank-1', requestFingerprint: 'bank-fp-1',
    });
    const batch = await createAffiliatePayoutBatch(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', settlementId: snapshot!.settlementId,
      expectedVersion: 1, bankFormat: 'zengin_csv', actorId: 'staff-1',
      idempotencyKey: 'batch-1', requestFingerprint: 'batch-fp-1',
    });
    if (batch.kind !== 'created') throw new Error(`batch failed: ${batch.kind}`);
    const exportData = await getAffiliatePayoutBatchExport(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', batchId: batch.batch.id,
    });
    const aff1 = exportData!.lines.filter((line) => line.affiliateId === 'affiliate-1');
    expect(aff1.reduce((sum, line) => sum + line.amount, 0)).toBe(700);

    // 締め直し・翌プレビューで同じ取消をもう一度引かない。
    const again = await previewAffiliateAccountSettlement(db, SEPT);
    expect(again.totalAmount).toBe(0);
    expect(again.totalDeduction).toBe(0);
  });

  it('次回200円・取消300円なら正の振込をせず残り100円を繰り越す', async () => {
    // 紹介者2の締め済み300円と次回200円を用意する。
    sqlite.exec(`
      INSERT INTO affiliate_offers (id, name, reward_amount, line_account_id, created_at)
      VALUES ('offer-150', 'B追加報酬', 150, 'account-1', '2026-08-01');
      INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
      VALUES ('link-old-b', 'affiliate-2', 'ref-old-b', 'account-1', 'offer-old', '2026-08-01'),
             ('link-b3', 'affiliate-2', 'ref-b3', 'account-1', 'offer-150', '2026-08-01');
      INSERT INTO conversion_events
        (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
         approval_status, approved_at, value_snapshot)
      VALUES
        ('old-b-event', 'point-1', 'friend-2', 'affiliate-2', 'ref-old-b', 'approved', '2026-08-20T00:00:00.000Z', 3000),
        ('b-event', 'point-1', 'friend-2', 'affiliate-2', 'ref-b', 'approved', '2026-09-20T00:00:00.000Z', 2000);
    `);
    await ensureConversionRewardSnapshot(db, 'old-b-event', '2026-08-20T00:00:00.000Z');
    await ensureConversionRewardSnapshot(db, 'b-event', '2026-09-20T00:00:00.000Z');
    await closeAugust('aug-1', 'fp-aug-1');
    await rejectAndReverse('old-b-event');
    const preview = await previewAffiliateAccountSettlement(db, SEPT);
    const row = preview.affiliates.find((item) => item.affiliateId === 'affiliate-2');
    expect(row).toMatchObject({ amount: 0, grossAmount: 200, deduction: 200, conversionCount: 1 });
    expect(preview.carriedDeduction).toEqual({ count: 1, amount: 100 });
    // 別紹介者の取消は混ざらない。
    expect(preview.affiliates.find((item) => item.affiliateId === 'affiliate-1')).toMatchObject({
      amount: 1000, grossAmount: 1000, deduction: 0,
    });

    const closed = await closeAffiliateAccountSettlement(db, {
      ...SEPT, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
      idempotencyKey: 'sept-1', requestFingerprint: 'fp-sept-1', now: '2026-10-01T00:00:00.000Z',
    });
    expect(closed).toMatchObject({ kind: 'created', totalAmount: 1000 });

    // 残り100円が次の報酬から引かれる。
    sqlite.prepare(
      `INSERT INTO conversion_events
         (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
          approval_status, approved_at, value_snapshot)
       VALUES ('b2-event', 'point-1', 'friend-2', 'affiliate-2', 'ref-b3', 'approved', '2026-10-05T00:00:00.000Z', 1500)`,
    ).run();
    await ensureConversionRewardSnapshot(db, 'b2-event', '2026-10-05T00:00:00.000Z');
    const next = await previewAffiliateAccountSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      periodFrom: '2026-10-01T00:00:00.000Z', periodTo: '2026-10-31T23:59:59.000Z',
    });
    expect(next.affiliates.find((item) => item.affiliateId === 'affiliate-2')).toMatchObject({
      amount: 50, grossAmount: 150, deduction: 100,
    });
    expect(next.carriedDeduction).toEqual({ count: 0, amount: 0 });
  });

  it('プレビュー後に来た取消では古い版で締められない', async () => {
    await closeAugust('aug-1', 'fp-aug-1');
    const preview = await previewAffiliateAccountSettlement(db, SEPT);
    expect(preview.totalAmount).toBe(1000);
    await rejectAndReverse('old-event');
    const stale = await closeAffiliateAccountSettlement(db, {
      ...SEPT, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
      idempotencyKey: 'sept-1', requestFingerprint: 'fp-sept-1', now: '2026-10-01T00:00:00.000Z',
    });
    expect(stale).toEqual({ kind: 'changed' });
    // 取り直せば700円で締められる。
    const fresh = await previewAffiliateAccountSettlement(db, SEPT);
    const closed = await closeAffiliateAccountSettlement(db, {
      ...SEPT, actorId: 'staff-1', expectedPreviewVersion: fresh.previewVersion,
      idempotencyKey: 'sept-1', requestFingerprint: 'fp-sept-1', now: '2026-10-01T00:00:00.000Z',
    });
    expect(closed).toMatchObject({ kind: 'created', totalAmount: 700 });
  });

  it('同じ締めの再試行は重複せず、別キーでも対象が無ければ空で止まる', async () => {
    await closeAugust('aug-1', 'fp-aug-1');
    await rejectAndReverse('old-event');
    const preview = await previewAffiliateAccountSettlement(db, SEPT);
    const input = {
      ...SEPT, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
      idempotencyKey: 'sept-1', requestFingerprint: 'fp-sept-1', now: '2026-10-01T00:00:00.000Z',
    };
    expect(await closeAffiliateAccountSettlement(db, input)).toMatchObject({ kind: 'created', totalAmount: 700 });
    expect(await closeAffiliateAccountSettlement(db, input)).toMatchObject({ kind: 'duplicate', totalAmount: 700 });
    // 取消の消費行は1件だけ。
    const debitLines = sqlite.prepare(
      `SELECT COUNT(*) AS count FROM affiliate_settlement_lines sl
        JOIN affiliate_reward_entries re ON re.id = sl.entry_id
       WHERE re.entry_type = 'debit'`,
    ).get() as { count: number };
    expect(debitLines.count).toBe(1);
    // 別キーでの再送は対象が残っていないので空で止まる(二重計上しない)。
    expect(await closeAffiliateAccountSettlement(db, { ...input, idempotencyKey: 'sept-2', requestFingerprint: 'fp-sept-2' }))
      .toEqual({ kind: 'empty' });
  });
});
