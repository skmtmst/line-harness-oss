import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for the approval queue endpoints:
//   GET   /api/conversions/approvals?status=…
//   PATCH /api/conversions/events/:id/approval
// The db layer is mocked (real SQL is covered in packages/db/test). Here we
// assert status validation, the injected IDENTITY_KEY_SQL wiring, duplicateFlag
// pass-through, and the 404 for missing / non-attributed events.
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getLineAccountScopeEntries: vi.fn(async (...args: unknown[]) => dbMocks.getLineAccounts(...args)),
  getAccountSetting: vi.fn().mockResolvedValue(null),
  getVersionedAccountSetting: vi.fn().mockResolvedValue({
    version: 1,
    data: { features: { affiliates: true } },
  }),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // conversions route deps
  getConversionPoints: vi.fn(),
  getConversionPointById: vi.fn(),
  createConversionPoint: vi.fn(),
  stopConversionPoint: vi.fn(),
  trackConversion: vi.fn(),
  getConversionEvents: vi.fn(),
  getConversionReport: vi.fn(),
  getConversionApprovalQueue: vi.fn(),
  setConversionApproval: vi.fn(),
  decideConversionApproval: vi.fn(),
  getApprovalNotificationState: vi.fn(),
  markApprovalNotified: vi.fn(),
  releaseApprovalNotification: vi.fn(),
  getConversionApprovalNotifyInfo: vi.fn(),
  // N-212 の案件動作はここでは対象外 — 案件なしとして通す。
  getConversionOfferActionPlan: vi.fn().mockResolvedValue(null),
  syncAffiliateConversionMileage: vi.fn().mockResolvedValue(undefined),
  listConversionDefinitions: vi.fn(),
  getConversionDefinitionDetail: vi.fn(),
  addConversionDefinitionUsage: vi.fn(),
  getConversionDefinitionReport: vi.fn(),
  listConversionDefinitionsForExport: vi.fn(),
  ConversionDefinitionError: class ConversionDefinitionError extends Error {},
  CONVERSION_DEFINITION_USAGE_KINDS: [],
};
vi.mock('@line-crm/db', () => dbMocks);

// Mock the affiliate notifier so the approval route's push is observable
// without touching LINE / the DB resolution chain.
const notifyAffiliateApproval = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateApproval }));

const worker = (await import('../index.js')).default;

const API_KEY = 'test-owner-key';
const env = {
  DB: {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => sql.includes('WHERE ce.id = ?') ? { line_account_id: null } : null),
      all: vi.fn(async () => ({ results: [
        { id: 'ev-1' },
        { id: 'ev-dup' },
      ] })),
    })),
  } as unknown as D1Database,
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  API_KEY,
  WORKER_URL: 'https://worker.example.com',
} as unknown as import('../index.js').Env['Bindings'];

function req(method: string, path: string, body?: unknown) {
  const separator = path.includes('?') ? '&' : '?';
  const scopedPath = `${path}${separator}accountId=account-1`;
  const headers = new Headers({ Authorization: `Bearer ${API_KEY}` });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return worker.fetch(
    new Request(`https://worker.example.com${scopedPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([
    { id: 'account-1', tenant_id: '00000000-0000-4000-8000-000000000001' },
  ]);
  dbMocks.syncAffiliateConversionMileage.mockResolvedValue(undefined);
  // R354: 承認世代の通知は未送信として扱い、初回承認の通知を通す。
  dbMocks.getApprovalNotificationState.mockResolvedValue({
    send: true,
    approvedAt: '2026-09-01T00:00:00.000+09:00',
  });
  dbMocks.markApprovalNotified.mockResolvedValue(true);
});

describe('GET /api/conversions/approvals', () => {
  it('returns the queue with duplicateFlag and injects IDENTITY_KEY_SQL', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([
      {
        eventId: 'ev-1',
        createdAt: '2026-01-01 00:00:00',
        friendId: 'f-1',
        friendName: 'Alice',
        affiliateId: 'aff-1',
        affiliateName: 'AffA',
        offerName: 'キャンペーンA',
        conversionPointName: '購入',
        value: 500,
        approvalStatus: 'pending',
        duplicateFlag: true,
      },
    ]);

    const res = await req('GET', '/api/conversions/approvals?status=pending');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ eventId: string; duplicateFlag: boolean }> };
    expect(body.data[0].eventId).toBe('ev-1');
    expect(body.data[0].duplicateFlag).toBe(true);

    const callArgs = dbMocks.getConversionApprovalQueue.mock.calls[0][1];
    expect(callArgs.status).toBe('pending');
    // The route injects the identity-key SQL fragment (referencing friends.*).
    expect(String(callArgs.identityKeySql)).toContain('friends');
  });

  it('defaults status to pending when omitted', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    await req('GET', '/api/conversions/approvals');
    expect(dbMocks.getConversionApprovalQueue.mock.calls[0][1].status).toBe('pending');
  });

  it('rejects an invalid status with 400', async () => {
    const res = await req('GET', '/api/conversions/approvals?status=bogus');
    expect(res.status).toBe(400);
    expect(dbMocks.getConversionApprovalQueue).not.toHaveBeenCalled();
  });

  it('accepts approved and rejected', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    expect((await req('GET', '/api/conversions/approvals?status=approved')).status).toBe(200);
    expect((await req('GET', '/api/conversions/approvals?status=rejected')).status).toBe(200);
  });

  it('clamps non-numeric limit to default 200', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    await req('GET', '/api/conversions/approvals?limit=abc');
    const callArgs = dbMocks.getConversionApprovalQueue.mock.calls[0][1];
    expect(callArgs.limit).toBe(200);
  });

  it('clamps oversized limit to 200', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    await req('GET', '/api/conversions/approvals?limit=99999');
    const callArgs = dbMocks.getConversionApprovalQueue.mock.calls[0][1];
    expect(callArgs.limit).toBe(200);
  });

  it('does not pass a negative limit or offset to the database', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    await req('GET', '/api/conversions/approvals?limit=-1&offset=-2');
    const callArgs = dbMocks.getConversionApprovalQueue.mock.calls[0][1];
    expect(callArgs).toMatchObject({ limit: 200, offset: 0 });
  });
});

describe('GET /api/conversions/events', () => {
  it('clamps huge, negative, and non-numeric pagination values', async () => {
    dbMocks.getConversionEvents.mockResolvedValue([]);
    await req('GET', '/api/conversions/events?limit=999999&offset=-1');
    expect(dbMocks.getConversionEvents.mock.calls[0][1]).toMatchObject({ limit: 200, offset: 0 });

    await req('GET', '/api/conversions/events?limit=NaN');
    expect(dbMocks.getConversionEvents.mock.calls[1][1]).toMatchObject({ limit: 100, offset: 0 });
  });
});

describe('PATCH /api/conversions/events/:id/approval', () => {
  it('approves an attributed event', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'updated', currentStatus: 'approved' });
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue({
      affiliateId: 'aff-1',
      offerName: '案件X',
      rewardAmount: 5000,
      notifyOnConversion: true,
    });
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { approvalStatus: string } };
    expect(body.data.approvalStatus).toBe('approved');
    expect(dbMocks.decideConversionApproval).toHaveBeenCalledWith(
      expect.anything(),
      'ev-1',
      'approved',
      'pending',
    );
    expect(dbMocks.syncAffiliateConversionMileage).toHaveBeenCalledWith(
      expect.anything(),
      'ev-1',
      'approved',
    );
  });

  it('notifies the affiliate on approval', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'updated', currentStatus: 'approved' });
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue({
      affiliateId: 'aff-1',
      offerName: '案件X',
      rewardAmount: 5000,
      notifyOnConversion: true,
    });
    await req('PATCH', '/api/conversions/events/ev-1/approval', { status: 'approved', expectedStatus: 'pending' });
    expect(notifyAffiliateApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'aff-1',
      '案件X',
      5000,
    );
  });

  it('does NOT notify the affiliate on rejection', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'updated', currentStatus: 'approved' });
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'rejected',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.getConversionApprovalNotifyInfo).not.toHaveBeenCalled();
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
  });

  it('still returns 200 when the notify lookup finds nothing', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'updated', currentStatus: 'approved' });
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue(null);
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(200);
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
  });

  it('rejects an unknown status with 400', async () => {
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'pending',
    });
    expect(res.status).toBe(400);
    expect(dbMocks.decideConversionApproval).not.toHaveBeenCalled();
  });

  it('rejects a missing status with 400', async () => {
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {});
    expect(res.status).toBe(400);
  });

  it('404s a missing or non-attributed event', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'not_found', currentStatus: 'pending' });
    const res = await req('PATCH', '/api/conversions/events/nope/approval', {
      status: 'rejected',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(404);
  });

  it('returns 422 with an operator message when the reward basis is undeterminable (F-23 unbillable)', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'unbillable', currentStatus: 'pending' });
    const res = await req('PATCH', '/api/conversions/events/ev-unpriced/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { success: boolean; code: string; data: { currentStatus: string } };
    expect(body.success).toBe(false);
    expect(body.code).toBe('approval_unbillable');
    expect(body.data.currentStatus).toBe('pending');
    // 承認していないので台帳同期・通知・案件動作へ進まない。
    expect(dbMocks.syncAffiliateConversionMileage).not.toHaveBeenCalled();
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
  });

  it('returns 200 without calling notifyAffiliate when status is already_set (double-click guard)', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'already_set', currentStatus: 'approved' });
    // R354: 同じ承認世代の通知は送り済みなので送らない。
    dbMocks.getApprovalNotificationState.mockResolvedValue({
      send: false,
      approvedAt: '2026-09-01T00:00:00.000+09:00',
    });
    const res = await req('PATCH', '/api/conversions/events/ev-dup/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { approvalStatus: string } };
    expect(body.data.approvalStatus).toBe('approved');
    expect(dbMocks.syncAffiliateConversionMileage).toHaveBeenCalledWith(
      expect.anything(),
      'ev-dup',
      'approved',
    );
    // Critical: notify must NOT be called for an idempotent no-op
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
    expect(dbMocks.getConversionApprovalNotifyInfo).not.toHaveBeenCalled();
  });

  it('notifies once on already_set when the approval generation was never notified (R354 repair)', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'already_set', currentStatus: 'approved' });
    dbMocks.getApprovalNotificationState.mockResolvedValue({
      send: true,
      approvedAt: '2026-09-01T00:00:00.000+09:00',
    });
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue({
      affiliateId: 'aff-1',
      offerName: '案件X',
      rewardAmount: 5000,
      notifyOnConversion: true,
    });
    dbMocks.markApprovalNotified.mockResolvedValue(true);
    const res = await req('PATCH', '/api/conversions/events/ev-dup/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(200);
    expect(notifyAffiliateApproval).toHaveBeenCalledTimes(1);
    expect(dbMocks.markApprovalNotified).toHaveBeenCalledWith(
      expect.anything(),
      'ev-dup',
      '2026-09-01T00:00:00.000+09:00',
    );
  });

  it('sends only once when the same decision arrives concurrently (R354)', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'updated', currentStatus: 'approved' });
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue({
      affiliateId: 'aff-1',
      offerName: '案件X',
      rewardAmount: 5000,
      notifyOnConversion: true,
    });
    // 両方の要求が send=true を見る（読み直しの前に両方が到達）。
    // CAS は勝った1件だけ通す — 実DBの markApprovalNotified と同じ契約。
    dbMocks.markApprovalNotified.mockResolvedValue(false);
    dbMocks.markApprovalNotified.mockResolvedValueOnce(true);

    const [first, second] = await Promise.all([
      req('PATCH', '/api/conversions/events/ev-1/approval', { status: 'approved', expectedStatus: 'pending' }),
      req('PATCH', '/api/conversions/events/ev-1/approval', { status: 'approved', expectedStatus: 'pending' }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // 同じ承認判断の通知は1件だけ。送信権の確保が送信より先。
    expect(notifyAffiliateApproval).toHaveBeenCalledTimes(1);
    expect(dbMocks.markApprovalNotified.mock.invocationCallOrder[0]).toBeLessThan(
      notifyAffiliateApproval.mock.invocationCallOrder[0],
    );
  });

  it('releases the claim on send failure so a retry resends without loss (R354)', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'updated', currentStatus: 'approved' });
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue({
      affiliateId: 'aff-1',
      offerName: '案件X',
      rewardAmount: 5000,
      notifyOnConversion: true,
    });
    // 実送信の代わりに1回だけ落とす。本物の送信部は投げない契約だが、
    // 途中で落ちた場合の欠落防止を隔離して確かめる。
    // 注記: この「欠落なし」は通知口の投げに限る。実際の配信側の失敗
    // （503など）は呑み込む best-effort のままで、再送の回復は未検証。
    // R354の守りは承認の決定・台帳と送信権（CAS）の1回限り。
    notifyAffiliateApproval.mockRejectedValueOnce(new Error('push down'));

    const failed = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    // 通知の失敗は承認を巻き添えにしない。
    expect(failed.status).toBe(200);
    expect(dbMocks.releaseApprovalNotification).toHaveBeenCalledWith(
      expect.anything(),
      'ev-1',
      '2026-09-01T00:00:00.000+09:00',
    );

    // 再試行では送り直す（欠落なし）。試行は失敗1＋成功1の2回。
    const retried = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    expect(retried.status).toBe(200);
    expect(notifyAffiliateApproval).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when the mileage projection fails so a retry can repair it', async () => {
    dbMocks.decideConversionApproval.mockResolvedValue({ outcome: 'updated', currentStatus: 'approved' });
    dbMocks.syncAffiliateConversionMileage.mockRejectedValue(new Error('ledger unavailable'));
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
      expectedStatus: 'pending',
    });
    expect(res.status).toBe(500);
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
  });
});
