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
  recordBulk: vi.fn(),
  resolveCredential: vi.fn(),
  push: vi.fn(),
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
  recordBulkDecisionNotificationResult: mocks.recordBulk,
  resolveLineCredential: mocks.resolveCredential,
  consumeStepUpGrant: mocks.consumeStepUp,
  issuePhotoOriginalDownload: mocks.issueDownload,
  consumePhotoOriginalDownload: mocks.consumeDownload,
}));
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.accountAccess }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: mocks.push }));

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

type BulkEntry = { query: string; bindings: unknown[] };

function bulkHarness(options: { recipients?: string[] } = {}) {
  const batches: BulkEntry[][] = [];
  const known = new Set(options.recipients ?? []);
  const db = {
    prepare(query: string) {
      const entry: BulkEntry = { query, bindings: [] };
      const statement = {
        query,
        get bindings() { return entry.bindings; },
        bind(...bindings: unknown[]) { entry.bindings = bindings; return statement; },
        async first() {
          if (!query.includes('FROM nen_photo_submissions ps')) return null;
          const photoId = String(entry.bindings[0] ?? '');
          if (!known.has(photoId)) return null;
          return {
            id: photoId, friend_id: 'friend-1', line_user_id: 'U1',
            line_account_id: 'account-a', is_following: 1,
            channel_access_token: 'token', channel_access_token_encrypted: null,
          };
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
      return statement;
    },
    async batch(items: Array<{ query: string; bindings: unknown[] }>) {
      const entries = items.map((item) => ({ query: item.query, bindings: [...item.bindings] }));
      batches.push(entries);
      return entries.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-a', name: '担当者', role: 'staff', readOnly: false,
      permissionKeys: ['photo.submission.view', 'photo.submission.review', 'photo.submission.bulk_review'],
    });
    c.env = { DB: db, WORKER_PUBLIC_URL: 'https://worker.example' };
    await next();
  });
  app.route('/', nenPhotoOperations);
  return { app, batches };
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
  mocks.recordBulk.mockResolvedValue(true);
  mocks.resolveCredential.mockResolvedValue('resolved-token');
  mocks.push.mockResolvedValue(undefined);
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

  it('一括の各対象へ単票と同じ文面を送り、送達を記録する', async () => {
    mocks.bulk.mockResolvedValue({
      kind: 'created',
      result: {
        updatedCount: 2,
        items: [
          { photoId: 'photo-1', decision: 'approve', reviewVersion: 2, decisionId: 'decision-1' },
          { photoId: 'photo-2', decision: 'return', reviewVersion: 3, decisionId: 'decision-2' },
        ],
      },
    });
    const { app, batches } = bulkHarness({ recipients: ['photo-1', 'photo-2'] });
    const response = await app.request('/api/nen-members/photos/decisions/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'bulk-notify-1' },
      body: JSON.stringify({
        lineAccountId: 'account-a',
        decisions: [
          { photoId: 'photo-1', decision: 'approve', expectedVersion: 1 },
          { photoId: 'photo-2', decision: 'return', expectedVersion: 2, reasonCode: 'privacy', reasonNote: '補足' },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: { items: Array<{ notificationStatus: string }>; notificationFailures: unknown[] };
    };
    expect(body.data.items.map((item) => item.notificationStatus)).toEqual(['sent', 'sent']);
    expect(body.data.notificationFailures).toEqual([]);
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenNthCalledWith(
      1, 'https://worker.example', 'resolved-token', 'U1',
      [{ type: 'text', text: expect.stringContaining('5ポイント') }],
      'nen-photo-review:decision-1', expect.any(Function),
    );
    expect(mocks.push).toHaveBeenNthCalledWith(
      2, 'https://worker.example', 'resolved-token', 'U1',
      [{ type: 'text', text: expect.stringContaining('人の顔や個人情報が写っている') }],
      'nen-photo-review:decision-2', expect.any(Function),
    );
    const submissions = batches.flat().filter((entry) => entry.query.includes('review_notification_status'));
    expect(submissions).toHaveLength(2);
    expect(submissions[0].bindings[0]).toBe('sent');
    const events = batches.flat().filter((entry) => entry.query.includes('nen_photo_review_events'));
    expect(events).toHaveLength(2);
    expect(events[0].bindings[0]).toBe('sent');
    expect(mocks.recordBulk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lineAccountId: 'account-a', actorId: 'staff-a', idempotencyKey: 'bulk-notify-1',
    }));
  });

  it('一部送信失敗でも残りを送り、失敗分だけ再試行対象にする', async () => {
    mocks.bulk.mockResolvedValue({
      kind: 'created',
      result: {
        updatedCount: 3,
        items: [
          { photoId: 'photo-1', decision: 'approve', reviewVersion: 2, decisionId: 'decision-1' },
          { photoId: 'photo-2', decision: 'return', reviewVersion: 3, decisionId: 'decision-2' },
          { photoId: 'photo-9', decision: 'return', reviewVersion: 2, decisionId: 'decision-9' },
        ],
      },
    });
    mocks.push.mockImplementation(async (...args: unknown[]) => {
      if (args[4] === 'nen-photo-review:decision-2') throw new Error('LINE unavailable');
    });
    const { app, batches } = bulkHarness({ recipients: ['photo-1', 'photo-2'] });
    const response = await app.request('/api/nen-members/photos/decisions/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'bulk-notify-2' },
      body: JSON.stringify({
        lineAccountId: 'account-a',
        decisions: [
          { photoId: 'photo-1', decision: 'approve', expectedVersion: 1 },
          { photoId: 'photo-2', decision: 'return', expectedVersion: 2, reasonCode: 'quality', reasonNote: '' },
          { photoId: 'photo-9', decision: 'return', expectedVersion: 1, reasonCode: 'quality', reasonNote: '' },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: {
        items: Array<{ photoId: string; notificationStatus: string; notificationError?: string }>;
        notificationFailures: Array<{ photoId: string; error: string }>;
      };
    };
    expect(body.data.items.map((item) => item.notificationStatus)).toEqual(['sent', 'failed', 'failed']);
    expect(body.data.notificationFailures).toEqual([
      { photoId: 'photo-2', error: 'LINE unavailable' },
      { photoId: 'photo-9', error: '通知先が見つかりません' },
    ]);
    const events = batches.flat().filter((entry) => entry.query.includes('nen_photo_review_events'));
    expect(events.map((entry) => entry.bindings[0])).toEqual(['sent', 'failed', 'failed']);
  });

  it('重複鍵の再送では保存済み結果を返すだけでLINEを再送しない', async () => {
    const stored = {
      updatedCount: 1,
      items: [{ photoId: 'photo-1', decision: 'approve', reviewVersion: 2, decisionId: 'decision-1', notificationStatus: 'sent' }],
      notificationFailures: [],
    };
    mocks.bulk.mockResolvedValue({ kind: 'duplicate', result: stored });
    const { app } = bulkHarness({ recipients: ['photo-1'] });
    const response = await app.request('/api/nen-members/photos/decisions/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'bulk-notify-1' },
      body: JSON.stringify({
        lineAccountId: 'account-a',
        decisions: [{ photoId: 'photo-1', decision: 'approve', expectedVersion: 1 }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true, data: stored });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.recordBulk).not.toHaveBeenCalled();
  });

  it('一括は権限なし403と0件400で審査も通知もしない', async () => {
    const forbidden = await harness({ permissions: ['photo.submission.view'] })
      .request('/api/nen-members/photos/decisions/bulk', {
        method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'bulk-no-perm' },
        body: JSON.stringify({
          lineAccountId: 'account-a',
          decisions: [{ photoId: 'photo-1', decision: 'approve', expectedVersion: 1 }],
        }),
      });
    expect(forbidden.status).toBe(403);
    const empty = await harness().request('/api/nen-members/photos/decisions/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'bulk-empty' },
      body: JSON.stringify({ lineAccountId: 'account-a', decisions: [] }),
    });
    expect(empty.status).toBe(400);
    expect(mocks.bulk).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
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
