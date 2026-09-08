import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  accountAccess: vi.fn(),
  metrics: vi.fn(),
  assessment: vi.fn(),
  processAsset: vi.fn(),
  assetStatus: vi.fn(),
  derivatives: vi.fn(),
  bulk: vi.fn(),
  consumeStepUp: vi.fn(),
  issueDownload: vi.fn(),
  consumeDownload: vi.fn(),
  r2Get: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getPhotoReviewMetrics: mocks.metrics,
  requestPhotoAssessment: mocks.assessment,
  requestPhotoAssetProcessing: mocks.processAsset,
  getPhotoAssetStatus: mocks.assetStatus,
  getPhotoDerivatives: mocks.derivatives,
  applyBulkPhotoDecisions: mocks.bulk,
  consumeStepUpGrant: mocks.consumeStepUp,
  issuePhotoOriginalDownload: mocks.issueDownload,
  consumePhotoOriginalDownload: mocks.consumeDownload,
}));
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.accountAccess }));

const { nenPhotoOperations } = await import('./nen-photo-operations.js');

function harness(options: { permissions?: string[]; role?: 'owner' | 'admin' | 'staff' } = {}) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-a', name: '担当者', role: options.role ?? 'staff', readOnly: false,
      permissionKeys: options.permissions ?? [
        'photo.submission.view', 'photo.submission.review',
        'photo.submission.bulk_review', 'photo.original.download',
      ],
    });
    c.env = { DB: {}, IMAGES: { get: mocks.r2Get } };
    await next();
  });
  app.route('/', nenPhotoOperations);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountAccess.mockResolvedValue(true);
  mocks.metrics.mockResolvedValue({
    pendingCount: 2, reviewedCount: 3, averageReviewMinutes: 14.5,
    oldestPendingAt: '2026-09-01T00:00:00.000Z', attentionCount: 1,
  });
  mocks.assessment.mockResolvedValue({
    kind: 'created', run: { id: 'assessment-1', status: 'queued', requestedVersion: 1 },
  });
  mocks.processAsset.mockResolvedValue({
    kind: 'created', run: { id: 'asset-1', status: 'queued', operation: 'all' },
  });
  mocks.assetStatus.mockResolvedValue({ reviewVersion: 1, jobs: [] });
  mocks.derivatives.mockResolvedValue({ reviewVersion: 1, items: [], knownUrls: [] });
  mocks.bulk.mockResolvedValue({ kind: 'created', result: { updatedCount: 1 } });
  mocks.consumeStepUp.mockResolvedValue(true);
  mocks.issueDownload.mockResolvedValue({ kind: 'created', expiresAt: '2026-09-01T00:05:00.000Z' });
  mocks.consumeDownload.mockResolvedValue({
    photoId: 'photo-1', objectKey: 'original/photo-1.jpg', contentType: 'image/jpeg',
  });
  mocks.r2Get.mockResolvedValue({ body: new Uint8Array([1, 2, 3]) });
});

describe('photo review operations API', () => {
  it('normal: 実集計とnullを保った空集計を返す', async () => {
    const app = harness();
    const normal = await app.request('/api/nen-members/photos/review-metrics?accountId=account-a');
    expect(normal.status).toBe(200);
    expect(await normal.json()).toMatchObject({ data: { pendingCount: 2, averageReviewMinutes: 14.5 } });

    mocks.metrics.mockResolvedValueOnce({
      pendingCount: 0, reviewedCount: 0, averageReviewMinutes: null,
      oldestPendingAt: null, attentionCount: 0,
    });
    const empty = await app.request('/api/nen-members/photos/review-metrics?accountId=account-a');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ data: { pendingCount: 0, averageReviewMinutes: null } });
  });

  it('error: DB障害を成功や空データに見せない', async () => {
    mocks.metrics.mockRejectedValueOnce(new Error('D1 unavailable'));
    const response = await harness().request('/api/nen-members/photos/review-metrics?accountId=account-a');
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it('forbidden: 専用権限がなければDBを読まない', async () => {
    const response = await harness({ permissions: [] })
      .request('/api/nen-members/photos/review-metrics?accountId=account-a');
    expect(response.status).toBe(403);
    expect(mocks.metrics).not.toHaveBeenCalled();
  });

  it('アカウント範囲外を404にし、存在を漏らさない', async () => {
    mocks.accountAccess.mockResolvedValueOnce(false);
    const response = await harness().request('/api/nen-members/photos/review-metrics?accountId=account-b');
    expect(response.status).toBe(404);
    expect(mocks.metrics).not.toHaveBeenCalled();
  });

  it('再評価と派生画像処理で版・再実行キーを必須にする', async () => {
    const app = harness();
    const missing = await app.request('/api/nen-members/photos/photo-1/assessments/re-evaluate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-a', expectedVersion: 1 }),
    });
    expect(missing.status).toBe(400);

    const assessment = await app.request('/api/nen-members/photos/photo-1/assessments/re-evaluate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'assessment-key' },
      body: JSON.stringify({ lineAccountId: 'account-a', expectedVersion: 1 }),
    });
    expect(assessment.status).toBe(202);
    expect(await assessment.json()).toMatchObject({ data: { status: 'queued' } });

    const asset = await app.request('/api/nen-members/photos/photo-1/assets/process', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'asset-key-1' },
      body: JSON.stringify({ lineAccountId: 'account-a', expectedVersion: 1, operation: 'all' }),
    });
    expect(asset.status).toBe(202);
    expect(mocks.processAsset).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operation: 'all' }));
  });

  it('版競合と冪等性競合を409で返す', async () => {
    mocks.assessment.mockResolvedValueOnce({ kind: 'changed' });
    const version = await harness().request('/api/nen-members/photos/photo-1/assessments/re-evaluate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'assessment-key' },
      body: JSON.stringify({ lineAccountId: 'account-a', expectedVersion: 1 }),
    });
    expect(version.status).toBe(409);
    expect(await version.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

    mocks.assessment.mockResolvedValueOnce({ kind: 'idempotency_conflict' });
    const duplicate = await harness().request('/api/nen-members/photos/photo-1/assessments/re-evaluate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'assessment-key' },
      body: JSON.stringify({ lineAccountId: 'account-a', expectedVersion: 1 }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('一括審査は専用権限と低リスク判定を強制する', async () => {
    const request = {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'bulk-key-1' },
      body: JSON.stringify({
        lineAccountId: 'account-a',
        decisions: [{ photoId: 'photo-1', decision: 'approve', expectedVersion: 1 }],
      }),
    } satisfies RequestInit;
    expect((await harness({ permissions: ['photo.submission.view'] })
      .request('/api/nen-members/photos/decisions/bulk', request)).status).toBe(403);
    const success = await harness().request('/api/nen-members/photos/decisions/bulk', request);
    expect(success.status).toBe(201);

    mocks.bulk.mockResolvedValueOnce({ kind: 'risk_not_low', photoId: 'photo-1' });
    const risk = await harness().request('/api/nen-members/photos/decisions/bulk', request);
    expect(risk.status).toBe(409);
    expect(await risk.json()).toMatchObject({ photoId: 'photo-1' });
  });

  it('一括の戻し理由は単体と同じく補足を素で保存する(#500 軽)', async () => {
    const response = await harness().request('/api/nen-members/photos/decisions/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'bulk-key-note' },
      body: JSON.stringify({
        lineAccountId: 'account-a',
        decisions: [{ photoId: 'photo-1', decision: 'return', expectedVersion: 2, reasonCode: 'privacy', reasonNote: '補足' }],
      }),
    });
    expect(response.status).toBe(201);
    expect(mocks.bulk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      decisions: [expect.objectContaining({ reasonCode: 'privacy', reasonNote: '補足' })],
    }));
  });

  it('原本URL発行は専用権限・再認証・版を要求し、取得は一回限りにする', async () => {
    const body = JSON.stringify({ lineAccountId: 'account-a', expectedVersion: 1 });
    const withoutStepUp = await harness().request('/api/nen-members/photos/photo-1/original-download', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'download-key-1' }, body,
    });
    expect(withoutStepUp.status).toBe(428);

    const issued = await harness().request('/api/nen-members/photos/photo-1/original-download', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'Idempotency-Key': 'download-key-1', 'X-Step-Up-Token': 'step-up-token',
      },
      body,
    });
    expect(issued.status).toBe(201);
    expect(await issued.json()).toMatchObject({ data: { oneTime: true, downloadUrl: expect.any(String) } });
    expect(mocks.consumeStepUp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      purpose: 'photo.original.download', staffId: 'staff-a',
    }));

    const downloaded = await harness().request(
      '/api/nen-members/photos/original-download/token?accountId=account-a',
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('cache-control')).toBe('private, no-store');

    mocks.consumeDownload.mockResolvedValueOnce(null);
    expect((await harness().request(
      '/api/nen-members/photos/original-download/token?accountId=account-a',
    )).status).toBe(404);
  });
});
