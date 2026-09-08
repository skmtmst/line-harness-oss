import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

// N-060: タグ一斉配信のプレビュー人数は、実送信 (getFriendsByTag with
// line_account_id) と同じアカウント境界で数える。外部送信なし。

type FriendRow = {
  id: string;
  line_account_id: string;
  is_following: 1 | 0;
  tags: string[];
};

// accA: tag-1 がフォロー中 3 + 未フォロー 1。accB: tag-1 がフォロー中 5。
// tag-other は accB にだけ付く。tag-empty は誰にも付かない。
const FRIENDS: FriendRow[] = [
  { id: 'a1', line_account_id: 'accA', is_following: 1, tags: ['tag-1'] },
  { id: 'a2', line_account_id: 'accA', is_following: 1, tags: ['tag-1'] },
  { id: 'a3', line_account_id: 'accA', is_following: 1, tags: ['tag-1'] },
  { id: 'a4', line_account_id: 'accA', is_following: 0, tags: ['tag-1'] },
  { id: 'b1', line_account_id: 'accB', is_following: 1, tags: ['tag-1'] },
  { id: 'b2', line_account_id: 'accB', is_following: 1, tags: ['tag-1'] },
  { id: 'b3', line_account_id: 'accB', is_following: 1, tags: ['tag-1'] },
  { id: 'b4', line_account_id: 'accB', is_following: 1, tags: ['tag-1'] },
  { id: 'b5', line_account_id: 'accB', is_following: 1, tags: ['tag-1'] },
  { id: 'b6', line_account_id: 'accB', is_following: 1, tags: ['tag-other'] },
  { id: 'b7', line_account_id: 'accB', is_following: 1, tags: ['tag-other'] },
];

const mocks = vi.hoisted(() => ({
  getBroadcastById: vi.fn(),
  canAccess: vi.fn(),
  lineClient: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getBroadcasts: vi.fn(),
  getBroadcastById: mocks.getBroadcastById,
  createBroadcast: vi.fn(),
  updateBroadcast: vi.fn(),
  deleteBroadcast: vi.fn(),
  getLineAccountById: vi.fn(),
}));
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: vi.fn(),
  canAccessAllLineAccounts: (
    _db: D1Database,
    _staff: unknown,
    _accountIds: Array<string | null | undefined>,
  ) => mocks.canAccess(),
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: mocks.lineClient }));

const { broadcasts } = await import('./broadcasts.js');

type SqlEntry = { query: string; bindings: unknown[] };

function broadcastRow(id: string, overrides: Record<string, unknown>) {
  return {
    id, title: 'notice', message_type: 'text', message_content: 'hello',
    message_bubbles_json: null, target_type: 'tag', target_tag_id: 'tag-1',
    status: 'draft', scheduled_at: null, sent_at: null, total_count: 0,
    success_count: 0, created_at: '2026-08-25T00:00:00+09:00',
    account_ids: null, dedup_priority: null, failed_account_ids: null,
    track_links: 1, line_account_id: 'accA', folder_id: 'folder-1',
    measure_opens: 0, ...overrides,
  };
}

const BROADCASTS: Record<string, Record<string, unknown>> = {
  'b-accA': broadcastRow('b-accA', { line_account_id: 'accA', target_tag_id: 'tag-1' }),
  'b-accB': broadcastRow('b-accB', { line_account_id: 'accB', target_tag_id: 'tag-1' }),
  'b-null': broadcastRow('b-null', { line_account_id: null, target_tag_id: 'tag-1' }),
  'b-other-tag': broadcastRow('b-other-tag', { line_account_id: 'accA', target_tag_id: 'tag-other' }),
  'b-missing-tag': broadcastRow('b-missing-tag', { line_account_id: 'accA', target_tag_id: 'tag-missing' }),
  'b-empty-tag': broadcastRow('b-empty-tag', { line_account_id: 'accA', target_tag_id: 'tag-empty' }),
  'b-all': broadcastRow('b-all', { target_type: 'all', target_tag_id: null, line_account_id: 'accA' }),
};

function countFor(query: string, bindings: unknown[]): number {
  if (query.includes('friend_tags')) {
    const tagId = bindings[0] as string;
    const hasAccount = query.includes('f.line_account_id = ?');
    const accountId = hasAccount ? (bindings[1] as string) : null;
    return FRIENDS.filter((f) => f.tags.includes(tagId)
      && f.is_following === 1
      && (!hasAccount || f.line_account_id === accountId)).length;
  }
  const hasAccount = query.includes('line_account_id = ?');
  const accountId = hasAccount ? (bindings[0] as string) : null;
  return FRIENDS.filter((f) => f.is_following === 1
    && (!hasAccount || f.line_account_id === accountId)).length;
}

function app() {
  const sql: SqlEntry[] = [];
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = {
      DB: {
        prepare(query: string) {
          const entry: SqlEntry = { query, bindings: [] };
          sql.push(entry);
          const statement = {
            bind: (...bindings: unknown[]) => { entry.bindings = bindings; return statement; },
            first: async () => ({ cnt: countFor(query, entry.bindings) }),
            all: async () => ({ results: [] }),
            run: async () => ({}),
          };
          return statement;
        },
      } as unknown as D1Database,
    };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', broadcasts);
  return { instance, sql };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getBroadcastById.mockImplementation(async (_db: unknown, id: string) => BROADCASTS[id] ?? null);
});

describe('preview-count tag account boundary (N-060)', () => {
  test('accA の同一タグは 3 人 (accB の 5 人を混ぜない)', async () => {
    const { instance } = app();
    const response = await instance.request('/api/broadcasts/b-accA/preview-count');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { count: 3 } });
  });

  test('accB の同一タグは 5 人', async () => {
    const { instance } = app();
    const response = await instance.request('/api/broadcasts/b-accB/preview-count');
    expect(await response.json()).toMatchObject({ success: true, data: { count: 5 } });
  });

  test('実送信と同じ境界条件 (tag, account の順で絞る) を SQL で固定', async () => {
    const { instance, sql } = app();
    await instance.request('/api/broadcasts/b-accA/preview-count');
    expect(sql).toHaveLength(1);
    // getFriendsByTag と同じく tag → account の順で絞る。未フォローは数えない。
    expect(sql[0].query).toContain('ft.tag_id = ?');
    expect(sql[0].query).toContain('f.is_following = 1');
    expect(sql[0].query).toContain('f.line_account_id = ?');
    expect(sql[0].bindings).toEqual(['tag-1', 'accA']);
  });

  test('他アカウントの人数・存在を応答へ漏らさない', async () => {
    const { instance } = app();
    const response = await instance.request('/api/broadcasts/b-accA/preview-count');
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ success: true, data: { count: 3 } });
    expect((body.data as Record<string, unknown>).perAccount).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('accB');
  });

  test('他アカウントにだけ付くタグは 0 人', async () => {
    const { instance } = app();
    const response = await instance.request('/api/broadcasts/b-other-tag/preview-count');
    expect(await response.json()).toMatchObject({ success: true, data: { count: 0 } });
  });

  test('存在しないタグは 0 人', async () => {
    const { instance } = app();
    const response = await instance.request('/api/broadcasts/b-missing-tag/preview-count');
    expect(await response.json()).toMatchObject({ success: true, data: { count: 0 } });
  });

  test('誰にも付いていないタグは 0 人', async () => {
    const { instance } = app();
    const response = await instance.request('/api/broadcasts/b-empty-tag/preview-count');
    expect(await response.json()).toMatchObject({ success: true, data: { count: 0 } });
  });

  test('line_account_id が無い配信は絞らず全件 (送信と同じ)', async () => {
    const { instance, sql } = app();
    const response = await instance.request('/api/broadcasts/b-null/preview-count');
    expect(await response.json()).toMatchObject({ success: true, data: { count: 8 } });
    expect(sql[0].query).not.toContain('f.line_account_id = ?');
    expect(sql[0].bindings).toEqual(['tag-1']);
  });

  test('二重実行でも同じ人数', async () => {
    const { instance } = app();
    const first = await (await instance.request('/api/broadcasts/b-accA/preview-count')).json();
    const second = await (await instance.request('/api/broadcasts/b-accA/preview-count')).json();
    expect(second).toEqual(first);
    expect(first).toMatchObject({ success: true, data: { count: 3 } });
  });

  test('権限の無いアカウントは 404 で人数も SQL も漏らさない', async () => {
    mocks.canAccess.mockResolvedValue(false);
    const { instance, sql } = app();
    const response = await instance.request('/api/broadcasts/b-accA/preview-count');
    expect(response.status).toBe(404);
    expect(sql).toHaveLength(0);
  });

  test('回帰: all 配信の絞りは変わらない', async () => {
    const { instance, sql } = app();
    const response = await instance.request('/api/broadcasts/b-all/preview-count');
    expect(await response.json()).toMatchObject({ success: true, data: { count: 3 } });
    expect(sql[0].query).toContain('line_account_id = ?');
    expect(sql[0].bindings).toEqual(['accA']);
  });
});
