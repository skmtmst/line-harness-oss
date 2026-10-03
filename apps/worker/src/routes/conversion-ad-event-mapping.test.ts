import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for the F-21 mapping endpoints:
//   GET /api/conversions/points/:id/ad-event-mapping
//   PUT /api/conversions/points/:id/ad-event-mapping
// The db layer is mocked. Real persistence is covered against SQLite
// in packages/db/test/556_ad_event_mappings.test.ts. Here we assert the
// visible-scope guard, serialization, and validation.
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getLineAccountScopeEntries: vi.fn(async (...args: unknown[]) => dbMocks.getLineAccounts(...args)),
  getAccountSetting: vi.fn().mockResolvedValue(null),
  getVersionedAccountSetting: vi.fn().mockResolvedValue({
    version: 1,
    data: { features: { affiliates: true } },
  }),
  getStaffByApiKey: vi.fn(),
  getStaffById: vi.fn(),
  getActiveImpersonation: vi.fn().mockResolvedValue(null),
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
  getAdEventMapping: vi.fn(),
  upsertAdEventMapping: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

vi.mock('../services/affiliate-notifier.js', () => ({
  notifyAffiliateApproval: vi.fn().mockResolvedValue(undefined),
}));

const worker = (await import('../index.js')).default;

const API_KEY = 'test-owner-key';
const env = {
  DB: {
    prepare: vi.fn((_sql: string) => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => null),
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

const POINT = { id: 'point-1', line_account_id: null };
const MAPPING = {
  conversion_point_id: 'point-1',
  event_name: 'Purchase',
  created_at: '2026-10-03T10:00:00.000+09:00',
  updated_at: '2026-10-03T10:00:00.000+09:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([
    { id: 'account-1', tenant_id: '00000000-0000-4000-8000-000000000001' },
  ]);
  dbMocks.getStaffByApiKey.mockResolvedValue({
    id: 'owner-1', name: '統括', role: 'owner', access_level: 'full', permission_keys: '[]',
  });
  dbMocks.getConversionPointById.mockResolvedValue(POINT);
  dbMocks.syncAffiliateConversionMileage.mockResolvedValue(undefined);
});

describe('GET /api/conversions/points/:id/ad-event-mapping', () => {
  it('returns the mapping when one is saved', async () => {
    dbMocks.getAdEventMapping.mockResolvedValue(MAPPING);
    const res = await req('GET', '/api/conversions/points/point-1/ad-event-mapping');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { eventName: string } };
    expect(body.success).toBe(true);
    expect(body.data.eventName).toBe('Purchase');
    expect(dbMocks.getAdEventMapping).toHaveBeenCalledWith(expect.anything(), 'point-1');
  });

  it('returns null data when no mapping is saved', async () => {
    dbMocks.getAdEventMapping.mockResolvedValue(null);
    const res = await req('GET', '/api/conversions/points/point-1/ad-event-mapping');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: null };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it('returns 404 for a point outside the visible scope', async () => {
    dbMocks.getConversionPointById.mockResolvedValue(null);
    const res = await req('GET', '/api/conversions/points/point-x/ad-event-mapping');
    expect(res.status).toBe(404);
    expect(dbMocks.getAdEventMapping).not.toHaveBeenCalled();
  });
});

describe('PUT /api/conversions/points/:id/ad-event-mapping', () => {
  it('saves and returns the mapping', async () => {
    dbMocks.upsertAdEventMapping.mockResolvedValue(MAPPING);
    const res = await req('PUT', '/api/conversions/points/point-1/ad-event-mapping', { eventName: 'Purchase' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { eventName: string } };
    expect(body.success).toBe(true);
    expect(body.data.eventName).toBe('Purchase');
    expect(dbMocks.upsertAdEventMapping).toHaveBeenCalledWith(expect.anything(), 'point-1', 'Purchase');
  });

  it('returns 400 when eventName is missing', async () => {
    const res = await req('PUT', '/api/conversions/points/point-1/ad-event-mapping', {});
    expect(res.status).toBe(400);
    expect(dbMocks.upsertAdEventMapping).not.toHaveBeenCalled();
  });

  it('returns 400 when the name is too long', async () => {
    dbMocks.upsertAdEventMapping.mockRejectedValue(new Error('ad_event_mapping_name_invalid'));
    const res = await req('PUT', '/api/conversions/points/point-1/ad-event-mapping', { eventName: 'x'.repeat(101) });
    expect(res.status).toBe(400);
    expect(dbMocks.upsertAdEventMapping).toHaveBeenCalled();
  });
});
