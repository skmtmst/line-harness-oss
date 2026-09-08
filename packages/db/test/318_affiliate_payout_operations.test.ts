import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeAffiliateAccountSettlement,
  createAffiliatePayoutBatch,
  createAffiliateStatement,
  getAffiliateBankProfile,
  getAffiliatePayoutBatchExport,
  getAffiliatePayoutDownload,
  getAffiliateStatementDownload,
  listAffiliateStatementsForSelf,
  markAffiliatePayoutExported,
  prepareAffiliateStatement,
  previewAffiliateAccountSettlement,
  saveAffiliateBankProfile,
} from '../src/affiliate-payouts.js';
import { setConversionApproval } from '../src/affiliate-offers.js';
import { asD1 } from './d1-test-helper.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run('account-1', 'channel-1', '本店', TENANT_ID);
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run('account-2', 'channel-2', '別店', TENANT_ID);
  sqlite.exec(`
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U1', '田中', 'account-1'), ('friend-2', 'U2', '別店', 'account-2');
    INSERT INTO affiliates
      (id, name, code, commission_rate, friend_id, tenant_id, line_account_id, hold_days)
    VALUES
      ('affiliate-1', '田中', 'tanaka', 0, 'friend-1', '${TENANT_ID}', 'account-1', 0),
      ('affiliate-2', '別店', 'other', 10, 'friend-2', '${TENANT_ID}', 'account-2', 0);
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1'),
           ('point-2', '購入', 'purchase', 10000, 'account-2');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', '2026-08-01', '2026-08-01');
    INSERT INTO affiliate_offers (id, name, reward_amount, line_account_id, created_at)
    VALUES ('offer-1', '定期便', 5000, 'account-1', '2026-08-01'),
           ('offer-2', '別店商品', 9999, 'account-2', '2026-08-01');
    INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
    VALUES ('link-1', 'affiliate-1', 'ref-1', 'account-1', 'offer-1', '2026-08-01'),
           ('link-2', 'affiliate-2', 'ref-2', 'account-2', 'offer-2', '2026-08-01');
    INSERT INTO conversion_events
      (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
       approval_status, approved_at, value_snapshot)
    VALUES
      ('conversion-1', 'point-1', 'friend-1', 'affiliate-1', 'ref-1', 'approved', '2026-08-10T00:00:00.000Z', 10000),
      ('conversion-other', 'point-2', 'friend-2', 'affiliate-2', 'ref-2', 'approved', '2026-08-10T00:00:00.000Z', 10000);
  `);
  db = asD1(sqlite);
});

describe('migration 318 affiliate settlement and payout ledger', () => {
  it('アカウント単位でpreviewし、版と冪等性を守って一度だけ締める', async () => {
    const period = {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      periodFrom: '2026-08-01T00:00:00.000Z', periodTo: '2026-08-31T23:59:59.000Z',
    };
    const preview = await previewAffiliateAccountSettlement(db, period);
    expect(preview).toMatchObject({
      totalAmount: 5000, conversionCount: 1,
      affiliates: [{ affiliateId: 'affiliate-1', amount: 5000, bankProfileRegistered: false }],
    });
    expect(JSON.stringify(preview)).not.toContain('affiliate-2');

    const closeInput = {
      ...period, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
      idempotencyKey: 'settlement-request-1', requestFingerprint: 'fingerprint-1',
      now: '2026-09-01T00:00:00.000Z',
    };
    const created = await closeAffiliateAccountSettlement(db, closeInput);
    expect(created).toMatchObject({ kind: 'created', totalAmount: 5000, conversionCount: 1, version: 1 });
    expect(await closeAffiliateAccountSettlement(db, closeInput)).toMatchObject({ kind: 'duplicate', totalAmount: 5000 });
    expect(await closeAffiliateAccountSettlement(db, { ...closeInput, requestFingerprint: 'different' }))
      .toEqual({ kind: 'idempotency_conflict' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM affiliate_reward_entries').get()).toEqual({ count: 1 });
  });

  it('承認時の版があれば全体締めも凍結し、entryへ必ず紐付ける', async () => {
    sqlite.exec(`
      INSERT INTO conversion_events
        (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code,
         approval_status, approved_at, value_snapshot)
      VALUES ('conversion-new', 'point-1', 'friend-1', 'affiliate-1', 'ref-1',
        'pending', NULL, 10000);
    `);
    expect(await setConversionApproval(db, 'conversion-new', 'approved')).toBe(true);
    const period = {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      periodFrom: '2026-08-01T00:00:00.000Z', periodTo: '2099-01-01T00:00:00.000Z',
    };
    const before = await previewAffiliateAccountSettlement(db, period);
    // conversion-1(旧: 版なし5000)+conversion-new(版あり5000)
    expect(before).toMatchObject({ totalAmount: 10000, conversionCount: 2 });
    sqlite.exec(`UPDATE affiliate_offers SET reward_amount = 99999 WHERE id = 'offer-1'`);
    const edited = await previewAffiliateAccountSettlement(db, period);
    // 版ありだけ凍結され、版なし旧データは現在値で読む(後方互換)
    expect(edited).toMatchObject({ totalAmount: 104999, conversionCount: 2 });
    const closed = await closeAffiliateAccountSettlement(db, {
      ...period, actorId: 'staff-1', expectedPreviewVersion: edited.previewVersion,
      idempotencyKey: 'settlement-frozen-1', requestFingerprint: 'frozen-1',
      now: '2026-09-01T00:00:00.000Z',
    });
    expect(closed).toMatchObject({ kind: 'created', totalAmount: 104999, conversionCount: 2 });
    expect(sqlite.prepare(
      `SELECT COUNT(*) AS c FROM affiliate_reward_entries WHERE reward_calculation_id IS NULL`,
    ).get()).toEqual({ c: 0 });
    expect(sqlite.prepare(
      `SELECT re.amount_minor AS a FROM affiliate_reward_entries re
        JOIN affiliate_reward_calculations c ON c.id = re.reward_calculation_id
       WHERE re.conversion_event_id = 'conversion-new'`,
    ).get()).toEqual({ a: 5000 });
  });

  it('口座番号を返さず、版競合を409用の結果へ分ける', async () => {
    const base = {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-1',
      bankCode: '0001', bankName: 'テスト銀行', branchCode: '001', branchName: '本店',
      accountType: 'ordinary' as const, encryptedAccountNumber: 'v1.encrypted.payload',
      accountLast4: '4567', accountHolderName: 'ﾀﾅｶ', accountFingerprint: 'fingerprint',
      expectedVersion: 0, idempotencyKey: 'bank-request-1', requestFingerprint: 'request-1',
      now: '2026-09-01T00:00:00.000Z',
    };
    const created = await saveAffiliateBankProfile(db, base);
    expect(created).toMatchObject({ kind: 'created', profile: { accountLast4: '4567', version: 1 } });
    expect(JSON.stringify(created)).not.toContain('v1.encrypted.payload');
    expect(JSON.stringify(await getAffiliateBankProfile(db, base))).not.toContain('v1.encrypted.payload');
    expect(await saveAffiliateBankProfile(db, { ...base, idempotencyKey: 'bank-request-2' }))
      .toEqual({ kind: 'changed' });
  });

  it('締めsnapshotから支払batch・CSV用行・明細を作る', async () => {
    const period = {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      periodFrom: '2026-08-01T00:00:00.000Z', periodTo: '2026-08-31T23:59:59.000Z',
    };
    const preview = await previewAffiliateAccountSettlement(db, period);
    const settlement = await closeAffiliateAccountSettlement(db, {
      ...period, actorId: 'staff-1', expectedPreviewVersion: preview.previewVersion,
      idempotencyKey: 'settlement-request-1', requestFingerprint: 'settlement-fingerprint',
    });
    if (settlement.kind !== 'created') throw new Error('settlement was not created');
    expect(await createAffiliatePayoutBatch(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', settlementId: settlement.settlementId,
      expectedVersion: 1, bankFormat: 'zengin_csv', actorId: 'staff-1',
      idempotencyKey: 'batch-request-missing', requestFingerprint: 'batch-missing',
    })).toMatchObject({ kind: 'bank_missing', missingAffiliateIds: ['affiliate-1'] });

    await saveAffiliateBankProfile(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-1',
      bankCode: '0001', bankName: 'テスト銀行', branchCode: '001', branchName: '本店',
      accountType: 'ordinary', encryptedAccountNumber: 'encrypted-number', accountLast4: '4567',
      accountHolderName: 'ﾀﾅｶ', accountFingerprint: 'bank-fingerprint', expectedVersion: 0,
      idempotencyKey: 'bank-request-1', requestFingerprint: 'bank-fingerprint-1',
    });
    const batchResult = await createAffiliatePayoutBatch(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', settlementId: settlement.settlementId,
      expectedVersion: 1, bankFormat: 'zengin_csv', actorId: 'staff-1',
      idempotencyKey: 'batch-request-1', requestFingerprint: 'batch-fingerprint-1',
    });
    if (batchResult.kind !== 'created') throw new Error('batch was not created');
    const exportData = await getAffiliatePayoutBatchExport(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', batchId: batchResult.batch.id,
    });
    expect(exportData).toMatchObject({ lines: [{ amount: 5000, encryptedAccountNumber: 'encrypted-number' }] });
    const exportInput = {
      tenantId: TENANT_ID, lineAccountId: 'account-1', batchId: batchResult.batch.id,
      expectedVersion: 1, idempotencyKey: 'export-request-1', requestFingerprint: 'export-fingerprint-1',
      objectKey: 'affiliate-payouts/file.csv', checksum: 'checksum',
      expiresAt: '2026-09-01T01:00:00.000Z', downloadTokenHash: 'token-hash',
      now: '2026-09-01T00:00:00.000Z',
    };
    expect(await markAffiliatePayoutExported(db, exportInput))
      .toMatchObject({ kind: 'exported', batch: { version: 2, state: 'exported' } });
    expect(await markAffiliatePayoutExported(db, {
      ...exportInput, downloadTokenHash: 'replacement-token-hash',
      expiresAt: '2026-09-01T01:15:00.000Z',
    })).toMatchObject({ kind: 'duplicate', batch: { version: 2, state: 'exported' } });
    expect(await getAffiliatePayoutDownload(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', batchId: batchResult.batch.id,
      tokenHash: 'replacement-token-hash', now: '2026-09-01T00:30:00.000Z',
    })).toEqual({ objectKey: 'affiliate-payouts/file.csv', fileChecksum: 'checksum' });

    const snapshot = await prepareAffiliateStatement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1',
      settlementId: settlement.settlementId, affiliateId: 'affiliate-1',
    });
    expect(snapshot).toMatchObject({ totalAmount: 5000, lineCount: 1, settlementVersion: 1 });
    if (!snapshot) throw new Error('statement snapshot missing');
    const statement = await createAffiliateStatement(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', snapshot,
      objectKey: 'affiliate-statements/file.pdf', checksum: 'pdf-checksum',
      idempotencyKey: 'statement-request-1', requestFingerprint: 'statement-fingerprint-1',
      actorId: 'staff-1', expiresAt: '2026-10-01T00:00:00.000Z',
      now: '2026-09-01T00:00:00.000Z',
    });
    expect(await listAffiliateStatementsForSelf(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-1',
    })).toEqual([statement]);
    expect(await getAffiliateStatementDownload(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-1', affiliateId: 'affiliate-1',
      statementId: statement.id, now: '2026-09-02T00:00:00.000Z',
    })).toMatchObject({ objectKey: 'affiliate-statements/file.pdf' });
    expect(await getAffiliateStatementDownload(db, {
      tenantId: TENANT_ID, lineAccountId: 'account-2', affiliateId: 'affiliate-1',
      statementId: statement.id, now: '2026-09-02T00:00:00.000Z',
    })).toBeNull();
  });
});
