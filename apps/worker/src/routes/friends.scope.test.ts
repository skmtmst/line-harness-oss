import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getScope: vi.fn(),
  getFriendById: vi.fn(),
  getFriendTagsByFriendIds: vi.fn(),
  getSavedSearchById: vi.fn(),
  getSavedSearches: vi.fn(),
  createSavedSearch: vi.fn(),
  countSavedSearches: vi.fn(),
  getSavedSearchMatchPreview: vi.fn(),
  recordSavedSearchUsage: vi.fn(),
  pushMessage: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: mocks.getScope,
}));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getFriendById: mocks.getFriendById,
  getFriendTagsByFriendIds: mocks.getFriendTagsByFriendIds,
  getSavedSearchById: mocks.getSavedSearchById,
  getSavedSearches: mocks.getSavedSearches,
  createSavedSearch: mocks.createSavedSearch,
  countSavedSearches: mocks.countSavedSearches,
  recordSavedSearchUsage: mocks.recordSavedSearchUsage,
}));
vi.mock('../services/saved-search-insights.js', () => ({
  getSavedSearchMatchPreview: mocks.getSavedSearchMatchPreview,
}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessage = mocks.pushMessage; },
}));

const { friends } = await import('./friends.js');

function createApp(
  prepared: Array<{ sql: string; binds: unknown[] }>,
  friendRows: Array<Record<string, unknown>> = [],
  firstForSql?: (sql: string) => Record<string, unknown> | null | undefined,
  role: 'owner' | 'admin' | 'staff' = 'owner',
  allForSql?: (sql: string) => Array<Record<string, unknown>> | undefined,
) {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff', role, tenantId: 'tenant-a' });
    c.env = {
      DB: {
        prepare(sql: string) {
          const entry = { sql, binds: [] as unknown[] };
          prepared.push(entry);
          const statement = {
            bind(...binds: unknown[]) { entry.binds = binds; return statement; },
            first: vi.fn(async () => {
              const custom = firstForSql?.(sql);
              if (custom !== undefined) return custom;
              if (sql.includes('SELECT id FROM saved_searches')) return null;
              return { count: 0, total: 0, active: 0, blocked_by_them: 0, hidden_by_us: 0, unanswered: 0, resolved: 0 };
            }),
            all: vi.fn(async () => ({
              results: allForSql?.(sql)
                ?? (sql.includes('FROM friends f') && sql.includes('LIMIT ? OFFSET ?') ? friendRows : []),
            })),
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
  mocks.getSavedSearchById.mockResolvedValue(null);
  mocks.getSavedSearches.mockResolvedValue([]);
  mocks.countSavedSearches.mockResolvedValue(0);
  mocks.createSavedSearch.mockResolvedValue({
    id: 'saved-1', name: '要確認', scope: 'friends', condition_format: 'search_v1',
    conditions_json: JSON.stringify({ all: [{ kind: 'name', op: 'contains', value: '田中' }] }),
    created_by: 'staff', line_account_id: 'own', is_shared: 0, display_order: 0,
    created_at: '2026-09-07', updated_at: '2026-09-07', revision: 1,
  });
  mocks.getSavedSearchMatchPreview.mockResolvedValue({
    total: 1, byChannel: { line: 1, mail: 0 }, calculatedAt: '2026-09-07', error: null,
  });
  mocks.getFriendTagsByFriendIds.mockResolvedValue(new Map());
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

  test('/api/friends/stats keeps the existing response shape after using the shared query', async () => {
    const response = await createApp([]).request('/api/friends/stats');
    expect(await response.json()).toEqual({
      success: true,
      data: {
        active: 0, total: 0, blockedByThem: 0, hiddenByUs: 0,
        unanswered: 0, resolved: 0, addedThisMonth: 0, addedLastMonth: 0,
      },
    });
  });

  test('/api/friends/add-breakdown keeps the existing response shape after using the shared query', async () => {
    const response = await createApp([]).request('/api/friends/add-breakdown?days=30');
    expect(await response.json()).toEqual({
      success: true,
      data: { days: 30, firstTime: 0, returning: 0, unblocked: 0 },
    });
  });

  test('includeTags=false does not add one tag query per friend', async () => {
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `friend-${index}`,
      display_name: `Friend ${index}`,
      line_user_id: `U${index}`,
    }));

    const response = await createApp(prepared, rows).request('/api/friends?includeTags=false&limit=100');

    expect(response.status).toBe(200);
    expect(mocks.getFriendTagsByFriendIds).not.toHaveBeenCalled();
    expect(prepared.filter(({ sql }) => sql.includes('friend_tags'))).toHaveLength(0);
    expect(prepared.length).toBeLessThan(10);
  });

  test('direct conditions compile AND and OR before count and pagination', async () => {
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const conditions = encodeURIComponent(JSON.stringify({
      all: [{ kind: 'memo', op: 'contains', value: '折返し' }],
      any: [
        { kind: 'event_booking', op: 'exists', value: 'event-a' },
        { kind: 'reminder', op: 'exists', value: 'reminder-a' },
      ],
    }));
    const response = await createApp(prepared).request(
      `/api/friends?includeTags=false&conditions=${conditions}`,
    );
    expect(response.status).toBe(200);
    const sql = prepared.map((entry) => entry.sql).join('\n');
    expect(sql).toContain('f.private_memo LIKE ?');
    expect(sql).toContain('event_bookings');
    expect(sql).toContain('friend_reminders');
    expect(sql).toContain(' OR ');
  });

  test('saved views cover empty, normal, forbidden, and failed states', async () => {
    const empty = await createApp([]).request('/api/friends/saved-views?lineAccountId=own');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ success: true, data: { items: [], total: 0 } });

    const created = await createApp([]).request('/api/friends/saved-views?lineAccountId=own', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '要確認',
        conditions: { all: [{ kind: 'name', op: 'contains', value: '田中' }] },
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      success: true, data: { id: 'saved-1', match: { total: 1 } },
    });

    const forbidden = await createApp([]).request(
      '/api/friends/saved-views?lineAccountId=other',
    );
    expect(forbidden.status).toBe(404);

    mocks.getSavedSearches.mockRejectedValueOnce(new Error('D1 unavailable'));
    const failed = await createApp([]).request('/api/friends/saved-views?lineAccountId=own');
    expect(failed.status).toBe(500);
  });

  test('timeline returns account columns, empty cursors, authorization, and failures', async () => {
    mocks.canAccess.mockResolvedValue(true);
    const normal = await createApp([], [], undefined, 'owner', (sql) =>
      sql.includes('FROM (') ? [{
        id: 'message-1', event_type: 'message_received', summary: 'メッセージを受信しました',
        source_kind: 'message', source_id: 'message-1', occurred_at: '2026-09-07T01:00:00Z',
        line_account_id: 'own', line_account_name: '本店',
      }] : undefined)
      .request('/api/friends/friend/timeline');
    expect(normal.status).toBe(200);
    expect(await normal.json()).toMatchObject({
      success: true,
      data: { items: [{ lineAccount: { id: 'own', name: '本店' } }], nextCursor: null },
    });

    const empty = await createApp([]).request('/api/friends/friend/timeline');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ data: { items: [], nextCursor: null } });

    mocks.canAccess.mockResolvedValue(false);
    const forbidden = await createApp([]).request('/api/friends/friend/timeline');
    expect(forbidden.status).toBe(404);

    mocks.canAccess.mockResolvedValue(true);
    const failed = await createApp([], [], undefined, 'owner', (sql) => {
      if (sql.includes('FROM (')) throw new Error('D1 unavailable');
      return undefined;
    }).request('/api/friends/friend/timeline');
    expect(failed.status).toBe(500);
  });

  test('200人のタグを1回の一括問い合わせで取得する', async () => {
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const rows = Array.from({ length: 200 }, (_, index) => ({
      id: `friend-${index}`,
      display_name: `Friend ${index}`,
      line_user_id: `U${index}`,
    }));
    mocks.getFriendTagsByFriendIds.mockResolvedValueOnce(new Map([
      ['friend-0', [{ id: 'tag-1', name: '重要', color: '#ff0000', created_at: '2026-09-01' }]],
    ]));

    const response = await createApp(prepared, rows).request('/api/friends?limit=200');

    expect(response.status).toBe(200);
    expect(mocks.getFriendTagsByFriendIds).toHaveBeenCalledTimes(1);
    expect(mocks.getFriendTagsByFriendIds.mock.calls[0][1]).toHaveLength(200);
    const body = await response.json() as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(200);
    expect(body.data.items[0]).toMatchObject({
      id: 'friend-0', tags: [{ id: 'tag-1', name: '重要' }],
    });
  });

  test('タグの一括取得に失敗したときはタグ0件と偽らず500を返す', async () => {
    mocks.getFriendTagsByFriendIds.mockRejectedValueOnce(new Error('D1 unavailable'));
    const rows = [{ id: 'friend-1', display_name: 'Friend 1', line_user_id: 'U1' }];

    const response = await createApp([], rows).request('/api/friends');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Internal server error' });
    expect(mocks.getFriendTagsByFriendIds).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['999999', 200],
    ['-1', 50],
    ['NaN', 50],
  ])('/api/friends は limit=%s を安全な件数へ直す', async (raw, expected) => {
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const response = await createApp(prepared).request(
      `/api/friends?includeTags=false&limit=${raw}&offset=-1`,
    );
    expect(response.status).toBe(200);
    const list = prepared.find(({ sql }) => sql.includes('ORDER BY f.created_at') && sql.includes('LIMIT ? OFFSET ?'));
    expect(list?.binds.slice(-2)).toEqual([expected, 0]);
  });

  test('an explicit hidden LINE account cannot bypass the visible-account scope', async () => {
    const response = await createApp([]).request('/api/friends?lineAccountId=other&includeTags=false');
    expect(response.status).toBe(404);
    expect(mocks.canAccess).toHaveBeenCalled();
  });

  test('score range is applied before count and pagination', async () => {
    mocks.canAccess.mockResolvedValue(true);
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const response = await createApp(prepared).request(
      '/api/friends?lineAccountId=own&scoreMin=30&scoreMax=69&includeTags=false',
    );
    expect(response.status).toBe(200);
    expect(prepared.some(({ sql, binds }) =>
      sql.includes('f.score >= ?') && sql.includes('f.score <= ?')
      && binds.includes(30) && binds.includes(69))).toBe(true);
  });

  test('rejects malformed or reversed score ranges', async () => {
    expect((await createApp([]).request('/api/friends?scoreMin=abc')).status).toBe(400);
    expect((await createApp([]).request('/api/friends?scoreMin=70&scoreMax=30')).status).toBe(400);
  });

  test('分析対象者はアカウント指定がなければ検索しない', async () => {
    const response = await createApp([]).request('/api/friends?audienceId=audience-a');
    expect(response.status).toBe(400);
  });

  test('有効な分析対象者だけを友だち一覧のSQLへ渡す', async () => {
    mocks.canAccess.mockResolvedValue(true);
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const response = await createApp(prepared, [], (sql) => sql.includes('analytics_result_audiences')
      ? { id: 'audience-a', expires_at: '2999-01-01T00:00:00.000Z' }
      : undefined).request('/api/friends?lineAccountId=own&audienceId=audience-a');
    expect(response.status).toBe(200);
    expect(prepared.some(({ sql, binds }) =>
      sql.includes('analytics_result_audience_members arm') && binds.includes('audience-a'))).toBe(true);
  });

  test('権限外のLINEアカウントを一覧条件へ直指定できない', async () => {
    const response = await createApp([]).request('/api/friends?lineAccountId=other');
    expect(response.status).toBe(404);
  });

  test('担当者は分析結果の個人一覧を直接開けない', async () => {
    mocks.canAccess.mockResolvedValue(true);
    const response = await createApp([], [], undefined, 'staff')
      .request('/api/friends?lineAccountId=own&audienceId=audience-a');
    expect(response.status).toBe(403);
  });

  test('shared saved search applies its AND and OR conditions inside the selected account', async () => {
    mocks.canAccess.mockResolvedValue(true);
    mocks.getSavedSearchById.mockResolvedValue({
      id: 'search-1',
      scope: 'friends',
      created_by: 'another-staff',
      line_account_id: 'own',
      is_shared: 1,
      revision: 4,
      conditions_json: JSON.stringify({
        all: [{ kind: 'tag', op: 'includes', value: 'vip' }],
        any: [{ kind: 'name', op: 'contains', value: '田中' }],
      }),
    });
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const response = await createApp(prepared).request(
      '/api/friends?includeTags=false&lineAccountId=own&savedSearchId=search-1',
    );
    expect(response.status).toBe(200);
    expect(prepared.some(({ sql, binds }) =>
      sql.includes('friend_tags sft') && sql.includes('f.display_name LIKE ?')
      && binds.includes('vip') && binds.includes('%田中%'))).toBe(true);
    expect(mocks.recordSavedSearchUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        savedSearchId: 'search-1',
        lineAccountId: 'own',
        revision: 4,
        referenceKind: 'friends',
        usedBy: 'staff',
      }),
    );
  });

  test('利用回数の記録失敗だけでは友だち一覧を失敗させない', async () => {
    mocks.canAccess.mockResolvedValue(true);
    mocks.getSavedSearchById.mockResolvedValue({
      id: 'search-1',
      scope: 'friends',
      created_by: 'staff',
      line_account_id: 'own',
      is_shared: 0,
      revision: 2,
      conditions_json: JSON.stringify({
        all: [{ kind: 'name', op: 'contains', value: '田中' }],
      }),
    });
    mocks.recordSavedSearchUsage.mockRejectedValueOnce(new Error('D1 unavailable'));
    const response = await createApp([]).request(
      '/api/friends?includeTags=false&lineAccountId=own&savedSearchId=search-1',
    );
    expect(response.status).toBe(200);
  });

  test('private saved search owned by another staff is hidden', async () => {
    mocks.canAccess.mockResolvedValue(true);
    mocks.getSavedSearchById.mockResolvedValue({
      id: 'search-1',
      scope: 'friends',
      created_by: 'another-staff',
      line_account_id: 'own',
      is_shared: 0,
      conditions_json: JSON.stringify({ all: [{ kind: 'tag', op: 'includes', value: 'vip' }] }),
    });
    const response = await createApp([], [], undefined, 'staff').request(
      '/api/friends?includeTags=false&lineAccountId=own&savedSearchId=search-1',
    );
    expect(response.status).toBe(404);
  });

  test('saved search from an invisible account returns 404 before reading it', async () => {
    const response = await createApp([]).request(
      '/api/friends?includeTags=false&lineAccountId=other&savedSearchId=search-1',
    );
    expect(response.status).toBe(404);
    expect(mocks.getSavedSearchById).not.toHaveBeenCalled();
  });

  test('search と statusMessage の %/_ はLIKE通しにしない (#496-18)', async () => {
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const response = await createApp(prepared).request(
      '/api/friends?includeTags=false&search=100%25_%5Cx&statusMessage=a%25b',
    );
    expect(response.status).toBe(200);
    const likeStatements = prepared.filter(({ sql }) => sql.includes('LIKE ?'));
    expect(likeStatements.length).toBeGreaterThan(0);
    for (const { sql } of likeStatements) {
      expect(sql).toContain(`ESCAPE '\\'`);
    }
    const stringBinds = prepared.flatMap(({ binds }) => binds).filter((bind) => typeof bind === 'string');
    // search=`100%_\x` → `%100\%\_\\x%`、statusMessage=`a%b` → `%a\%b%`
    expect(stringBinds).toContain('%100\\%\\_\\\\x%');
    expect(stringBinds).toContain('%a\\%b%');
  });
});

describe('N-032 friend stats account scope (#664)', () => {
  const hiddenPaths = [
    '/api/friends/add-breakdown?lineAccountId=other',
    '/api/friends/count?lineAccountId=other',
    '/api/friends/ref-stats?lineAccountId=other',
    '/api/friends/stats?accountId=other',
  ] as const;

  test.each(hiddenPaths)('%s refuses an invisible account without touching its data', async (path) => {
    const prepared: Array<{ sql: string; binds: unknown[] }> = [];
    const response = await createApp(prepared).request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Not found' });
    // ガードが集計より先に動くので、指定IDでSQLを1本も投げない
    expect(prepared).toHaveLength(0);
    expect(mocks.canAccess).toHaveBeenCalled();
    expect(mocks.canAccess.mock.calls[0][2]).toEqual(['other']);
  });

  test.each([
    ['owner', '/api/friends/count?lineAccountId=other'],
    ['admin', '/api/friends/count?lineAccountId=other'],
    ['staff', '/api/friends/count?lineAccountId=other'],
  ] as const)('%s role: %s refuses an invisible account', async (role, path) => {
    const response = await createApp([], [], undefined, role).request(path);
    expect(response.status).toBe(404);
  });

  test.each(hiddenPaths)('%s hides a nonexistent account exactly like an invisible one', async (path) => {
    const first = await createApp([]).request(path);
    const second = await createApp([]).request(path.replace('other', 'ghost-no-such-account'));
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    // 存在の有無で返しを変えない(件数も存在も漏らさない)
    expect(await second.json()).toEqual(await first.json());
  });

  test.each([
    '/api/friends/add-breakdown?lineAccountId=own',
    '/api/friends/count?lineAccountId=own',
    '/api/friends/ref-stats?lineAccountId=own',
    '/api/friends/stats?accountId=own',
  ] as const)('%s still aggregates a visible account', async (path) => {
    mocks.canAccess.mockResolvedValue(true);
    const response = await createApp([]).request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  });

  test('empty scope aggregates nothing instead of leaking', async () => {
    mocks.getScope.mockResolvedValue({ allowedAccountIds: [], canSeeUnassigned: false, ids: [], accounts: [] });
    const response = await createApp([]).request('/api/friends/count');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { count: 0 } });
  });
});
