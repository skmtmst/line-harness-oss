import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

const dbMocks = {
  previewAffiliateAccountSettlement: vi.fn(),
  closeAffiliateAccountSettlement: vi.fn(),
  createAffiliatePayoutBatch: vi.fn(),
  getAffiliatePayoutBatchExport: vi.fn(),
  markAffiliatePayoutExported: vi.fn(),
  getAffiliatePayoutDownload: vi.fn(),
  prepareAffiliateStatement: vi.fn(),
  getAffiliateStatementReplay: vi.fn(),
  createAffiliateStatement: vi.fn(),
  consumeStepUpGrant: vi.fn(),
  decryptCredential: vi.fn(),
};
const accountAccess = { getVisibleLineAccountScope: vi.fn() };
const notifier = { notifyAffiliate: vi.fn() };

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/account-access.js', () => accountAccess);
vi.mock('../services/affiliate-notifier.js', () => notifier);

const { affiliatePayouts } = await import('./affiliate-payouts.js');

const bucket = {
  put: vi.fn(),
  get: vi.fn(),
};
const env = {
  DB: {} as D1Database,
  IMAGES: bucket,
  LINE_CREDENTIAL_ENCRYPTION_KEY: 'test-key',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
} as unknown as Env['Bindings'];

function app(role: 'owner' | 'admin' | 'staff' = 'owner', permissionKeys: string[] = []) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: '担当', role, readOnly: false,
      tenantId: 'tenant-1', permissionKeys,
    });
    await next();
  });
  instance.route('/', affiliatePayouts);
  return instance;
}

function request(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; role?: 'owner' | 'admin' | 'staff'; permissions?: string[] } = {},
) {
  return app(options.role, options.permissions).fetch(new Request(`https://example.com${path}`, {
    method: options.method,
    headers: { 'content-type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), env);
}

const preview = {
  lineAccountId: 'account-1', periodFrom: '2026-08-01T00:00:00.000Z',
  periodTo: '2026-08-31T23:59:59.000Z', currency: 'JPY', totalAmount: 5000,
  conversionCount: 1, affiliates: [{ affiliateId: 'affiliate-1', amount: 5000 }],
  previewVersion: 'a'.repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    allowedAccountIds: ['account-1'], canSeeUnassigned: false,
  });
  dbMocks.previewAffiliateAccountSettlement.mockResolvedValue(preview);
  dbMocks.closeAffiliateAccountSettlement.mockResolvedValue({
    kind: 'created', settlementId: 'settlement-1', totalAmount: 5000,
    conversionCount: 1, version: 1, closedAt: '2026-09-07T00:00:00.000Z',
  });
  dbMocks.createAffiliatePayoutBatch.mockResolvedValue({
    kind: 'created', batch: { id: 'batch-1', version: 1, state: 'created' },
  });
  dbMocks.consumeStepUpGrant.mockResolvedValue(true);
  dbMocks.getAffiliatePayoutBatchExport.mockResolvedValue({
    batch: { id: 'batch-1', version: 1, state: 'created' },
    lines: [{
      affiliateId: 'affiliate-1', amount: 5000, bankCode: '0001', bankName: '銀行',
      branchCode: '001', branchName: '本店', accountType: 'ordinary',
      encryptedAccountNumber: 'encrypted', accountLast4: '4567', accountHolderName: 'ﾀﾅｶ',
    }],
  });
  dbMocks.decryptCredential.mockResolvedValue('1234567');
  dbMocks.markAffiliatePayoutExported.mockResolvedValue({
    kind: 'exported', batch: { id: 'batch-1', version: 2, state: 'exported' }, objectKey: 'payout.csv',
  });
  bucket.put.mockResolvedValue(undefined);
  bucket.get.mockResolvedValue({ body: 'csv' });
  dbMocks.getAffiliateStatementReplay.mockResolvedValue(null);
  dbMocks.prepareAffiliateStatement.mockResolvedValue({
    settlementId: 'settlement-1', settlementVersion: 1, affiliateId: 'affiliate-1',
    affiliateName: '田中', affiliateCode: 'tanaka', periodFrom: preview.periodFrom,
    periodTo: preview.periodTo, totalAmount: 5000, currency: 'JPY', lineCount: 1,
  });
  dbMocks.createAffiliateStatement.mockResolvedValue({
    id: 'statement-1', affiliateId: 'affiliate-1', settlementId: 'settlement-1', version: 1,
  });
  notifier.notifyAffiliate.mockResolvedValue(undefined);
});

describe('affiliate settlement API', () => {
  it('実データのプレビューと空状態を200で返す', async () => {
    const path = '/api/affiliate-settlements/preview?lineAccountId=account-1&periodFrom=2026-08-01T00:00:00.000Z&periodTo=2026-08-31T23:59:59.000Z';
    const normal = await request(path);
    expect(normal.status).toBe(200);
    expect(await normal.json()).toMatchObject({ success: true, data: { totalAmount: 5000, conversionCount: 1 } });

    dbMocks.previewAffiliateAccountSettlement.mockResolvedValueOnce({ ...preview, totalAmount: 0, conversionCount: 0, affiliates: [] });
    const empty = await request(path);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ data: { totalAmount: 0, affiliates: [] } });
  });

  it('スタッフ権限とaccount範囲をサーバで検査する', async () => {
    const path = '/api/affiliate-settlements/preview?lineAccountId=account-1&periodFrom=2026-08-01T00:00:00.000Z&periodTo=2026-08-31T23:59:59.000Z';
    expect((await request(path, { role: 'staff' })).status).toBe(403);
    expect((await request(path, { role: 'staff', permissions: ['affiliate.report.view'] })).status).toBe(200);
    accountAccess.getVisibleLineAccountScope.mockResolvedValueOnce({ allowedAccountIds: [] });
    expect((await request(path)).status).toBe(404);
  });

  it('確定は再実行キーと版を必須にし、競合を409にする', async () => {
    const body = {
      lineAccountId: 'account-1', periodFrom: preview.periodFrom, periodTo: preview.periodTo,
      expectedPreviewVersion: preview.previewVersion,
    };
    expect((await request('/api/affiliate-settlements', { method: 'POST', body })).status).toBe(400);
    const created = await request('/api/affiliate-settlements', {
      method: 'POST', body, headers: { 'Idempotency-Key': 'settlement-request-1' },
    });
    expect(created.status).toBe(201);
    dbMocks.closeAffiliateAccountSettlement.mockResolvedValueOnce({ kind: 'changed' });
    const changed = await request('/api/affiliate-settlements', {
      method: 'POST', body, headers: { 'Idempotency-Key': 'settlement-request-2' },
    });
    expect(changed.status).toBe(409);
  });

  it('DB異常を空扱いにせず500にする', async () => {
    dbMocks.previewAffiliateAccountSettlement.mockRejectedValueOnce(new Error('db down'));
    const response = await request('/api/affiliate-settlements/preview?lineAccountId=account-1&periodFrom=2026-08-01&periodTo=2026-08-31');
    expect(response.status).toBe(500);
  });
});

describe('affiliate payout and statement API', () => {
  it('振込先未登録を409で返す', async () => {
    dbMocks.createAffiliatePayoutBatch.mockResolvedValueOnce({
      kind: 'bank_missing', missingAffiliateIds: ['affiliate-1'],
    });
    const response = await request('/api/affiliate-payout-batches', {
      method: 'POST', headers: { 'Idempotency-Key': 'payout-batch-request-1' },
      body: { lineAccountId: 'account-1', settlementId: 'settlement-1', expectedVersion: 1, bankFormat: 'zengin_csv' },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ missingAffiliateIds: ['affiliate-1'] });
  });

  it('CSV出力にMFAを要求し、成功時だけ暗号口座を復号してR2へ保存する', async () => {
    dbMocks.consumeStepUpGrant.mockResolvedValueOnce(false);
    const missingMfa = await request('/api/affiliate-payout-batches/batch-1/export', {
      method: 'POST', headers: { 'Idempotency-Key': 'payout-export-request-1', 'X-Step-Up-Token': 'expired' },
      body: { lineAccountId: 'account-1', expectedVersion: 1 },
    });
    expect(missingMfa.status).toBe(428);

    const exported = await request('/api/affiliate-payout-batches/batch-1/export', {
      method: 'POST', headers: { 'Idempotency-Key': 'payout-export-request-2', 'X-Step-Up-Token': 'fresh-token' },
      body: { lineAccountId: 'account-1', expectedVersion: 1 },
    });
    expect(exported.status).toBe(200);
    expect(dbMocks.decryptCredential).toHaveBeenCalledWith('encrypted', 'test-key');
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(JSON.stringify(await exported.json())).not.toContain('1234567');
  });

  it('明細をsnapshotから生成し、新規時だけ紹介者へLINE通知する', async () => {
    const response = await request('/api/affiliate-statements', {
      method: 'POST', headers: { 'Idempotency-Key': 'statement-request-1' },
      body: { lineAccountId: 'account-1', settlementId: 'settlement-1', affiliateId: 'affiliate-1', expectedVersion: 1 },
    });
    expect(response.status).toBe(201);
    expect(bucket.put).toHaveBeenCalledWith(expect.stringContaining('affiliate-statements/'), expect.any(Uint8Array), expect.anything());
    expect(notifier.notifyAffiliate).toHaveBeenCalledWith(env.DB, env, 'affiliate-1', expect.stringContaining('¥5,000'));

    dbMocks.getAffiliateStatementReplay.mockResolvedValueOnce({
      statement: { id: 'statement-1', version: 1 }, requestFingerprint: await import('../middleware/auth.js').then(({ sha256Hex }) => sha256Hex(JSON.stringify({
        lineAccountId: 'account-1', settlementId: 'settlement-1', affiliateId: 'affiliate-1', expectedVersion: 1,
      }))), objectKey: 'statement.pdf',
    });
    const replay = await request('/api/affiliate-statements', {
      method: 'POST', headers: { 'Idempotency-Key': 'statement-request-1' },
      body: { lineAccountId: 'account-1', settlementId: 'settlement-1', affiliateId: 'affiliate-1', expectedVersion: 1 },
    });
    expect(replay.status).toBe(200);
    expect(notifier.notifyAffiliate).toHaveBeenCalledTimes(1);
  });
});
