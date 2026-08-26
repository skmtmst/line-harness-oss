import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  createAsset: vi.fn(), deleteAsset: vi.fn(), getAsset: vi.fn(), listAssets: vi.fn(), updateAsset: vi.fn(),
  createLink: vi.fn(), deleteLink: vi.fn(), getLink: vi.fn(), getLinks: vi.fn(), updateLink: vi.fn(),
  createPoint: vi.fn(), deletePoint: vi.fn(), getPoint: vi.fn(), getPoints: vi.fn(), updatePoint: vi.fn(),
  getEvents: vi.fn(), getReport: vi.fn(), getApprovals: vi.fn(), setApproval: vi.fn(),
  trackConversion: vi.fn(),
  canAccess: vi.fn(), getScope: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: mocks.getScope,
}));
vi.mock('../services/broadcast-media-storage.js', () => ({ storeBroadcastMedia: vi.fn() }));
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateApproval: vi.fn() }));
vi.mock('@line-crm/db', () => ({
  createBroadcastMessageAsset: mocks.createAsset,
  deleteBroadcastMessageAsset: mocks.deleteAsset,
  getBroadcastMessageAsset: mocks.getAsset,
  listBroadcastMessageAssets: mocks.listAssets,
  updateBroadcastMessageAsset: mocks.updateAsset,
  createTrackedLink: mocks.createLink,
  deleteTrackedLink: mocks.deleteLink,
  getTrackedLinkById: mocks.getLink,
  getTrackedLinkByIdOrShortCode: vi.fn(),
  getTrackedLinkBaseUrl: vi.fn(async () => null),
  getTrackedLinks: mocks.getLinks,
  updateTrackedLink: mocks.updateLink,
  getLinkClicks: vi.fn(async () => []),
  getFriendByLineUserIdForAccount: vi.fn(), recordLinkClick: vi.fn(),
  enrollFriendInScenario: vi.fn(), getUrlReachConversionPoints: vi.fn(), trackConversion: mocks.trackConversion,
  createConversionPoint: mocks.createPoint,
  deleteConversionPoint: mocks.deletePoint,
  getConversionPointById: mocks.getPoint,
  getConversionPoints: mocks.getPoints,
  updateConversionPoint: mocks.updatePoint,
  getConversionEvents: mocks.getEvents,
  getConversionReport: mocks.getReport,
  getConversionApprovalQueue: mocks.getApprovals,
  setConversionApproval: mocks.setApproval,
  getConversionApprovalNotifyInfo: vi.fn(), syncAffiliateConversionMileage: vi.fn(),
}));

const [{ broadcastMessageAssets }, { trackedLinks }, { conversions }] = await Promise.all([
  import('./broadcast-message-assets.js'), import('./tracked-links.js'), import('./conversions.js'),
]);

const asset = (id: string, account: string | null) => ({
  id, line_account_id: account, kind: 'coupon', name: id, payload_json: '{}', created_at: '', updated_at: '',
});
const link = (id: string, account: string) => ({
  id, line_account_id: account, name: id, original_url: 'https://example.com', short_code: id,
  tag_id: null, scenario_id: null, intro_template_id: null, reward_template_id: null,
  dedup_key: null, is_active: 1, click_count: 0, og_title: null, og_description: null,
  og_image_url: null, created_at: '', updated_at: '',
});
const point = (id: string, account: string) => ({
  id, line_account_id: account, name: id, event_type: 'purchase', value: null,
  measure_method: 'manual', target_url: null, count_repeat: 1, attribution_days: null, created_at: '',
});

function app() {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.env = { DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ line_account_id: 'own' }),
          all: async () => ({ results: [{ id: 'own-point' }, { id: 'own-event' }] }),
        }),
      }),
    } };
    c.set('staff', { id: 'owner', role: 'owner', tenantId: 'tenant-a' });
    await next();
  });
  instance.route('/', broadcastMessageAssets);
  instance.route('/', trackedLinks);
  instance.route('/', conversions);
  return instance;
}
const json = (method: string, body: unknown) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockImplementation(async (_db, _staff, ids: Array<string | null>) => !ids.includes('other'));
  mocks.getScope.mockResolvedValue({ allowedAccountIds: ['own'], canSeeUnassigned: false });
  mocks.listAssets.mockResolvedValue([asset('own-asset', 'own'), asset('other-asset', 'other')]);
  mocks.getLinks.mockResolvedValue([link('own-link', 'own'), link('other-link', 'other')]);
  mocks.getPoints.mockResolvedValue([point('own-point', 'own'), point('other-point', 'other')]);
  mocks.getEvents.mockImplementation(async (_db, options) => options.allowedAccountIds
    ? [{ id: 'own-event' }]
    : [{ id: 'own-event' }, { id: 'other-event' }]);
  mocks.getReport.mockResolvedValue([
    { conversionPointId: 'own-point' }, { conversionPointId: 'other-point' },
  ]);
  mocks.getApprovals.mockImplementation(async (_db, options) => options.allowedAccountIds
    ? [{ eventId: 'own-event' }]
    : [{ eventId: 'own-event' }, { eventId: 'other-event' }]);
});

describe('A-9 tenant scope', () => {
  test.each([
    ['/api/broadcast-message-assets', 'own-asset'],
    ['/api/tracked-links', 'own-link'],
    ['/api/conversions/points', 'own-point'],
    ['/api/conversions/events', 'own-event'],
    ['/api/conversions/report', 'own-point'],
    ['/api/conversions/approvals', 'own-event'],
  ])('%s omits rows owned by another tenant', async (path, ownId) => {
    const response = await app().request(path);
    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).toContain(ownId);
    expect(body).not.toContain('other-');
  });

  test('rejects another tenant account before creating an asset', async () => {
    const response = await app().request('/api/broadcast-message-assets', json('POST', {
      lineAccountId: 'other', kind: 'coupon', name: 'x', payload: {},
    }));
    expect(response.status).toBe(403);
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });

  test('omits unassigned assets for a non-default tenant even with an account filter', async () => {
    mocks.listAssets.mockResolvedValue([asset('own-asset', 'own'), asset('unassigned-asset', null)]);
    const response = await app().request('/api/broadcast-message-assets?lineAccountId=own');
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('unassigned-asset');
  });

  test('rejects another tenant account before creating a tracked link', async () => {
    const response = await app().request('/api/tracked-links', json('POST', {
      lineAccountId: 'other', name: 'x', originalUrl: 'https://example.com',
    }));
    expect(response.status).toBe(403);
    expect(mocks.createLink).not.toHaveBeenCalled();
  });

  test('rejects another tenant account before creating a conversion point', async () => {
    const response = await app().request('/api/conversions/points', json('POST', {
      lineAccountId: 'other', name: 'x', eventType: 'purchase',
    }));
    expect(response.status).toBe(403);
    expect(mocks.createPoint).not.toHaveBeenCalled();
  });

  test('hides another tenant conversion point before tracking', async () => {
    mocks.getPoint.mockResolvedValue(point('other-point', 'other'));
    const response = await app().request('/api/conversions/track', json('POST', {
      conversionPointId: 'other-point', friendId: 'friend',
    }));
    expect(response.status).toBe(404);
    expect(mocks.trackConversion).not.toHaveBeenCalled();
  });

  test.each(['/api/conversions/events', '/api/conversions/approvals'])(
    '%s applies account scope before database pagination',
    async (path) => {
      expect((await app().request(`${path}?limit=1&offset=1`)).status).toBe(200);
      const query = path.endsWith('events') ? mocks.getEvents : mocks.getApprovals;
      expect(query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        allowedAccountIds: ['own'], canSeeUnassigned: false, limit: 1, offset: 1,
      }));
    },
  );

  test.each([
    ['/api/broadcast-message-assets/other-asset', 'PUT', { name: 'x', payload: {} }],
    ['/api/tracked-links/other-link', 'PATCH', { name: 'x' }],
    ['/api/conversions/points/other-point', 'PUT', { name: 'x' }],
  ])('%s hides another tenant row', async (path, method, body) => {
    mocks.getAsset.mockResolvedValue(asset('other-asset', 'other'));
    mocks.getLink.mockResolvedValue(link('other-link', 'other'));
    mocks.getPoint.mockResolvedValue(point('other-point', 'other'));
    expect((await app().request(path, json(method, body))).status).toBe(404);
  });

  test.each(['/api/conversions/points', '/api/conversions/events', '/api/conversions/report', '/api/conversions/approvals'])('%s remains a static route', async (path) => {
    expect((await app().request(path)).status).toBe(200);
  });
});
