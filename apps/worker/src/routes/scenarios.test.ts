import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));

vi.mock('../services/account-access.js', () => accountAccessMocks);

const dbMocks = {
  getScenarios: vi.fn(),
  getScenarioById: vi.fn(),
  createScenario: vi.fn(),
  updateScenario: vi.fn(),
  deleteScenario: vi.fn(),
  createScenarioStep: vi.fn(),
  updateScenarioStep: vi.fn(),
  deleteScenarioStep: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getFriendById: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

vi.mock('../services/scenario-stats.js', () => ({
  computeScenarioStats: vi.fn(),
}));

const { scenarios: scenariosModule } = await import('./scenarios.js');

interface ScenarioRow {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_tag_id: string | null;
  is_active: number;
  delivery_mode: string;
  created_at: string;
  updated_at: string;
  line_account_id: string | null;
  step_count: number;
}

function makeScenarioDb(rows: ScenarioRow[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all<_T>() {
          calls.push({ sql, binds: bound });
          if (/SELECT s\.\*, COUNT\(ss\.id\)/i.test(sql)) {
            const [lineAccountId, limit, offset] = bound as [string, number, number];
            const includeGlobal = /line_account_id IS NULL/i.test(sql);
            const filtered = rows.filter((r) =>
              r.line_account_id === lineAccountId || (includeGlobal && r.line_account_id == null));
            return { results: filtered.slice(offset, offset + limit) };
          }
          return { results: [] };
        },
        async first<_T>() {
          calls.push({ sql, binds: bound });
          if (/COUNT\(\*\) AS total FROM scenarios/i.test(sql)) {
            const [lineAccountId] = bound as [string];
            const includeGlobal = /line_account_id IS NULL/i.test(sql);
            return {
              total: rows.filter((r) =>
                r.line_account_id === lineAccountId || (includeGlobal && r.line_account_id == null)).length,
            } as _T;
          }
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function setupApp(
  db: D1Database,
  permissionKeys: string[] = ['/scenarios'],
  role: 'owner' | 'admin' | 'staff' = 'owner',
) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', {
      id: 'owner-1',
      name: '管理者',
      role,
      readOnly: false,
      tenantId: 'tenant-1',
      permissionKeys,
      assignedLineAccountId: null,
      canAccessDescendantAccounts: true,
    });
    await next();
  });
  app.route('/', scenariosModule);
  return app;
}

const rowBase = {
  description: null,
  trigger_type: 'friend_add',
  trigger_tag_id: null,
  is_active: 1,
  delivery_mode: 'relative',
  created_at: '2026-05-20T00:00:00.000',
  updated_at: '2026-05-20T00:00:00.000',
  step_count: 0,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  accountAccessMocks.canAccessAllLineAccounts.mockReset().mockResolvedValue(true);
  accountAccessMocks.getVisibleLineAccountScope.mockReset().mockResolvedValue({
    allowedAccountIds: ['acc-1'],
    canSeeUnassigned: true,
  });
});

describe('GET /api/scenarios?lineAccountId=X', () => {
  test('includes both account-bound and global (NULL) scenarios', async () => {
    const rows: ScenarioRow[] = [
      { id: 's-global', name: 'global', line_account_id: null, ...rowBase },
      { id: 's-acc1', name: 'acc1', line_account_id: 'acc-1', ...rowBase },
      { id: 's-acc2', name: 'acc2', line_account_id: 'acc-2', ...rowBase },
    ];
    const { db, calls } = makeScenarioDb(rows);

    const res = await setupApp(db).request('/api/scenarios?lineAccountId=acc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { items: { id: string; lineAccountId: string | null }[]; total: number; limit: number } };
    expect(body.success).toBe(true);
    // webhook.ts:211 / liff.ts:878 trigger scenarios where line_account_id is
    // NULL (global) OR matches the active account. The list endpoint must
    // mirror that so the UI does not hide records the engine will fire.
    const ids = body.data.items.map((d) => d.id).sort();
    expect(ids).toEqual(['s-acc1', 's-global']);
    // Serializer surfaces the binding so the UI can distinguish 全アカ共通 from
    // an account-specific scenario.
    const globalRow = body.data.items.find((d) => d.id === 's-global');
    expect(globalRow?.lineAccountId).toBeNull();
    // 一覧を引くクエリは1本だけ。人数の集計は別に1本走るので、
    // 本数ではなく「一覧を引くもの」を選んで見る。
    const listCalls = calls.filter((c) => /SELECT s\.\*, COUNT\(ss\.id\)/i.test(c.sql));
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].sql).toMatch(/line_account_id IS NULL/);
    expect(listCalls[0].sql).toMatch(/s\.line_account_id = \?/);
    expect(listCalls[0].binds).toEqual(['acc-1', 50, 0]);

    // 購読中と読了済は、シナリオごとに引かず1回でまとめて数える。
    // 件数ぶん往復すると、シナリオが増えるほど一覧が遅くなる。
    const countCalls = calls.filter((c) => /FROM friend_scenarios/i.test(c.sql));
    expect(countCalls).toHaveLength(1);
    expect(countCalls[0].sql).toMatch(/f\.line_account_id IN/);
    expect(countCalls[0].binds).toEqual(expect.arrayContaining(['acc-1']));
  });

  test('lineAccountId が無くても可視範囲をDB側で絞ってページ化する', async () => {
    const { db, calls } = makeScenarioDb([
      { id: 's-x', name: 'x', line_account_id: 'acc-1', ...rowBase },
      { id: 's-hidden', name: 'hidden', line_account_id: 'acc-2', ...rowBase },
    ]);

    const res = await setupApp(db).request('/api/scenarios');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { items: { id: string }[] } };
    expect(body.data.items.map((d) => d.id)).toEqual(['s-x']);
    const listCall = calls.find((call) => /SELECT s\.\*, COUNT\(ss\.id\)/i.test(call.sql));
    expect(listCall?.sql).toMatch(/s\.line_account_id IN/);
    expect(listCall?.binds).toEqual(['acc-1', 50, 0]);
  });

  test('returns empty array when filter matches nothing and no globals exist', async () => {
    const rows: ScenarioRow[] = [
      { id: 's-other', name: 'other', line_account_id: 'acc-other', ...rowBase },
    ];
    const { db } = makeScenarioDb(rows);

    const res = await setupApp(db).request('/api/scenarios?lineAccountId=acc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { items: unknown[]; total: number } };
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  test('担当外アカウントの一覧は存在を隠す', async () => {
    const { db } = makeScenarioDb([]);
    const res = await setupApp(db).request('/api/scenarios?lineAccountId=acc-other');
    expect(res.status).toBe(404);
  });

  test('アカウント限定担当には全店共通シナリオを返さない', async () => {
    accountAccessMocks.getVisibleLineAccountScope.mockResolvedValue({
      allowedAccountIds: ['acc-1'], canSeeUnassigned: false,
    });
    const { db } = makeScenarioDb([
      { id: 's-global', name: 'global', line_account_id: null, ...rowBase },
      { id: 's-acc1', name: 'acc1', line_account_id: 'acc-1', ...rowBase },
    ]);
    const res = await setupApp(db).request('/api/scenarios?lineAccountId=acc-1');
    const body = await res.json() as { data: { items: Array<{ id: string }> } };
    expect(body.data.items.map((item) => item.id)).toEqual(['s-acc1']);
  });

  test('limit は200へ丸め、page から offset を計算する', async () => {
    const { db, calls } = makeScenarioDb([
      { id: 's-1', name: 'one', line_account_id: 'acc-1', ...rowBase },
    ]);
    const res = await setupApp(db).request('/api/scenarios?lineAccountId=acc-1&limit=999&page=3');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { limit: number; sort: unknown[] } };
    expect(body.data.limit).toBe(200);
    expect(body.data.sort).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'desc' },
    ]);
    const listCall = calls.find((call) => /SELECT s\.\*, COUNT\(ss\.id\)/i.test(call.sql));
    expect(listCall?.binds).toEqual(['acc-1', 200, 400]);
  });

  test('検索と状態とフォルダをページ分割より先にDBで絞る', async () => {
    const { db, calls } = makeScenarioDb([
      { id: 's-1', name: '夏のお知らせ', line_account_id: 'acc-1', ...rowBase },
    ]);
    const res = await setupApp(db).request(
      '/api/scenarios?lineAccountId=acc-1&query=%E5%A4%8F&active=0&createdFrom=2026-09-01&folderId=folder-1',
    );
    expect(res.status).toBe(200);
    const listCall = calls.find((call) => /SELECT s\.\*, COUNT\(ss\.id\)/i.test(call.sql));
    expect(listCall?.sql).toMatch(/s\.name LIKE \? ESCAPE/);
    expect(listCall?.sql).toMatch(/s\.is_active = 0/);
    expect(listCall?.sql).toMatch(/s\.created_at >= \?/);
    expect(listCall?.sql).toMatch(/s\.folder_id = \?/);
    expect(listCall?.binds).toEqual(['acc-1', '%夏%', '2026-09-01', 'folder-1', 50, 0]);
  });

  test('閲覧権限がない利用者には一覧を返さない', async () => {
    const { db } = makeScenarioDb([]);
    const res = await setupApp(db, [], 'staff').request('/api/scenarios');
    expect(res.status).toBe(403);
    expect(dbMocks.getScenarioById).not.toHaveBeenCalled();
  });
});

describe('POST /api/scenarios/:id/test-send', () => {
  function testSendDb() {
    let stepReads = 0;
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() {
            return statement;
          },
          async first() {
            if (/SELECT id, line_account_id FROM scenarios/i.test(sql)) {
              return { id: 'scenario-1', line_account_id: 'account-1' };
            }
            return null;
          },
          async all() {
            stepReads += 1;
            return { results: [] };
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    return { db, stepReads: () => stepReads };
  }

  test('別LINEアカウントの友だちには送信処理を始めない', async () => {
    dbMocks.getScenarioById.mockResolvedValue({ id: 'scenario-1', line_account_id: 'account-1' });
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-2', line_account_id: 'account-2' });
    const { db, stepReads } = testSendDb();

    const response = await setupApp(db).request('/api/scenarios/scenario-1/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: 'friend-2' }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ success: false });
    expect(stepReads()).toBe(0);
  });

  test('担当者から見えない友だちは存在を隠して送信処理を始めない', async () => {
    dbMocks.getScenarioById.mockResolvedValue({ id: 'scenario-1', line_account_id: 'account-1' });
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-hidden', line_account_id: 'account-1' });
    accountAccessMocks.canAccessAllLineAccounts
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { db, stepReads } = testSendDb();

    const response = await setupApp(db).request('/api/scenarios/scenario-1/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: 'friend-hidden' }),
    });

    expect(response.status).toBe(404);
    expect(stepReads()).toBe(0);
  });
});

describe('シナリオ通の本文契約', () => {
  const visibleScenario = {
    id: 'scenario-1',
    line_account_id: 'account-1',
  };

  test('5,001文字の本文は作成前に止める', async () => {
    dbMocks.getScenarioById.mockResolvedValue(visibleScenario);
    const response = await setupApp({} as D1Database).request('/api/scenarios/scenario-1/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stepOrder: 1,
        delayMinutes: 0,
        messageType: 'text',
        messageContent: 'あ'.repeat(5_001),
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'TEMPLATE_TEXT_TOO_LONG',
      actualCharacters: 5_001,
    });
    expect(dbMocks.createScenarioStep).not.toHaveBeenCalled();
  });

  test('5,001文字の本文は更新前にも止める', async () => {
    dbMocks.getScenarioById.mockResolvedValue(visibleScenario);
    const response = await setupApp({} as D1Database).request(
      '/api/scenarios/scenario-1/steps/step-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageType: 'text',
          messageContent: 'あ'.repeat(5_001),
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'TEMPLATE_TEXT_TOO_LONG',
      actualCharacters: 5_001,
    });
    expect(dbMocks.updateScenarioStep).not.toHaveBeenCalled();
  });

  test('質問は空のテキスト本文を要求せず保存できる', async () => {
    dbMocks.getScenarioById.mockResolvedValue(visibleScenario);
    const db = {
      prepare(sql: string) {
        const statement = {
          bind() {
            return statement;
          },
          async first() {
            if (/SELECT delivery_mode FROM scenarios/i.test(sql)) {
              return { delivery_mode: 'relative' };
            }
            if (/SELECT id FROM scenario_steps/i.test(sql)) return null;
            return null;
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    dbMocks.createScenarioStep.mockResolvedValue({
      id: 'step-1',
      scenario_id: 'scenario-1',
      step_order: 1,
      delay_minutes: 0,
      offset_days: null,
      offset_minutes: null,
      delivery_time: null,
      message_type: 'text',
      message_content: '',
      condition_type: null,
      condition_value: null,
      next_step_on_false: null,
      template_id: null,
      on_reach_tag_id: null,
      after_send: 'continue',
      target_condition_json: null,
      question_json: JSON.stringify({
        text: '体調はいかがですか？',
        tapMode: 'single',
        choices: [{ label: 'よい', behavior: 'none' }],
      }),
      is_draft: 0,
      created_at: '2026-09-02T00:00:00.000',
    });

    const response = await setupApp(db).request('/api/scenarios/scenario-1/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stepOrder: 1,
        delayMinutes: 0,
        messageType: 'text',
        messageContent: '',
        question: {
          text: '体調はいかがですか？',
          tapMode: 'single',
          choices: [{ label: 'よい', behavior: 'none' }],
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(dbMocks.createScenarioStep).toHaveBeenCalledTimes(1);
  });
});
