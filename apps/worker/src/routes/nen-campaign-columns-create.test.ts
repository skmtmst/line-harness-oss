import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@line-crm/db')>();
  return { ...original, jstNow: vi.fn(() => '2026-08-31 11:30:00') };
});

const { nenCampaigns } = await import('./nen-campaigns.js');

type DbState = {
  existing: { id: string } | null;
  insertError: Error | null;
  insertBinds: unknown[] | null;
  preparedSql: string[];
};

function database(state: DbState): D1Database {
  return {
    prepare(sql: string) {
      state.preparedSql.push(sql);
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async first() {
          if (sql.includes('SELECT id FROM nen_columns WHERE slug')) return state.existing;
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO nen_columns')) {
            state.insertBinds = values;
            if (state.insertError) throw state.insertError;
          }
          return { success: true, meta: { changes: 1 } };
        },
        async all() { return { success: true, results: [] }; },
      };
      return statement as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function app(state: DbState, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: database(state) };
    c.set('staff' as never, { id: 'staff-1', role, tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function freshState(): DbState {
  return { existing: null, insertError: null, insertBinds: null, preparedSql: [] };
}

function createRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const VALID = {
  title: ' 鹿肉の選び方 ',
  category: '食事',
  excerpt: '原材料表示の基本',
  articleUrl: 'https://example.com/columns/NEN-Guide',
  imageUrl: 'https://cdn.example.com/NEN-Guide.jpg',
  publishedAt: '2026-08-31T10:30:00+09:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
});

describe('POST /api/nen-campaigns/columns', () => {
  it.each(['owner', 'admin'] as const)('creates a new account-owned draft for %s', async (role) => {
    const state = freshState();
    const response = await app(state, role).request(
      '/api/nen-campaigns/columns?lineAccountId=account-a',
      createRequest(VALID),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, data: { id: expect.any(String) } });
    expect(mocks.canAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['account-a']);
    expect(state.preparedSql).toHaveLength(2);
    expect(state.preparedSql[1]).toContain("VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)");
    expect(state.insertBinds).toEqual([
      expect.any(String),
      'NEN-Guide',
      '鹿肉の選び方',
      '食事',
      '原材料表示の基本',
      expect.stringContaining('鹿肉の選び方'),
      'https://example.com/columns/NEN-Guide',
      'https://cdn.example.com/NEN-Guide.jpg',
      '2026-08-31T01:30:00.000Z',
      'account-a',
      '2026-08-31 11:30:00',
      '2026-08-31 11:30:00',
    ]);
  });

  it('stores omitted publication details as null and does not invent an external ID', async () => {
    const state = freshState();
    const response = await app(state).request(
      '/api/nen-campaigns/columns?lineAccountId=account-a',
      createRequest({ title: '下書き', articleUrl: 'https://example.com/columns/draft' }),
    );
    expect(response.status).toBe(201);
    expect(state.insertBinds?.slice(3, 9)).toEqual([
      null, '', expect.any(String), 'https://example.com/columns/draft', null, null,
    ]);
  });

  it('requires the selected LINE account before reading or writing', async () => {
    const state = freshState();
    const response = await app(state).request('/api/nen-campaigns/columns', createRequest(VALID));
    expect(response.status).toBe(400);
    expect(state.preparedSql).toEqual([]);
  });

  it('rejects staff role before account access or body parsing', async () => {
    const state = freshState();
    const response = await app(state, 'staff').request(
      '/api/nen-campaigns/columns?lineAccountId=account-a',
      createRequest(VALID),
    );
    expect(response.status).toBe(403);
    expect(mocks.canAccess).not.toHaveBeenCalled();
    expect(state.preparedSql).toEqual([]);
  });

  it('rejects an account outside the operator scope before touching the table', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const state = freshState();
    const response = await app(state).request(
      '/api/nen-campaigns/columns?lineAccountId=other-account',
      createRequest(VALID),
    );
    expect(response.status).toBe(403);
    expect(state.preparedSql).toEqual([]);
  });

  it('rejects forbidden fields with a stable input code', async () => {
    const state = freshState();
    const response = await app(state).request(
      '/api/nen-campaigns/columns?lineAccountId=account-a',
      createRequest({ ...VALID, body: '保存してはいけない本文' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'request_invalid' });
    expect(state.preparedSql).toEqual([]);
  });

  it('returns 409 without revealing which account owns an existing slug', async () => {
    const state = freshState();
    state.existing = { id: 'column-other-account' };
    const response = await app(state).request(
      '/api/nen-campaigns/columns?lineAccountId=account-a',
      createRequest(VALID),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'column_already_exists' });
    expect(state.insertBinds).toBeNull();
  });

  it('turns a concurrent slug unique conflict into the same 409', async () => {
    const state = freshState();
    state.insertError = new Error('D1_ERROR: UNIQUE constraint failed: nen_columns.slug');
    const response = await app(state).request(
      '/api/nen-campaigns/columns?lineAccountId=account-a',
      createRequest(VALID),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'column_already_exists' });
  });

  it('does not expose D1 details when saving fails', async () => {
    const state = freshState();
    state.insertError = new Error('D1_ERROR: no such table: nen_columns');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await app(state).request(
      '/api/nen-campaigns/columns?lineAccountId=account-a',
      createRequest(VALID),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'column_create_failed' });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('failed to create NEN column draft'));
    consoleError.mockRestore();
  });
});
