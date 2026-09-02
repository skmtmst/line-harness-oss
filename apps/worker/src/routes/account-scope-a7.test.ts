import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getScope: vi.fn(),
  installRichMenu: vi.fn(),
  computePreview: vi.fn(),
  syncHealth: vi.fn(),
  syncPhoto: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: mocks.getScope,
}));
vi.mock('../services/nen-rich-menu.js', () => ({ installNenRichMenu: mocks.installRichMenu }));
vi.mock('../services/dedup-broadcast.js', () => ({ computeDedupBroadcastPreview: mocks.computePreview }));
vi.mock('../services/nen-tag-sync.js', () => ({
  refreshAllNenTags: vi.fn(),
  syncNenHealthTags: mocks.syncHealth,
  syncNenPetTags: vi.fn(),
  syncNenPhotoTags: mocks.syncPhoto,
}));

const [{ nenMembers }, { default: dedupPreview }] = await Promise.all([
  import('./nen-members.js'),
  import('./dedup-preview.js'),
]);

type FirstResult = Record<string, unknown> | null;

function app(firstResult: FirstResult = null) {
  const sql: Array<{ query: string; bindings: unknown[] }> = [];
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.env = {
      DB: {
        prepare(query: string) {
          const entry = { query, bindings: [] as unknown[] };
          sql.push(entry);
          const statement = {
            bind: (...bindings: unknown[]) => { entry.bindings = bindings; return statement; },
            first: vi.fn(async () => firstResult),
            all: vi.fn(async () => ({ results: [] })),
            run: vi.fn(async () => ({})),
          };
          return statement;
        },
      },
    };
    c.set('staff', { id: 'owner', role: 'owner', tenantId: 'tenant-a' });
    await next();
  });
  instance.route('/', nenMembers);
  instance.route('/', dedupPreview);
  return { instance, sql };
}

function json(method: string, body: unknown) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getScope.mockResolvedValue({ allowedAccountIds: ['own-account'], canSeeUnassigned: false });
  mocks.installRichMenu.mockResolvedValue({ richMenuId: 'menu' });
  mocks.computePreview.mockResolvedValue({
    totalSelected: 0, uniqueRecipients: 0, reduction: 0, reductionRate: 0, perAccount: [],
  });
});

describe('A-7 tenant scope', () => {
  test('rejects another tenant rich-menu install before LINE setup', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app().instance.request('/api/nen-members/rich-menu/install', json('POST', { accountId: 'other-account' }));
    expect(response.status).toBe(403);
    expect(mocks.installRichMenu).not.toHaveBeenCalled();
  });

  test('rejects another tenant dedup preview before computing it', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app().instance.request('/api/broadcasts/dedup-preview', json('POST', { accountIds: ['other-account'], dedupPriority: [] }));
    expect(response.status).toBe(403);
    expect(mocks.computePreview).not.toHaveBeenCalled();
  });

  test.each([
    '/api/nen-members/care-flags',
    '/api/nen-members/ranks',
    '/api/nen-members/consultations',
  ])('%s filters rows to visible accounts', async (path) => {
    const harness = app();
    expect((await harness.instance.request(path)).status).toBe(200);
    expect(harness.sql[0].query).toContain('f.line_account_id IN (?)');
    expect(harness.sql[0].bindings).toEqual(['own-account']);
  });

  test('/api/nen-members/photos requires and filters to one selected account', async () => {
    const harness = app();
    expect((await harness.instance.request('/api/nen-members/photos?accountId=own-account')).status).toBe(200);
    expect(harness.sql[0].query).toContain('ps.line_account_id = ? AND f.line_account_id = ?');
    expect(harness.sql[0].bindings).toEqual(['own-account', 'own-account']);
  });

  test.each([
    ['/api/nen-members/care-flags/flag-1', 'PUT', { status: 'resolved' }, { friend_id: 'friend-1', line_account_id: 'other-account' }],
    ['/api/nen-members/friends/friend-1', 'GET', undefined, { id: 'friend-1', line_account_id: 'other-account' }],
  ])('%s hides another tenant row', async (path, method, body, row) => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app(row).instance.request(path, body === undefined ? { method } : json(method, body));
    expect(response.status).toBe(404);
  });

  test('/api/nen-members/photos/:id/review rejects an inaccessible selected account before lookup', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const response = await app().instance.request(
      '/api/nen-members/photos/photo-1/review',
      json('PUT', { accountId: 'other-account', status: 'rejected', reasonCode: 'quality' }),
    );
    expect(response.status).toBe(403);
  });

  test('keeps own-tenant care-flag updates working', async () => {
    const response = await app({ friend_id: 'friend-1', line_account_id: 'own-account' }).instance.request(
      '/api/nen-members/care-flags/flag-1',
      json('PUT', { status: 'resolved' }),
    );
    expect(response.status).toBe(200);
    expect(mocks.syncHealth).toHaveBeenCalledWith(expect.anything(), 'friend-1');
  });
});
