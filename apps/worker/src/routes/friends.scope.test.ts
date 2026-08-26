import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getScope: vi.fn(),
  getFriendById: vi.fn(),
  pushMessage: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: mocks.getScope,
}));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getFriendById: mocks.getFriendById,
}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessage = mocks.pushMessage; },
}));

const { friends } = await import('./friends.js');

function createApp(prepared: Array<{ sql: string; binds: unknown[] }>) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff', role: 'owner', tenantId: 'tenant-a' });
    c.env = {
      DB: {
        prepare(sql: string) {
          const entry = { sql, binds: [] as unknown[] };
          prepared.push(entry);
          const statement = {
            bind(...binds: unknown[]) { entry.binds = binds; return statement; },
            first: vi.fn(async () => ({ count: 0, total: 0, active: 0, blocked_by_them: 0, hidden_by_us: 0, unanswered: 0, resolved: 0 })),
            all: vi.fn(async () => ({ results: [] })),
            run: vi.fn(async () => ({})),
          };
          return statement;
        },
      },
    };
    await next();
  });
  app.route('/', friends);
  return app;
}

const request = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', 'Idempotency-Key': '12345678-1234-4123-8123-123456789abc' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getScope.mockResolvedValue({ allowedAccountIds: ['own'], canSeeUnassigned: false, ids: ['own'], accounts: [] });
  mocks.getFriendById.mockResolvedValue({ id: 'friend', line_account_id: 'other', metadata: '{}', line_user_id: 'U-test' });
  mocks.canAccess.mockResolvedValue(false);
});

describe('A-8 friends tenant scope', () => {
  test.each([
    ['mileage', 'GET', '/api/friends/friend/mileage', undefined],
    ['detail', 'GET', '/api/friends/friend', undefined],
    ['add tag', 'POST', '/api/friends/friend/tags', { tagId: 'tag' }],
    ['remove tag', 'DELETE', '/api/friends/friend/tags/tag', undefined],
    ['metadata', 'PUT', '/api/friends/friend/metadata', { note: 'test' }],
    ['message history', 'GET', '/api/friends/friend/messages', undefined],
    ['send message', 'POST', '/api/friends/friend/messages', { content: 'test' }],
  ] as const)('%s hides a friend from another tenant', async (_name, method, path, body) => {
    const response = await createApp([]).request(path, request(method, body));
    expect(response.status).toBe(404);
  });

  test('cross-tenant message is rejected before LINE delivery', async () => {
    await createApp([]).request('/api/friends/friend/messages', request('POST', { content: 'test' }));
    expect(mocks.pushMessage).not.toHaveBeenCalled();
  });

  test.each([
    '/api/friends/count',
    '/api/friends/stats',
    '/api/friends/ref-stats',
    '/api/friends/add-breakdown',
  ])('%s remains a static route', async (path) => {
    const response = await createApp([]).request(path);
    expect(response.status).toBe(200);
    expect(mocks.getFriendById).not.toHaveBeenCalled();
  });

  test.each([
    '/api/friends?includeTags=false',
    '/api/friends/count',
    '/api/friends/stats',
    '/api/friends/ref-stats',
    '/api/friends/add-breakdown',
  ])('%s scopes an omitted account to visible accounts', async (path) => {
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    expect((await createApp(prepared).request(path)).status).toBe(200);
    expect(mocks.getScope).toHaveBeenCalled();
    expect(prepared.some(({ sql, binds }) => sql.includes('line_account_id IN (?)') && binds.includes('own'))).toBe(true);
  });

  test('own-tenant friend remains available', async () => {
    mocks.canAccess.mockResolvedValue(true);
    const response = await createApp([]).request('/api/friends/friend/mileage');
    expect(response.status).toBe(200);
  });
});
