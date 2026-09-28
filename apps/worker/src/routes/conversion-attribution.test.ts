import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for the attribution explanation endpoint (#823):
//   GET /api/conversions/events/:id/attribution
// The db layer is mocked — real decision behaviour is covered against SQLite
// in packages/db/test/472_473_affiliate_rules.test.ts. Here we assert the
// visible-scope guard, serialization, and the 404 for a conversion without
// a recorded decision.
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
  getConversionApprovalNotifyInfo: vi.fn(),
  getConversionOfferActionPlan: vi.fn().mockResolvedValue(null),
  syncAffiliateConversionMileage: vi.fn().mockResolvedValue(undefined),
  listConversionDefinitions: vi.fn(),
  getConversionDefinitionDetail: vi.fn(),
  addConversionDefinitionUsage: vi.fn(),
  getConversionDefinitionReport: vi.fn(),
  listConversionDefinitionsForExport: vi.fn(),
  ConversionDefinitionError: class ConversionDefinitionError extends Error {},
  CONVERSION_DEFINITION_USAGE_KINDS: [],
  getAttributionDecisionView: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

vi.mock('../services/affiliate-notifier.js', () => ({
  notifyAffiliateApproval: vi.fn().mockResolvedValue(undefined),
}));

const worker = (await import('../index.js')).default;

const API_KEY = 'test-owner-key';
const env = {
  DB: {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => sql.includes('WHERE ce.id = ?') ? { line_account_id: null } : null),
      all: vi.fn(async () => ({ results: [] })),
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
});

const DECISION_VIEW = {
  conversionEventId: 'ev-1',
  affiliateId: 'aff-1',
  refCode: 'ref-1',
  offerId: 'off-1',
  offerVersionId: 'ver-1',
  reason: 'matched_last_touch',
  windowDays: 30,
  candidates: [
    {
      affiliateId: 'aff-1',
      affiliateName: 'はなこ',
      refCode: 'ref-1',
      touchedAt: '2026-09-20T10:02:00.000+09:00',
      offerId: 'off-1',
      offerName: '定期便',
      chosen: true,
      skipReason: null,
      windowDays: 30,
    },
    {
      affiliateId: 'aff-2',
      affiliateName: 'けんた',
      refCode: 'ref-2',
      touchedAt: '2026-09-18T21:40:00.000+09:00',
      offerId: 'off-1',
      offerName: '定期便',
      chosen: false,
      skipReason: 'out_of_window',
      windowDays: 30,
    },
  ],
  createdAt: '2026-09-27T12:00:00.000+09:00',
};

describe('GET /api/conversions/events/:id/attribution', () => {
  it('returns the decision with one row per candidate', async () => {
    dbMocks.getAttributionDecisionView.mockResolvedValue(DECISION_VIEW);
    const res = await req('GET', '/api/conversions/events/ev-1/attribution');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: typeof DECISION_VIEW };
    expect(body.success).toBe(true);
    expect(body.data.reason).toBe('matched_last_touch');
    expect(body.data.windowDays).toBe(30);
    expect(body.data.candidates).toHaveLength(2);
    expect(body.data.candidates[0]).toMatchObject({ chosen: true, skipReason: null });
    expect(body.data.candidates[1]).toMatchObject({ chosen: false, skipReason: 'out_of_window' });
    expect(dbMocks.getAttributionDecisionView).toHaveBeenCalledWith(expect.anything(), 'ev-1');
  });

  it('returns 404 when no decision was recorded', async () => {
    dbMocks.getAttributionDecisionView.mockResolvedValue(null);
    const res = await req('GET', '/api/conversions/events/ev-old/attribution');
    expect(res.status).toBe(404);
  });
});
