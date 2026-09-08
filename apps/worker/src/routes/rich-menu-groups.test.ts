import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock @line-crm/db so we can drive the route purely from this test file.
const dbMocks = {
  getRichMenuGroups: vi.fn(),
  getRichMenuGroupById: vi.fn(),
  getRichMenuGroupWithPages: vi.fn(),
  getRichMenuDeleteImpact: vi.fn(),
  getRichMenuAudienceStats: vi.fn(),
  getRichMenuTapStats: vi.fn(),
  recordRichMenuAssignmentsByLineUserIds: vi.fn(),
  clearRichMenuAssignmentsForGroup: vi.fn(),
  jstNow: vi.fn(),
  createRichMenuGroup: vi.fn(),
  updateRichMenuGroupMeta: vi.fn(),
  replaceRichMenuPages: vi.fn(),
  deleteRichMenuGroup: vi.fn(),
  setRichMenuPageImage: vi.fn(),
  pageBelongsToGroup: vi.fn(),
  acquirePublishLease: vi.fn(),
  releasePublishLease: vi.fn(),
  isPublishLeaseHeld: vi.fn(),
  setPageRichMenuId: vi.fn(),
  markRichMenuGroupPublished: vi.fn(),
  getLineAccountById: vi.fn(),
  getFollowingLineUserIdsByTag: vi.fn(),
  listRichMenuSchedulesByGroup: vi.fn(),
  cancelRichMenuSchedule: vi.fn(),
  createRichMenuScheduleAtomic: vi.fn((): Promise<any> => Promise.resolve({ outcome: 'created', id: 'new-schedule' })),
};
vi.mock('@line-crm/db', () => dbMocks);

const accountAccessMocks = {
  canAccessAllLineAccounts: vi.fn(),
};
vi.mock('../services/account-access.js', () => accountAccessMocks);

// Re-import after mock so the module picks up mocked deps.
const { richMenuGroups } = await import('./rich-menu-groups.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database; IMAGES: R2Bucket };
};

function makeR2Stub(): R2Bucket {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    async put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      store.set(key, { body: bytes, contentType: options?.httpMetadata?.contentType });
      return {} as any;
    },
    async get(key: string) {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: item.body,
        httpMetadata: { contentType: item.contentType },
      } as any;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Minimal D1 stub for routes that issue ad-hoc SQL outside the @line-crm/db
// helpers (例: GET /api/rich-menu-groups の thumbnail JOIN クエリ)。
// 空 results / null を返すことで route の「サムネなし」分岐を通す。
function makeMinimalDbStub(): D1Database {
  const empty = { results: [] };
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => empty),
        first: vi.fn(async () => null),
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
      })),
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database;
}

function setupApp(opts: {
  r2?: R2Bucket;
  db?: D1Database;
  staff?: TestEnv['Variables']['staff'] | null;
} = {}) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    const staff = opts.staff === undefined ? { id: 'staff-1', role: 'owner' as const } : opts.staff;
    if (staff) c.set('staff', staff);
    c.env = { DB: opts.db ?? makeMinimalDbStub(), IMAGES: opts.r2 ?? makeR2Stub() };
    await next();
  });
  app.route('/', richMenuGroups);
  return app;
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  accountAccessMocks.canAccessAllLineAccounts.mockReset();
  accountAccessMocks.canAccessAllLineAccounts.mockImplementation(
    async (_db, staff) => Boolean(staff),
  );
  dbMocks.getRichMenuGroupById.mockResolvedValue({
    id: 'g1', account_id: 'acc-1', status: 'draft', size: 'large',
  });
  dbMocks.getRichMenuDeleteImpact.mockResolvedValue({
    group: { id: 'g1', accountId: 'acc-1', name: 'メニュー', status: 'draft' },
    currentAudience: {
      value: 0, state: 'partial', reason: 'preexisting_assignments_not_backfilled',
    },
    nextDisplay: { guaranteedGroupId: null, reason: 'friend_specific_rules', candidates: [] },
    incomingSwitches: [],
    operationalReferences: [],
    lineResources: {
      pageCount: 1, pagesWithLineRichMenuId: 0, isDefaultForAll: false, publishing: false,
    },
    blockers: [],
    canDelete: true,
    recommendedAction: 'delete',
  });
  dbMocks.getRichMenuAudienceStats.mockResolvedValue([]);
  dbMocks.getRichMenuTapStats.mockResolvedValue({ from: '', to: '', byArea: [], byGroup: [], total: 0 });
  dbMocks.recordRichMenuAssignmentsByLineUserIds.mockResolvedValue(undefined);
  dbMocks.clearRichMenuAssignmentsForGroup.mockResolvedValue(undefined);
  dbMocks.jstNow.mockReturnValue('2026-09-07T12:00:00.000');
  dbMocks.createRichMenuScheduleAtomic.mockResolvedValue({ outcome: 'created', id: 'new-schedule' });
});

// ----- GET /api/rich-menu-groups -----

describe('GET /api/rich-menu-groups', () => {
  test('returns empty list when accountId has no groups', async () => {
    dbMocks.getRichMenuGroups.mockResolvedValue([]);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups?accountId=acc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body).toEqual({ success: true, data: [] });
    expect(dbMocks.getRichMenuGroups).toHaveBeenCalledWith(expect.anything(), 'acc-1');
  });

  test('共通一覧契約で絞り込み後にページを切り、件数と固定順を返す', async () => {
    const row = (id: string, name: string, priority: number) => ({
      id, account_id: 'acc-1', name, chat_bar_text: 'メニュー',
      size: 'large', default_page_id: null, is_default_for_all: 0,
      status: 'draft', publishing_at: null, targeting_condition: null,
      targeting_priority: priority, targeting_enabled: 0, folder_id: null,
      display_order: priority,
      created_at: `2026-09-0${priority + 1}T00:00:00.000`,
      updated_at: `2026-09-0${priority + 1}T00:00:00.000`,
    });
    dbMocks.getRichMenuGroups.mockResolvedValue([
      row('g3', '対象C', 2),
      row('g1', '対象A', 0),
      row('g2', '対象B', 1),
    ]);

    const res = await setupApp().request(
      '/api/rich-menu-groups?accountId=acc-1&page=2&limit=1&query=%E5%AF%BE%E8%B1%A1',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: {
        items: [{ id: 'g2' }],
        total: 3,
        limit: 1,
        sort: [
          { field: 'targetingPriority', direction: 'asc' },
          { field: 'createdAt', direction: 'asc' },
          { field: 'id', direction: 'asc' },
        ],
      },
    });
  });

  test('400 when accountId missing', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups');
    expect(res.status).toBe(400);
  });

  test('見えないLINEアカウントの一覧は404にする', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups?accountId=other-account');

    expect(res.status).toBe(404);
    expect(dbMocks.getRichMenuGroups).not.toHaveBeenCalled();
  });

  test('serializes snake_case rows to camelCase', async () => {
    dbMocks.getRichMenuGroups.mockResolvedValue([
      {
        id: 'g1', account_id: 'acc-1', name: 'メイン', chat_bar_text: 'メニュー',
        size: 'large', default_page_id: 'p1', is_default_for_all: 1,
        status: 'published', publishing_at: null,
        created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T01:00:00.000',
      },
    ]);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups?accountId=acc-1');
    const body = (await res.json()) as { data: any[] };
    expect(body.data[0]).toMatchObject({
      id: 'g1', accountId: 'acc-1', chatBarText: 'メニュー',
      isDefaultForAll: true, status: 'published',
    });
  });

  test('今月のタップ数とユニーク割当人数をメニューごとに返す', async () => {
    dbMocks.getRichMenuGroups.mockResolvedValue([
      {
        id: 'g1', account_id: 'acc-1', name: 'メイン', chat_bar_text: 'メニュー',
        size: 'large', default_page_id: 'p1', is_default_for_all: 0,
        status: 'published', publishing_at: null, targeting_condition: null,
        targeting_priority: 0, targeting_enabled: 1, folder_id: null, display_order: 0,
        created_at: '2026-09-01T00:00:00.000', updated_at: '2026-09-01T00:00:00.000',
      },
    ]);
    dbMocks.getRichMenuAudienceStats.mockResolvedValue([
      { groupId: 'g1', currentAudience: 8140, monthlyUniqueAudience: 1020 },
    ]);
    dbMocks.getRichMenuTapStats.mockResolvedValue({
      from: '2026-09-01T00:00:00.000', to: '2026-10-01T00:00:00.000',
      byArea: [], byGroup: [{ groupId: 'g1', taps: 3210 }], total: 3210,
    });

    const res = await setupApp().request('/api/rich-menu-groups?accountId=acc-1');

    expect(res.status).toBe(200);
    expect((await res.json() as { data: any[] }).data[0].monthlyStats).toMatchObject({
      taps: 3210,
      uniqueAudience: {
        value: 1020,
        state: 'partial',
        reason: 'preexisting_assignments_not_backfilled',
      },
    });
  });

  test('集計DBを読めない場合は503にして0件と偽らない', async () => {
    dbMocks.getRichMenuGroups.mockResolvedValue([{ id: 'g1' }]);
    dbMocks.getRichMenuAudienceStats.mockRejectedValue(new Error('db unavailable'));

    const res = await setupApp().request('/api/rich-menu-groups?accountId=acc-1');

    expect(res.status).toBe(503);
  });
});

// ----- GET /api/rich-menu-groups/:groupId -----

describe('GET /api/rich-menu-groups/:groupId', () => {
  test('404 when group not found', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue(null);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/missing');
    expect(res.status).toBe(404);
  });

  test('別LINEアカウントのグループは存在しないものとして返す', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({ id: 'g1', account_id: 'other-account', pages: [] });
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1');

    expect(res.status).toBe(404);
  });

  test('returns group with pages and areas', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', name: 'メイン', chat_bar_text: 'メニュー',
      size: 'large', default_page_id: 'p1', is_default_for_all: 0,
      status: 'draft', publishing_at: null,
      created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T00:00:00.000',
      pages: [{
        id: 'p1', group_id: 'g1', order_index: 0, name: 'ホーム',
        alias_id: 'lhx-g1xxxxxx-0', line_richmenu_id: null,
        image_r2_key: null, image_content_type: null,
        created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T00:00:00.000',
        areas: [{
          id: 'a1', page_id: 'p1',
          bounds_x: 0, bounds_y: 0, bounds_width: 100, bounds_height: 100,
          action_type: 'uri', action_data: '{"uri":"https://x"}',
          actionData: { uri: 'https://x' },
          created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T00:00:00.000',
        }],
      }],
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.pages).toHaveLength(1);
    expect(body.data.pages[0].areas[0]).toMatchObject({
      boundsX: 0, boundsWidth: 100, actionType: 'uri',
      actionData: { uri: 'https://x' },
    });
  });
});

// ----- POST preview-targets / schedule / GET usages (V6 12-1-B/D/F) -----

describe('V6 targeting preview and publish schedule', () => {
  test('削除確認へ割当台帳の現在表示人数を返す', async () => {
    dbMocks.getRichMenuDeleteImpact.mockResolvedValue({
      group: { id: 'g1', accountId: 'acc-1', name: 'メニュー', status: 'published' },
      currentAudience: {
        value: 8140, state: 'partial', reason: 'preexisting_assignments_not_backfilled',
      },
      nextDisplay: { guaranteedGroupId: null, reason: 'friend_specific_rules', candidates: [] },
      incomingSwitches: [],
      operationalReferences: [],
    });

    const res = await setupApp().request('/api/rich-menu-groups/g1/usages');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: {
        currentAudience: {
          value: 8140, state: 'partial', reason: 'preexisting_assignments_not_backfilled',
        },
      },
    });
  });

  test('対象人数と上位メニューとの重複を実データから返す', async () => {
    dbMocks.getRichMenuGroupById.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', size: 'large',
      targeting_condition: JSON.stringify({ operator: 'AND', rules: [] }),
      targeting_priority: 2,
    });
    let countCall = 0;
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (!sql.includes('COUNT(*)')) return null;
            countCall += 1;
            return { count: countCall === 1 ? 1020 : 180 };
          }),
          all: vi.fn(async () => sql.includes('targeting_priority <')
            ? { results: [{ id: 'higher', name: '夏キャンペーン', targeting_condition: JSON.stringify({ operator: 'AND', rules: [] }) }] }
            : { results: [] }),
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
        })),
      })),
    } as unknown as D1Database;
    const app = setupApp({ db });
    const res = await app.request('/api/rich-menu-groups/g1/preview-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: {
        matched: { value: 1020, state: 'available' },
        overlap: { value: 180, state: 'available' },
        effective: { value: 840, state: 'available' },
        higherMenus: ['夏キャンペーン'],
        priority: 3,
      },
    });
  });

  test('見えないアカウントの対象人数は404で隠す', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/preview-targets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(404);
  });

  test('壊れた保存条件を全員扱いにしない', async () => {
    dbMocks.getRichMenuGroupById.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', size: 'large',
      targeting_condition: '{broken', targeting_priority: 0,
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/preview-targets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });

    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('対象条件');
  });

  test('公開予約は実行キーが無ければ保存しない', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', pages: [],
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'scheduled', startsAt: '2026-09-10T01:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('Idempotency-Key');
  });

  test('一般スタッフは公開予約を作れない', async () => {
    const app = setupApp({ staff: { id: 'staff-1', role: 'staff' } });
    const res = await app.request('/api/rich-menu-groups/g1/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'schedule-request-1',
      },
      body: JSON.stringify({ mode: 'scheduled', startsAt: '2026-09-10T01:00:00.000Z' }),
    });

    expect(res.status).toBe(403);
  });
});

describe('GET schedules and POST cancel (E-08 #621)', () => {
  test('予約一覧は状態と再試行時刻を返す', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({ id: 'g1', account_id: 'acc-1' });
    dbMocks.listRichMenuSchedulesByGroup.mockResolvedValue([{
      id: 's1', mode: 'period', starts_at: '2026-09-10T01:00:00.000Z', ends_at: '2026-09-11T01:00:00.000Z',
      restore_group_id: null, restore_default_state: 'captured',
      status: 'published', attempt_count: 0, next_retry_at: null,
      last_error_code: null, created_at: '2026-09-06',
    }]);
    const res = await setupApp().request('/api/rich-menu-groups/g1/schedules');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: [{ id: 's1', status: 'published', attemptCount: 0, restoreGroupId: null, restoreDefaultState: 'captured' }],
    });
  });

  test('期間予約で前のメニュー未指定は予約時に確定せずnullで保存する', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', pages: [],
    });
    const db = makeMinimalDbStub();
    // INSERT成功・重複なし
    const app = setupApp({ db });
    const res = await app.request('/api/rich-menu-groups/g1/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'period-resolve-1' },
      body: JSON.stringify({ mode: 'period', startsAt: '2026-09-10T01:00:00.000Z', endsAt: '2026-09-11T01:00:00.000Z' }),
    });
    expect(res.status).toBe(201);
    // 戻し先は実行開始直前に実LINE defaultから固定するため、予約時点では未確定。
    expect(await res.json()).toMatchObject({
      success: true,
      data: { status: 'scheduled', restoreGroupId: null, restoreDefaultState: null },
    });
    expect(dbMocks.createRichMenuScheduleAtomic).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ restoreGroupId: null }),
    );
  });

  test('明示の戻し先指定は検証してそのまま保存する', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', pages: [],
    });
    dbMocks.getRichMenuGroupById.mockResolvedValue({ id: 'prev-1', account_id: 'acc-1', status: 'published' });
    const app = setupApp({ db: makeMinimalDbStub() });
    const res = await app.request('/api/rich-menu-groups/g1/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'period-explicit-1' },
      body: JSON.stringify({ mode: 'period', startsAt: '2026-09-10T01:00:00.000Z', endsAt: '2026-09-11T01:00:00.000Z', restoreGroupId: 'prev-1' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { status: 'scheduled', restoreGroupId: 'prev-1' },
    });
  });

  test('同じIdempotency-Key・同じ内容の同時2要求は同じ予約を返す', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', pages: [],
    });
    dbMocks.createRichMenuScheduleAtomic
      .mockResolvedValueOnce({ outcome: 'created', id: 's-first' })
      .mockResolvedValueOnce({ outcome: 'existing', id: 's-first', status: 'scheduled' });
    const app = setupApp({ db: makeMinimalDbStub() });
    const body = JSON.stringify({ mode: 'scheduled', startsAt: '2026-09-10T01:00:00.000Z' });
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-key-2req' };
    const first = await app.request('/api/rich-menu-groups/g1/schedule', { method: 'POST', headers, body });
    const second = await app.request('/api/rich-menu-groups/g1/schedule', { method: 'POST', headers, body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, data: { id: 's-first', status: 'scheduled' } });
  });

  test('同じkey・異なる内容は成功扱いにせず409を返す', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', pages: [],
    });
    dbMocks.createRichMenuScheduleAtomic.mockResolvedValue({ outcome: 'conflict', id: 's-orig', status: 'scheduled' });
    const res = await setupApp({ db: makeMinimalDbStub() }).request('/api/rich-menu-groups/g1/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'dup-key' },
      body: JSON.stringify({ mode: 'scheduled', startsAt: '2026-09-11T01:00:00.000Z' }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false });
  });

  test('見えないアカウントの予約一覧は404で隠す', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({ id: 'g1', account_id: 'acc-1' });
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const res = await setupApp().request('/api/rich-menu-groups/g1/schedules');
    expect(res.status).toBe(404);
  });

  test('実行前の取消ができる', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({ id: 'g1', account_id: 'acc-1' });
    dbMocks.cancelRichMenuSchedule.mockResolvedValue(true);
    const res = await setupApp().request('/api/rich-menu-groups/g1/schedules/s1/cancel', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { id: 's1', status: 'cancelled' } });
  });

  test('実行が始まった取消は409で最新状態を返す', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({ id: 'g1', account_id: 'acc-1' });
    dbMocks.cancelRichMenuSchedule.mockResolvedValue(false);
    dbMocks.listRichMenuSchedulesByGroup.mockResolvedValue([{ id: 's1', status: 'publishing' }]);
    const res = await setupApp().request('/api/rich-menu-groups/g1/schedules/s1/cancel', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, status: 'publishing' });
  });

  test('別グループの予約は取り消さない', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({ id: 'g1', account_id: 'acc-1' });
    dbMocks.cancelRichMenuSchedule.mockResolvedValue(false);
    dbMocks.listRichMenuSchedulesByGroup.mockResolvedValue([]);
    const res = await setupApp().request('/api/rich-menu-groups/g1/schedules/other/cancel', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/rich-menu-groups/:groupId/usages', () => {
  test('使用中0件を取得失敗と混ぜずに返す', async () => {
    const res = await setupApp().request('/api/rich-menu-groups/g1/usages');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { currentAudience: { value: 0, state: 'partial' }, incomingSwitches: [] },
    });
  });

  test('見えないLINEアカウントの使用先は404で隠す', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);

    const res = await setupApp().request('/api/rich-menu-groups/g1/usages');

    expect(res.status).toBe(404);
  });

  test('DB取得失敗は503にして0件と偽らない', async () => {
    dbMocks.getRichMenuDeleteImpact.mockRejectedValue(new Error('db unavailable'));

    const res = await setupApp().request('/api/rich-menu-groups/g1/usages');

    expect(res.status).toBe(503);
  });
});

// ----- POST /api/rich-menu-groups -----

describe('POST /api/rich-menu-groups', () => {
  test('rejects missing accountId', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', chatBarText: 'x', size: 'large', pages: [{ name: 'p', orderIndex: 0, areas: [] }] }),
    });
    expect(res.status).toBe(400);
  });

  test('見えないLINEアカウントには作成しない', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'other-account', name: 'x', chatBarText: 'x', size: 'large',
        pages: [{ name: 'p', orderIndex: 0, areas: [] }],
      }),
    });

    expect(res.status).toBe(404);
    expect(dbMocks.createRichMenuGroup).not.toHaveBeenCalled();
  });

  test('rejects invalid size enum', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'a', name: 'x', chatBarText: 'x', size: 'huge', pages: [{ name: 'p', orderIndex: 0, areas: [] }] }),
    });
    expect(res.status).toBe(400);
  });

  test('rejects pages with non-sequential orderIndex', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'a', name: 'x', chatBarText: 'x', size: 'large',
        pages: [
          { name: 'p1', orderIndex: 0, areas: [] },
          { name: 'p2', orderIndex: 5, areas: [] },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  test('rejects richmenuswitch action in create payload (Round 3 P2-1)', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'a', name: 'x', chatBarText: 'x', size: 'large',
        pages: [
          { name: 'p1', orderIndex: 0, areas: [
            { boundsX: 0, boundsY: 0, boundsWidth: 1, boundsHeight: 1,
              actionType: 'richmenuswitch', actionData: { targetPageId: 'p2' } },
          ] },
          { name: 'p2', orderIndex: 1, areas: [] },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/richmenuswitch/i);
  });

  test('rejects duplicate page.id in payload (Round 3 P3)', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'a', name: 'x', chatBarText: 'x', size: 'large',
        pages: [
          { id: 'dup', name: 'p1', orderIndex: 0, areas: [] },
          { id: 'dup', name: 'p2', orderIndex: 1, areas: [] },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/duplicat/i);
  });

  test('rejects more than 20 areas per page', async () => {
    const tooMany = Array.from({ length: 21 }, () => ({
      boundsX: 0, boundsY: 0, boundsWidth: 1, boundsHeight: 1,
      actionType: 'message', actionData: { text: 'x' },
    }));
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'a', name: 'x', chatBarText: 'x', size: 'large',
        pages: [{ name: 'p1', orderIndex: 0, areas: tooMany }],
      }),
    });
    expect(res.status).toBe(400);
  });

  test('forwards parsed input to createRichMenuGroup', async () => {
    dbMocks.createRichMenuGroup.mockResolvedValue({
      id: 'new-1', account_id: 'a', name: 'x', chat_bar_text: 'x', size: 'large',
      default_page_id: 'p1', is_default_for_all: 0, status: 'draft', publishing_at: null,
      created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T00:00:00.000',
      pages: [{ id: 'p1', group_id: 'new-1', order_index: 0, name: 'p1', alias_id: 'lhx-newxxxxx-0',
        line_richmenu_id: null, image_r2_key: null, image_content_type: null,
        created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T00:00:00.000', areas: [] }],
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'a', name: 'x', chatBarText: 'バー', size: 'large',
        pages: [{ name: 'p1', orderIndex: 0, areas: [] }],
      }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.createRichMenuGroup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'a', name: 'x', chatBarText: 'バー', size: 'large',
        pages: [expect.objectContaining({ name: 'p1', orderIndex: 0 })],
      }),
    );
  });
});

// ----- PATCH /api/rich-menu-groups/:groupId -----

describe('PATCH /api/rich-menu-groups/:groupId', () => {
  test('404 when group missing', async () => {
    dbMocks.getRichMenuGroupById.mockResolvedValue(null);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new' }),
    });
    expect(res.status).toBe(404);
  });

  test('updates meta fields', async () => {
    dbMocks.getRichMenuGroupById.mockResolvedValue({ id: 'g1' });
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'a', name: 'new', chat_bar_text: 'バー', size: 'large',
      default_page_id: null, is_default_for_all: 1, status: 'draft', publishing_at: null,
      created_at: '', updated_at: '', pages: [],
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new', isDefaultForAll: true }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.updateRichMenuGroupMeta).toHaveBeenCalledWith(expect.anything(), 'g1', {
      name: 'new', isDefaultForAll: true,
    });
    expect(dbMocks.replaceRichMenuPages).not.toHaveBeenCalled();
  });

  test('replaces pages when pages key present', async () => {
    dbMocks.getRichMenuGroupById.mockResolvedValue({ id: 'g1' });
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', account_id: 'a', name: 'x', chat_bar_text: 'x', size: 'large',
      default_page_id: null, is_default_for_all: 0, status: 'draft', publishing_at: null,
      created_at: '', updated_at: '', pages: [],
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pages: [
          { name: 'p1', orderIndex: 0, areas: [] },
          { name: 'p2', orderIndex: 1, areas: [] },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.replaceRichMenuPages).toHaveBeenCalledWith(
      expect.anything(),
      'g1',
      expect.arrayContaining([
        expect.objectContaining({ name: 'p1' }),
        expect.objectContaining({ name: 'p2' }),
      ]),
    );
  });
});

// ----- GET /api/rich-menu-groups/:groupId/delete-impact -----

describe('GET /api/rich-menu-groups/:groupId/delete-impact', () => {
  test('割当台帳で確認できた現在人数と不完全理由を返す', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/delete-impact');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { currentAudience: { value: number; state: string; reason: string }; canDelete: boolean };
    };
    expect(body).toMatchObject({
      success: true,
      data: {
        currentAudience: {
          value: 0, state: 'partial', reason: 'preexisting_assignments_not_backfilled',
        },
        canDelete: true,
      },
    });
  });

  test('returns 404 without exposing another LINE account', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/delete-impact');
    expect(res.status).toBe(404);
  });

  test('returns 404 when the group is missing', async () => {
    dbMocks.getRichMenuDeleteImpact.mockResolvedValue(null);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/missing/delete-impact');
    expect(res.status).toBe(404);
  });

  test('returns 503 instead of fake zeroes when impact lookup fails', async () => {
    dbMocks.getRichMenuDeleteImpact.mockRejectedValue(new Error('db unavailable'));
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/delete-impact');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: '削除したときの影響を確認できませんでした',
    });
  });
});

// ----- DELETE /api/rich-menu-groups/:groupId -----

describe('DELETE /api/rich-menu-groups/:groupId', () => {
  test('returns 200 on success (draft group)', async () => {
    dbMocks.deleteRichMenuGroup.mockResolvedValue(true);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  test('returns 404 when group missing', async () => {
    dbMocks.getRichMenuDeleteImpact.mockResolvedValue(null);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  test('returns 409 for published group without force (unpublish first)', async () => {
    dbMocks.getRichMenuDeleteImpact.mockResolvedValue({
      group: { id: 'g1', accountId: 'acc-1', name: '公開中', status: 'published' },
      blockers: ['published'],
      canDelete: false,
      recommendedAction: 'unpublish',
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(dbMocks.deleteRichMenuGroup).not.toHaveBeenCalled();
  });

  test('force=true cannot skip the impact guard', async () => {
    dbMocks.getRichMenuDeleteImpact.mockResolvedValue({
      group: { id: 'g1', accountId: 'acc-1', name: '公開中', status: 'published' },
      blockers: ['published'],
      canDelete: false,
      recommendedAction: 'unpublish',
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1?force=true', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(dbMocks.deleteRichMenuGroup).not.toHaveBeenCalled();
  });

  test('returns 503 and does not delete when the fresh impact check fails', async () => {
    dbMocks.getRichMenuDeleteImpact.mockRejectedValue(new Error('db unavailable'));
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1', { method: 'DELETE' });
    expect(res.status).toBe(503);
    expect(dbMocks.deleteRichMenuGroup).not.toHaveBeenCalled();
  });
});

// ----- POST /api/rich-menu-groups/:groupId/pages/:pageId/image -----

const PNG_2500x1686 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x09, 0xc4, 0x00, 0x00, 0x06, 0x96,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

describe('POST /api/rich-menu-groups/:groupId/pages/:pageId/image', () => {
  test('rejects wrong content-type', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/pages/p1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not an image',
    });
    expect(res.status).toBe(400);
  });

  test('別LINEアカウントの画像は本文を読む前に拒否する', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/pages/p1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_2500x1686,
    });

    expect(res.status).toBe(404);
    expect(dbMocks.pageBelongsToGroup).not.toHaveBeenCalled();
  });

  test('rejects when page does not belong to group', async () => {
    dbMocks.pageBelongsToGroup.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/pages/p1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_2500x1686,
    });
    expect(res.status).toBe(404);
  });

  test('rejects invalid dimensions via image-validator', async () => {
    dbMocks.pageBelongsToGroup.mockResolvedValue(true);
    const odd = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/pages/p1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: odd,
    });
    expect(res.status).toBe(400);
  });

  test('申告サイズが1MB超なら本文を読む前に413で断る', async () => {
    dbMocks.pageBelongsToGroup.mockResolvedValue(true);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/pages/p1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(2 * 1024 * 1024) },
      body: PNG_2500x1686,
    });
    expect(res.status).toBe(413);
  });

  test('on success uploads to R2 and updates DB image key', async () => {
    dbMocks.pageBelongsToGroup.mockResolvedValue(true);
    dbMocks.getRichMenuGroupById.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', name: 'x', chat_bar_text: 'x', size: 'large',
      default_page_id: null, is_default_for_all: 0, status: 'draft', publishing_at: null,
      created_at: '', updated_at: '',
    });
    const r2 = makeR2Stub();
    const app = setupApp({ r2 });
    const res = await app.request('/api/rich-menu-groups/g1/pages/p1/image', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_2500x1686,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { imageR2Key: string; size: string } };
    expect(body.data.imageR2Key).toMatch(/^rich-menus\/acc-1\/g1\/p1\//);
    expect(body.data.size).toBe('large');
    // R2 に書き込まれているか
    const stored = await r2.get(body.data.imageR2Key);
    expect(stored).not.toBeNull();
    expect(dbMocks.setRichMenuPageImage).toHaveBeenCalledWith(
      expect.anything(), 'p1', body.data.imageR2Key, 'image/png',
    );
  });
});

describe('GET /api/rich-menu-images/:key', () => {
  test('匿名では既定統括のR2画像を返さない', async () => {
    const r2 = makeR2Stub();
    const key = 'rich-menus/acc-1/g1/p1/image.png';
    await r2.put(key, PNG_2500x1686);
    const res = await setupApp({ r2, staff: null }).request(`/api/rich-menu-images/${key}`);

    expect(res.status).toBe(404);
  });

  test('別LINEアカウントのR2画像を返さない', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const r2 = makeR2Stub();
    await r2.put('rich-menus/other-account/g1/p1/image.png', PNG_2500x1686);
    const app = setupApp({ r2 });
    const res = await app.request('/api/rich-menu-images/rich-menus/other-account/g1/p1/image.png');

    expect(res.status).toBe(404);
  });

  test('同じ統括のスタッフにはR2画像を返す', async () => {
    const r2 = makeR2Stub();
    const key = 'rich-menus/acc-1/g1/p1/image.png';
    await r2.put(key, PNG_2500x1686, { httpMetadata: { contentType: 'image/png' } });
    const res = await setupApp({ r2 }).request(`/api/rich-menu-images/${key}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });
});

describe('GET /api/rich-menu-groups/external', () => {
  test('LINEの面ごとのURLと送信文を返す', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'line-token' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/richmenu/list')) {
        return new Response(JSON.stringify({
          richmenus: [{
            richMenuId: 'external-1', name: '外部メニュー', chatBarText: 'メニュー',
            selected: true, size: { width: 2500, height: 1686 },
            areas: [
              { bounds: { x: 0, y: 0, width: 100, height: 100 }, action: { type: 'uri', uri: 'https://example.com/menu' } },
              { bounds: { x: 100, y: 0, width: 100, height: 100 }, action: { type: 'message', text: '予約したい' } },
              { bounds: { x: 200, y: 0, width: 100, height: 100 }, action: { type: 'camera' } },
            ],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ richMenuId: 'external-1' }), { status: 200 });
    });

    const res = await setupApp().request('/api/rich-menu-groups/external?accountId=acc-1');
    const body = await res.json() as { data: { lineMenus: any[] } };

    expect(res.status).toBe(200);
    expect(body.data.lineMenus[0]).toMatchObject({
      richMenuId: 'external-1', isCurrentDefault: true, areasCount: 3,
      areas: [
        { action: { type: 'uri', url: 'https://example.com/menu', supported: true } },
        { action: { type: 'message', text: '予約したい', supported: true } },
        { action: { type: 'camera', supported: false, unsupportedReason: 'unsupported_or_incomplete_action' } },
      ],
    });
    fetchSpy.mockRestore();
  });

  test('LINEにメニューが無ければ空一覧を返す', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'line-token' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ richmenus: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));

    const res = await setupApp().request('/api/rich-menu-groups/external?accountId=acc-1');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { currentDefault: null, lineMenus: [] } });
    fetchSpy.mockRestore();
  });

  test('LINE一覧の取得失敗は500で返す', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'line-token' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));

    const res = await setupApp().request('/api/rich-menu-groups/external?accountId=acc-1');

    expect(res.status).toBe(500);
    fetchSpy.mockRestore();
  });

  test('見えないLINEアカウントではLINEへ問い合わせない', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await setupApp().request('/api/rich-menu-groups/external?accountId=other-account');

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('GET /api/rich-menu-groups/external/:richMenuId/image', () => {
  test('匿名ではLINE画像を取りに行かない', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await setupApp({ staff: null }).request(
      '/api/rich-menu-groups/external/rich-menu-id/image?accountId=acc-1',
    );

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('別統括のLINE画像を取りに行かない', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await setupApp().request(
      '/api/rich-menu-groups/external/rich-menu-id/image?accountId=other-account',
    );

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('同じ統括のスタッフにはLINE画像を返す', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'line-token' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(PNG_2500x1686, { headers: { 'Content-Type': 'image/png' } }),
    );
    const res = await setupApp().request(
      '/api/rich-menu-groups/external/rich-menu-id/image?accountId=acc-1',
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    fetchSpy.mockRestore();
  });
});

// ----- POST /api/rich-menu-groups/:groupId/publish -----

describe('POST /api/rich-menu-groups/:groupId/publish', () => {
  test('404 when group missing', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue(null);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/missing/publish', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('409 when already publishing', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'g1', publishing_at: '2026-05-08', pages: [],
      account_id: 'a', name: 'x', chat_bar_text: 'x', size: 'large',
      default_page_id: null, is_default_for_all: 0, status: 'draft',
      created_at: '', updated_at: '',
    });
    // 有効なlease保持中だけ409。旧形式の残留だけでは塞がない。
    dbMocks.isPublishLeaseHeld.mockResolvedValue(true);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/publish', { method: 'POST' });
    expect(res.status).toBe(409);
    // 期限切れでない他人所有は取りに行かない。
    expect(dbMocks.acquirePublishLease).not.toHaveBeenCalled();
  });

  test('400 with actionable message when an area action is incomplete — releases lock', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'gid12345-aaaa', account_id: 'acc-1',
      name: 'x', chat_bar_text: 'メニュー', size: 'large',
      default_page_id: 'p1', is_default_for_all: 0, status: 'draft', publishing_at: null,
      created_at: '', updated_at: '',
      pages: [{
        id: 'p1', group_id: 'gid12345-aaaa', order_index: 0, name: '基本メニュー',
        alias_id: 'lhx-gid12345-0', line_richmenu_id: null,
        image_r2_key: 'rich-menus/p1.png', image_content_type: 'image/png',
        created_at: '', updated_at: '',
        areas: [{
          id: 'a1', page_id: 'p1',
          bounds_x: 0, bounds_y: 0, bounds_width: 100, bounds_height: 100,
          action_type: 'message', action_data: '{"text":""}', actionData: { text: '' },
          created_at: '', updated_at: '',
        }],
      }],
    });
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'tk' });
    dbMocks.isPublishLeaseHeld.mockResolvedValue(false);
    dbMocks.acquirePublishLease.mockResolvedValue(true);

    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/gid12345-aaaa/publish', { method: 'POST' });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'ページ「基本メニュー」のタップ領域1: 送信テキストを入力してください',
    });
    // 所有者付きで解放する。
    expect(dbMocks.releasePublishLease).toHaveBeenCalledWith(expect.anything(), 'gid12345-aaaa', expect.stringMatching(/^manual-/));
  });

  test('500 when LINE fetch throws — releases lock', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue({
      id: 'gid12345-aaaa', account_id: 'acc-1',
      name: 'x', chat_bar_text: 'メニュー', size: 'large',
      default_page_id: 'p1', is_default_for_all: 0, status: 'draft', publishing_at: null,
      created_at: '', updated_at: '',
      pages: [{
        id: 'p1', group_id: 'gid12345-aaaa', order_index: 0, name: 'p1',
        alias_id: 'lhx-gid12345-0', line_richmenu_id: null,
        image_r2_key: null, image_content_type: null,
        created_at: '', updated_at: '', areas: [],
      }],
    });
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'tk' });
    dbMocks.isPublishLeaseHeld.mockResolvedValue(false);
    dbMocks.acquirePublishLease.mockResolvedValue(true);

    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/gid12345-aaaa/publish', { method: 'POST' });
    expect(res.status).toBe(500);
    expect(dbMocks.releasePublishLease).toHaveBeenCalledWith(expect.anything(), 'gid12345-aaaa', expect.stringMatching(/^manual-/));
  });
});

// ----- #502中 (PR #552): 優先順一括・冪等キー・作成時フォルダ・条件上限・外部応答の固定文言 -----

describe('POST /api/rich-menu-groups/reorder-priorities (#502中)', () => {
  test('id配列を1回でそろえ直す', async () => {
    dbMocks.getRichMenuGroups.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }]);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/reorder-priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', orderedIds: ['g2', 'g1', 'g3'] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { updated: 3 } });
    // 個別PATCHは使わない。1 batch で3件そろえる。
    expect(dbMocks.updateRichMenuGroupMeta).not.toHaveBeenCalled();
  });

  test('足りない・余分・重複のidは400で何も書かない', async () => {
    dbMocks.getRichMenuGroups.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    const app = setupApp();
    for (const orderedIds of [['g1'], ['g1', 'g2', 'g3'], ['g1', 'g1'], ['g1', 'other']]) {
      const res = await app.request('/api/rich-menu-groups/reorder-priorities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'acc-1', orderedIds }),
      });
      expect(res.status).toBe(400);
    }
  });

  test('一般スタッフは並び替えできない', async () => {
    const app = setupApp({ staff: { id: 'staff-1', role: 'staff' } });
    const res = await app.request('/api/rich-menu-groups/reorder-priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', orderedIds: [] }),
    });
    expect(res.status).toBe(403);
  });

  test('見えないアカウントの並び替えは404で隠す', async () => {
    accountAccessMocks.canAccessAllLineAccounts.mockResolvedValue(false);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/reorder-priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'other', orderedIds: [] }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.getRichMenuGroups).not.toHaveBeenCalled();
  });
});

describe('POST /api/rich-menu-groups/:groupId/apply-to-tag (#502中)', () => {
  const publishedGroup = {
    id: 'g1', account_id: 'acc-1', status: 'published',
    default_page_id: 'p1',
    pages: [{ id: 'p1', order_index: 0, line_richmenu_id: 'rm-1' }],
  };

  test('一括適用は実行キーが無ければ受け付けない', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue(publishedGroup);
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'tk' });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/apply-to-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'bulk-link', tagId: null }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('Idempotency-Key');
    expect(dbMocks.getFollowingLineUserIdsByTag).not.toHaveBeenCalled();
  });

  test('対象0件は鍵をrunIdとして返す', async () => {
    dbMocks.getRichMenuGroupWithPages.mockResolvedValue(publishedGroup);
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'tk' });
    dbMocks.getFollowingLineUserIdsByTag.mockResolvedValue([]);
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/apply-to-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'run-1' },
      body: JSON.stringify({ mode: 'bulk-link', tagId: null }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true, data: { chunks: 0, total: 0, runId: 'run-1', message: 'no matching followers' },
    });
  });
});

describe('POST /api/rich-menu-groups (作成時フォルダ #502中)', () => {
  test('folderIdの形違いは400', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'a', name: 'x', chatBarText: 'x', size: 'large', folderId: 123,
        pages: [{ name: 'p1', orderIndex: 0, areas: [] }],
      }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.createRichMenuGroup).not.toHaveBeenCalled();
  });

  test('folderIdを作成へそのまま渡す', async () => {
    dbMocks.createRichMenuGroup.mockResolvedValue({
      id: 'new-1', account_id: 'a', name: 'x', chat_bar_text: 'x', size: 'large',
      default_page_id: 'p1', is_default_for_all: 0, status: 'draft', publishing_at: null,
      created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T00:00:00.000',
      pages: [{ id: 'p1', group_id: 'new-1', order_index: 0, name: 'p1', alias_id: 'lhx-newxxxxx-0',
        line_richmenu_id: null, image_r2_key: null, image_content_type: null,
        created_at: '2026-05-08T00:00:00.000', updated_at: '2026-05-08T00:00:00.000', areas: [] }],
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'a', name: 'x', chatBarText: 'x', size: 'large', folderId: 'folder-1',
        pages: [{ name: 'p1', orderIndex: 0, areas: [] }],
      }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.createRichMenuGroup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ folderId: 'folder-1' }),
    );
  });
});

describe('人数プレビューの権限と複雑さ上限 (#502中)', () => {
  test('一般スタッフは人数を数えられない', async () => {
    const app = setupApp({ staff: { id: 'staff-1', role: 'staff' } });
    const res = await app.request('/api/rich-menu-groups/g1/preview-targets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(403);
  });

  test('条件が複雑すぎるときは数えず400', async () => {
    dbMocks.getRichMenuGroupById.mockResolvedValue({
      id: 'g1', account_id: 'acc-1', status: 'draft', size: 'large',
      targeting_condition: null, targeting_priority: 0,
    });
    const app = setupApp();
    const res = await app.request('/api/rich-menu-groups/g1/preview-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conditions: {
          operator: 'AND',
          rules: Array.from({ length: 51 }, (_, i) => ({ type: 'tag_exists', value: `tag-${i}` })),
        },
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('複雑');
  });
});

describe('外部応答の固定文言 (#502中)', () => {
  test('取込でLINEに無いときは外部本文を出さない', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'tk' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":"external detail leak"}', { status: 404 }));
    const app = setupApp();
    const res = await app.request(
      '/api/rich-menu-groups/import?accountId=acc-1&richMenuId=no-such-menu',
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('external detail leak');
    expect(body.error).toContain('見つかりません');
    fetchSpy.mockRestore();
  });

  test('外部画像のIDは符号化して送る', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'tk' });
    const seen: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      seen.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200, headers: { 'content-type': 'image/png' },
      });
    });
    const app = setupApp();
    const res = await app.request(
      '/api/rich-menu-groups/external/a%20b/image?accountId=acc-1',
    );
    expect(res.status).toBe(200);
    expect(seen[0]).toContain(encodeURIComponent('a b'));
    expect(seen[0]).not.toContain('/richmenu/a b/');
    fetchSpy.mockRestore();
  });
});
