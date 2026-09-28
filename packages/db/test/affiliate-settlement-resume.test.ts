import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeAffiliateAccountSettlement,
  createAffiliatePayoutBatch,
  createAffiliateStatement,
  getClosedAccountSettlement,
  prepareAffiliateStatement,
  previewAffiliateAccountSettlement,
  saveAffiliateBankProfile,
} from '../src/affiliate-payouts.js';
import { ensureConversionRewardSnapshot } from '../src/affiliate-settlements.js';
import { asD1 } from './d1-test-helper.js';

/*
 * R287の回帰試験: 締めのあと画面を開き直しても、締め済み台帳を引き直して
 * 明細発行・CSV準備を再開できる(#938の再開口 getClosedAccountSettlement)。
 * 監査はこの口が入る前の版で「再開できない」とした。口が無くなったり
 * 壊れたりしたらここが赤になる。
 */

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
let sqlite: Database.Database;
let db: D1Database;

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
    VALUES ('friend-1', 'U1', '田中', 'account-1');
    INSERT INTO affiliates
      (id, name, code, commission_rate, friend_id, tenant_id, line_account_id, hold_days)
    VALUES ('affiliate-1', '田中', 'tanaka', 0, 'friend-1', '${TENANT_ID}', 'account-1', 0);
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', '2026-08-01', '2026-08-01');
    INSERT INTO affiliate_offers (id, name, reward_amount, line_account_id, created_at)
    VALUES ('offer-1', '定期便', 1000, 'account-1', '2026-08-01');
    INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
    VALUES ('link-1', 'affiliate-1', 'ref-1', 'account-1', 'offer-1', '2026-08-01');
    INSERT INTO conversion_events
      (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
       approval_status, approved_at, value_snapshot)
    VALUES ('conversion-1', 'point-1', 'friend-1', 'affiliate-1', 'ref-1',
      'approved', '2026-09-20T00:00:00.000Z', 10000);
  `);
  db = asD1(sqlite);
  await ensureConversionRewardSnapshot(db, 'conversion-1', '2026-09-20T00:00:00.000Z');
  await saveAffiliateBankProfile(db, {
    tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-1',
    bankCode: '0001', bankName: 'テスト銀行', branchCode: '001', branchName: '本店',
    accountType: 'ordinary', encryptedAccountNumber: 'encrypted-number', accountLast4: '4567',
    accountHolderName: 'ﾀﾅｶ', accountFingerprint: 'bank-fp', expectedVersion: 0,
    idempotencyKey: 'bank-1', requestFingerprint: 'bank-fp-1',
  });
});

async function closeSeptember() {
  const preview = await previewAffiliateAccountSettlement(db, SEPT);
  const closed = await closeAffiliateAccountSettlement(db, {
    ...SEPT, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
    idempotencyKey: 'sept-1', requestFingerprint: 'fp-sept-1', now: '2026-10-01T00:00:00.000Z',
  });
  if (closed.kind !== 'created') throw new Error(`close failed: ${closed.kind}`);
  return closed;
}

describe('R287 締め後に開き直しても明細・CSVを再開できる', () => {
  it('締め→開き直し→締め済み台帳に戻る', async () => {
    const closed = await closeSeptember();
    // 開き直し(プレビューは未締め0件)でも、期間で締め済みを引ける。
    const nextPreview = await previewAffiliateAccountSettlement(db, SEPT);
    expect(nextPreview.totalAmount).toBe(0);
    const resumed = await getClosedAccountSettlement(db, SEPT);
    expect(resumed).toMatchObject({
      settlementId: closed.settlementId,
      state: 'closed',
      version: 1,
      totalAmount: 1000,
      conversionCount: 1,
      affiliates: [{
        affiliateId: 'affiliate-1', affiliateName: '田中', code: 'tanaka',
        amount: 1000, conversionCount: 1, statementIssued: false, bankProfileRegistered: true,
      }],
      batch: null,
    });
  });

  it('明細発行後は発行済みが分かり、CSV準備後は作成済みが分かる', async () => {
    const closed = await closeSeptember();
    const snapshot = await prepareAffiliateStatement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      settlementId: closed.settlementId, affiliateId: 'affiliate-1',
    });
    expect(snapshot).toMatchObject({ totalAmount: 1000 });
    const statement = await createAffiliateStatement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', snapshot: snapshot!,
      objectKey: 'statements/1.pdf', checksum: 'checksum', idempotencyKey: 'stmt-1',
      requestFingerprint: 'stmt-fp-1', actorId: 'staff-1', expiresAt: '2026-11-01T00:00:00.000Z',
    });
    expect(statement.totalAmount).toBe(1000);

    const batch = await createAffiliatePayoutBatch(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', settlementId: closed.settlementId,
      expectedVersion: 1, bankFormat: 'zengin_csv', actorId: 'staff-1',
      idempotencyKey: 'batch-1', requestFingerprint: 'batch-fp-1',
    });
    if (batch.kind !== 'created') throw new Error(`batch failed: ${batch.kind}`);

    const resumed = await getClosedAccountSettlement(db, SEPT);
    expect(resumed?.affiliates).toMatchObject([{ affiliateId: 'affiliate-1', statementIssued: true }]);
    expect(resumed?.batch).toMatchObject({ id: batch.batch.id });
  });

  it('別期間・別アカウントの締めは混ざらない', async () => {
    await closeSeptember();
    const otherPeriod = await getClosedAccountSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      periodFrom: '2026-10-01T00:00:00.000Z', periodTo: '2026-10-31T23:59:59.000Z',
    });
    expect(otherPeriod).toBeNull();
    const otherAccount = await getClosedAccountSettlement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-2',
      periodFrom: SEPT.periodFrom, periodTo: SEPT.periodTo,
    });
    expect(otherAccount).toBeNull();
  });
});
