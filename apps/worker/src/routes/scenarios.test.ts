import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const accountAccessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
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
          if (/FROM scenarios s\b/i.test(sql) && /line_account_id IS NULL/i.test(sql)) {
            const [lineAccountId] = bound as [string];
            const filtered = rows.filter(
              (r) => r.line_account_id == null || r.line_account_id === lineAccountId,
            );
            return { results: filtered };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function setupApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', {
      id: 'owner-1',
      name: '管理者',
      role: 'owner',
      readOnly: false,
      tenantId: 'tenant-1',
      permissionKeys: ['/scenarios'],
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
    const body = (await res.json()) as { success: boolean; data: { id: string; lineAccountId: string | null }[] };
    expect(body.success).toBe(true);
    // webhook.ts:211 / liff.ts:878 trigger scenarios where line_account_id is
    // NULL (global) OR matches the active account. The list endpoint must
    // mirror that so the UI does not hide records the engine will fire.
    const ids = body.data.map((d) => d.id).sort();
    expect(ids).toEqual(['s-acc1', 's-global']);
    // Serializer surfaces the binding so the UI can distinguish 全アカ共通 from
    // an account-specific scenario.
    const globalRow = body.data.find((d) => d.id === 's-global');
    expect(globalRow?.lineAccountId).toBeNull();
    // 一覧を引くクエリは1本だけ。人数の集計は別に1本走るので、
    // 本数ではなく「一覧を引くもの」を選んで見る。
    const listCalls = calls.filter((c) => /FROM scenarios s\b/i.test(c.sql));
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].sql).toMatch(/line_account_id IS NULL/);
    expect(listCalls[0].sql).toMatch(/s\.line_account_id = \?/);
    expect(listCalls[0].binds).toEqual(['acc-1']);

    // 購読中と読了済は、シナリオごとに引かず1回でまとめて数える。
    // 件数ぶん往復すると、シナリオが増えるほど一覧が遅くなる。
    const countCalls = calls.filter((c) => /FROM friend_scenarios/i.test(c.sql));
    expect(countCalls).toHaveLength(1);
  });

  test('falls back to getScenarios helper when no lineAccountId is provided', async () => {
    dbMocks.getScenarios.mockResolvedValue([
      { id: 's-x', name: 'x', line_account_id: null, ...rowBase },
    ]);
    const { db } = makeScenarioDb([]);

    const res = await setupApp(db).request('/api/scenarios');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { id: string }[] };
    expect(body.data.map((d) => d.id)).toEqual(['s-x']);
    expect(dbMocks.getScenarios).toHaveBeenCalledTimes(1);
  });

  test('returns empty array when filter matches nothing and no globals exist', async () => {
    const rows: ScenarioRow[] = [
      { id: 's-other', name: 'other', line_account_id: 'acc-other', ...rowBase },
    ];
    const { db } = makeScenarioDb(rows);

    const res = await setupApp(db).request('/api/scenarios?lineAccountId=acc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.data).toEqual([]);
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
