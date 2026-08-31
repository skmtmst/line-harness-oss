import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({ canAccess: vi.fn() }));

vi.mock('@line-crm/db', () => ({
  getFriendByLineUserIdForAccount: vi.fn(),
  jstNow: vi.fn(() => '2026-08-31 09:00:00'),
  resolveLineCredential: vi.fn(),
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: vi.fn(),
}));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));
vi.mock('../services/nen-tag-sync.js', () => ({
  refreshAllNenTags: vi.fn(), syncNenHealthTags: vi.fn(),
  syncNenPetTags: vi.fn(), syncNenPhotoTags: vi.fn(),
}));

const { nenMembers } = await import('./nen-members.js');

type Entry = { query: string; bindings: unknown[] };
type PublicationRow = {
  publication_id: string;
  photo_id: string;
  publication_version: number;
  public_asset_kind: 'public_derivative' | null;
  public_asset_url: string | null;
  public_asset_version: string | null;
  published_at: string;
  caption: string;
  publication_consent_at: string | null;
  publication_withdrawn_at: string | null;
  public_pet_name: number;
  pet_name: string;
  placement_type: 'rich_menu' | 'nen_column' | 'form' | 'website' | null;
  placement_name: string | null;
  placement_status: 'active' | 'removing' | 'failed' | null;
  display_count: number | null;
  display_count_source: string | null;
  display_count_updated_at: string | null;
  placed_at: string | null;
  owner_name?: string;
  placement_key?: string;
  last_error?: string;
};

const rows: PublicationRow[] = [
  {
    publication_id: 'publication-1', photo_id: 'photo-1', publication_version: 2,
    public_asset_kind: 'public_derivative', public_asset_url: 'https://public.example/photo-1.jpg',
    public_asset_version: 'safe-v2', published_at: '2026-08-25 10:00:00',
    caption: '公園で遊んでいます', publication_consent_at: '2026-08-24 10:00:00',
    publication_withdrawn_at: null, public_pet_name: 1, pet_name: 'こむぎ',
    placement_type: 'rich_menu', placement_name: '会員メニュー', placement_status: 'active',
    display_count: 1240, display_count_source: 'rich_menu_impressions',
    display_count_updated_at: '2026-08-31 09:00:00', placed_at: '2026-08-25 10:00:00',
    owner_name: '田中 花子', placement_key: 'secret-menu-id', last_error: 'internal error',
  },
  {
    publication_id: 'publication-1', photo_id: 'photo-1', publication_version: 2,
    public_asset_kind: 'public_derivative', public_asset_url: 'https://public.example/photo-1.jpg',
    public_asset_version: 'safe-v2', published_at: '2026-08-25 10:00:00',
    caption: '公園で遊んでいます', publication_consent_at: '2026-08-24 10:00:00',
    publication_withdrawn_at: null, public_pet_name: 1, pet_name: 'こむぎ',
    placement_type: 'form', placement_name: '来店アンケート', placement_status: 'active',
    display_count: 0, display_count_source: 'form_views',
    display_count_updated_at: '2026-08-31 09:00:00', placed_at: '2026-08-26 10:00:00',
  },
  {
    publication_id: 'publication-2', photo_id: 'photo-2', publication_version: 1,
    public_asset_kind: null, public_asset_url: null, public_asset_version: null,
    published_at: '2026-08-24 10:00:00', caption: 'くつろいでいます',
    publication_consent_at: '2026-08-23 10:00:00', publication_withdrawn_at: null,
    public_pet_name: 0, pet_name: 'あずき', placement_type: 'website',
    placement_name: '公式サイト', placement_status: 'active', display_count: null,
    display_count_source: null, display_count_updated_at: null, placed_at: '2026-08-24 10:00:00',
  },
];

function harness(data: PublicationRow[] = rows) {
  const statements: Entry[] = [];
  const db = {
    prepare(query: string) {
      const entry: Entry = { query, bindings: [] };
      statements.push(entry);
      const statement = {
        bind(...bindings: unknown[]) { entry.bindings = bindings; return statement; },
        async all() {
          return { results: query.includes('FROM nen_photo_publications') ? data : [] };
        },
        async first() { return null; },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
      return statement;
    },
  };
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-a', name: '担当者', role: 'staff', readOnly: false });
    c.env = { DB: db };
    await next();
  });
  app.route('/', nenMembers);
  return { app, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
});

describe('NEN photo publications', () => {
  it('separates a missing account from an account the operator cannot access', async () => {
    const { app } = harness();
    expect((await app.request('/api/nen-members/photo-publications')).status).toBe(400);
    mocks.canAccess.mockResolvedValueOnce(false);
    expect((await app.request('/api/nen-members/photo-publications?accountId=account-a')).status).toBe(403);
  });

  it('reads published adopted photos only inside the selected account', async () => {
    const { app, statements } = harness();
    expect((await app.request('/api/nen-members/photo-publications?accountId=account-a')).status).toBe(200);
    const query = statements.find((entry) => entry.query.includes('FROM nen_photo_publications'));
    expect(query?.query).toContain('pub.line_account_id = ? AND ps.line_account_id = ? AND f.line_account_id = ?');
    expect(query?.query).toContain("pub.status = 'published' AND ps.status = 'adopted'");
    expect(query?.bindings).toEqual(['account-a', 'account-a', 'account-a']);
  });

  it('keeps a measured zero separate from an unavailable display count', async () => {
    const { app } = harness();
    const response = await app.request('/api/nen-members/photo-publications?accountId=account-a');
    const body = await response.json() as any;
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0]).toMatchObject({
      photoId: 'photo-1', totalDisplayCount: 1240, measurementState: 'measured',
      pet: { displayName: 'こむぎ', state: 'visible' },
      submitter: { displayName: null, state: 'unavailable' },
      placements: [
        { displayCount: 1240, measurementState: 'measured' },
        { displayCount: 0, measurementState: 'measured' },
      ],
    });
    expect(body.data.items[1]).toMatchObject({
      photoId: 'photo-2', totalDisplayCount: null, measurementState: 'unavailable',
      publicImage: { state: 'unavailable', url: null, version: null },
      pet: { displayName: null, state: 'hidden' },
      placements: [{ displayCount: null, measurementState: 'unavailable' }],
    });
    expect(body.data.summary).toMatchObject({
      publishedPhotos: 2, placementTypeCount: 3,
      mostViewed: { photoId: 'photo-1', displayCount: 1240 },
      consentedPhotos: 2, allConsented: true,
    });
  });

  it('does not present a partial sum when one destination is unavailable', async () => {
    const partial = rows.map((row, index) => index === 1 ? {
      ...row, display_count: null, display_count_source: null, display_count_updated_at: null,
    } : row);
    const { app } = harness(partial);
    const response = await app.request('/api/nen-members/photo-publications?accountId=account-a');
    const body = await response.json() as any;
    expect(body.data.items[0]).toMatchObject({
      totalDisplayCount: null,
      measurementState: 'unavailable',
    });
    expect(body.data.summary.mostViewed).toBeNull();
  });

  it('shows a failed destination without counting it as a place in use', async () => {
    const withFailure = rows.map((row, index) => index === 2 ? {
      ...row, placement_status: 'failed' as const,
    } : row);
    const { app } = harness(withFailure);
    const response = await app.request('/api/nen-members/photo-publications?accountId=account-a');
    const body = await response.json() as any;
    expect(body.data.items[1].placements[0].status).toBe('failed');
    expect(body.data.summary.destinations).toContainEqual({
      type: 'website', label: 'サイト', count: 0,
    });
  });

  it('does not expose submitter names, destination keys, or internal errors', async () => {
    const { app } = harness();
    const response = await app.request('/api/nen-members/photo-publications?accountId=account-a');
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('田中 花子');
    expect(text).not.toContain('secret-menu-id');
    expect(text).not.toContain('internal error');
    expect(text).not.toContain('placement_id');
    expect(text).not.toContain('publication_id');
  });

  it('returns an actual empty result with zero counts rather than unavailable data', async () => {
    const { app } = harness([]);
    const response = await app.request('/api/nen-members/photo-publications?accountId=account-a');
    const body = await response.json() as any;
    expect(body.data.items).toEqual([]);
    expect(body.data.summary).toMatchObject({
      publishedPhotos: 0, placementTypeCount: 0, mostViewed: null,
      consentedPhotos: 0, allConsented: false,
    });
    expect(body.data.summary.destinations.every((item: { count: number }) => item.count === 0)).toBe(true);
  });
});
