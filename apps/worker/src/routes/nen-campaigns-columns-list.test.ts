import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-08-25 12:00:00'),
}));
vi.mock('../services/nen-engagement.js', () => ({
  buildDefaultColumnIntro: vi.fn((title: string) => title),
  buildNenDeliveryMessages: vi.fn(),
  getNenCampaign: vi.fn(),
  queueColumnDelivery: vi.fn(),
  saveNenCampaignAccountSetting: vi.fn(),
  getNenBirthdayCouponSetting: vi.fn(),
  saveNenBirthdayCouponSetting: vi.fn(),
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

const { nenCampaigns } = await import('./nen-campaigns.js');

const columnRow = (id: string) => ({
  id, external_id: null, slug: `slug-${id}`, title: `題名${id}`, category: '食事',
  excerpt: '概要', intro_text: '紹介文', article_url: 'https://example.com/a', image_url: null,
  published_at: null, delivery_status: 'draft', delivery_at: null, line_account_id: 'account-a',
  updated_at: '2026-08-25 12:00:00', target_mode: 'all', target_tag_id: null,
  completion_event_name: null, completion_tag_id: null, source_column_id: null,
});

const ALL_ROWS = [columnRow('c1'), columnRow('c2'), columnRow('c3')];

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: { prepare: mocks.prepare } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.prepare.mockImplementation((sql: string) => {
    let binds: unknown[] = [];
    const statement = {
      bind: (...args: unknown[]) => { binds = args; return statement; },
      first: vi.fn(async () => ({ total: ALL_ROWS.length })),
      all: vi.fn(async () => {
        if (sql.includes('LIMIT ? OFFSET ?')) {
          const limit = Number(binds[binds.length - 2]);
          const offset = Number(binds[binds.length - 1]);
          return { results: ALL_ROWS.slice(offset, offset + limit) };
        }
        return { results: ALL_ROWS };
      }),
    };
    return statement;
  });
});

describe('NENコラム一覧の上限(点検 #512 の中6)', () => {
  test('件数制限なしの全件取得をやめ、上限200・ページ送りを付ける', async () => {
    const res = await app().request('/api/nen-campaigns/columns?lineAccountId=account-a');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean; data: Array<{ id: string }>; pagination: { total: number; limit: number; offset: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.map((row) => row.id)).toEqual(['c1', 'c2', 'c3']);
    expect(body.pagination).toEqual({ total: 3, limit: 200, offset: 0 });
    const listSql = mocks.prepare.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes('ORDER BY published_at DESC'));
    expect(listSql).toContain('LIMIT ? OFFSET ?');
  });

  test('limit と offset で区切って読める', async () => {
    const res = await app().request('/api/nen-campaigns/columns?lineAccountId=account-a&limit=2&offset=1');
    const body = await res.json() as {
      success: boolean; data: Array<{ id: string }>; pagination: { total: number; limit: number; offset: number };
    };
    expect(body.data.map((row) => row.id)).toEqual(['c2', 'c3']);
    expect(body.pagination).toEqual({ total: 3, limit: 2, offset: 1 });
  });

  test('他アカウントは 403 で遮る', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const res = await app().request('/api/nen-campaigns/columns?lineAccountId=other');
    expect(res.status).toBe(403);
  });
});
