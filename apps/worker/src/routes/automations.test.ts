import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthenticatedStaff } from '../middleware/auth.js';

// We assert on the SQL/binds the route forwards to D1. The DB-helper path
// (no lineAccountId query) is mocked separately on @line-crm/db.
const dbMocks = {
  getAutomations: vi.fn(),
  getAutomationById: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  getAutomationLogs: vi.fn(),
  getAutomationExecutionRuns: vi.fn(),
  getLineAccounts: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { automations } = await import('./automations.js');

interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  conditions: string;
  actions: string;
  is_active: number;
  priority: number;
  created_at: string;
  updated_at: string;
  line_account_id: string | null;
}

function makeAutomationDb(rows: AutomationRow[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all() {
          calls.push({ sql, binds: bound });
          // NULL-aware filter: row matches when its line_account_id is NULL
          // (global) OR equals the bound lineAccountId.
          if (/FROM automations\b/i.test(sql) && /line_account_id IS NULL/i.test(sql)) {
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
  const app = new Hono<{
    Bindings: { DB: D1Database };
    Variables: { staff: AuthenticatedStaff };
  }>();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('staff', {
      id: 'staff-1',
      name: 'Staff',
      role: 'admin',
      readOnly: false,
      permissionKeys: [],
      assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
      tenantId: '00000000-0000-4000-8000-000000000001',
    });
    await next();
  });
  app.route('/', automations);
  return app;
}

const rowBase = {
  description: null,
  event_type: 'message_received',
  conditions: '{}',
  actions: '[]',
  is_active: 1,
  priority: 0,
  created_at: '2026-05-20T00:00:00.000',
  updated_at: '2026-05-20T00:00:00.000',
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.getLineAccounts.mockResolvedValue([
    { id: 'acc-1', name: '本店', tenant_id: '00000000-0000-4000-8000-000000000001' },
    { id: 'acc-2', name: '二号店', tenant_id: '00000000-0000-4000-8000-000000000001' },
  ]);
  dbMocks.getStaffById.mockResolvedValue(null);
  dbMocks.getStaffAccountScopeIds.mockResolvedValue([]);
});

describe('GET /api/automation-runs', () => {
  test('既存の機能固有状態を共通6状態へ読み替え、未取得値を作らない', async () => {
    dbMocks.getAutomationExecutionRuns.mockResolvedValue({
      rows: [
        {
          id: 'run-1', line_account_id: 'acc-1', account_name: '本店',
          automation_id: 'automation-1', automation_name: '予約案内', automation_version_id: 'version-1',
          friend_id: 'friend-1', friend_name: '田中さん', source_event_id: 'event-1',
          trigger_type: 'message_received', status: 'partial',
          started_at: '2026-08-28T01:00:00.000Z', completed_at: '2026-08-28T01:00:01.200Z',
          created_at: '2026-08-28T01:00:00.000Z', duration_ms: 1200,
          successful_actions: 'send_message', skipped_actions: null,
          failed_action: 'send_webhook', failure_code: 'webhook_timeout',
        },
        {
          id: 'run-2', line_account_id: 'acc-1', account_name: '本店',
          automation_id: 'automation-1', automation_name: '予約案内', automation_version_id: 'version-1',
          friend_id: null, friend_name: null, source_event_id: 'event-2',
          trigger_type: 'message_received', status: 'skipped_condition',
          started_at: null, completed_at: null, created_at: '2026-08-28T00:00:00.000Z', duration_ms: null,
          successful_actions: null, skipped_actions: null, failed_action: null, failure_code: null,
        },
      ],
      total: 2,
      summary: { total: 2, executed: 1, skipped: 1, failed: 0, most_run_name: '予約案内', most_run_count: 1 },
    });

    const res = await setupApp({} as D1Database).request('/api/automation-runs?lineAccountId=acc-1&status=executed&limit=20&offset=0');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: Array<Record<string, unknown>> } };
    expect(body.data.items[0]).toMatchObject({
      ownerKind: 'automation', status: 'permanent_failed', subject: '田中さん', accountLabel: '本店',
      triggerLabel: 'メッセージが届いたとき', detail: 'メッセージを送信。外部連携先が応答しませんでした',
      durationMs: 1200, canRetry: false,
    });
    expect(body.data.items[1]).toMatchObject({
      status: 'skipped', subject: null, detail: '条件に合わなかったため、何もしていません', durationMs: null,
    });
    expect(dbMocks.getAutomationExecutionRuns).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      allowedAccountIds: ['acc-1'],
      status: ['success', 'partial', 'failed'],
      limit: 20,
      offset: 0,
    }));
  });

  test('閲覧できないLINEアカウントは空表示にせず403で止める', async () => {
    const res = await setupApp({} as D1Database).request('/api/automation-runs?lineAccountId=outside');
    expect(res.status).toBe(403);
    expect(dbMocks.getAutomationExecutionRuns).not.toHaveBeenCalled();
  });

  test('見送った処理だけの部分成功に、存在しない失敗理由を作らない', async () => {
    dbMocks.getAutomationExecutionRuns.mockResolvedValue({
      rows: [{
        id: 'run-partial', line_account_id: 'acc-1', account_name: '本店',
        automation_id: 'automation-1', automation_name: '予約案内', automation_version_id: 'version-1',
        friend_id: 'friend-1', friend_name: '田中さん', source_event_id: 'event-1',
        trigger_type: 'message_received', status: 'partial',
        started_at: '2026-08-28T01:00:00.000Z', completed_at: '2026-08-28T01:00:01.000Z',
        created_at: '2026-08-28T01:00:00.000Z', duration_ms: 1000,
        successful_actions: 'send_message', skipped_actions: 'add_tag',
        failed_action: null, failure_code: null,
      }],
      total: 1,
      summary: { total: 1, executed: 1, skipped: 0, failed: 1, most_run_name: '予約案内', most_run_count: 1 },
    });

    const res = await setupApp({} as D1Database).request('/api/automation-runs?lineAccountId=acc-1');
    const body = await res.json() as { data: { items: Array<Record<string, unknown>> } };
    expect(body.data.items[0]).toMatchObject({
      status: 'permanent_failed',
      detail: 'メッセージを送信。タグを追加は見送り',
      failureReason: null,
    });
  });
});

describe('GET /api/automations?lineAccountId=X', () => {
  test('includes both account-bound and global (NULL) automations', async () => {
    const rows: AutomationRow[] = [
      { id: 'a-global', name: 'global', line_account_id: null, ...rowBase },
      { id: 'a-acc1', name: 'acc1', line_account_id: 'acc-1', ...rowBase },
      { id: 'a-acc2', name: 'acc2', line_account_id: 'acc-2', ...rowBase },
    ];
    const { db, calls } = makeAutomationDb(rows);

    const res = await setupApp(db).request('/api/automations?lineAccountId=acc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; lineAccountId: string | null }[];
    };
    expect(body.success).toBe(true);
    const ids = body.data.map((d) => d.id).sort();
    // The engine (event-bus.ts:149) fires automations whose line_account_id
    // is NULL OR equal to the active account. The list endpoint must mirror
    // that scope, otherwise globals + freshly-created records disappear in
    // the UI even though they will still execute.
    expect(ids).toEqual(['a-acc1', 'a-global']);
    // Scope must be surfaced so callers can tell globals from account-bound
    // rows — otherwise the UI cannot safely offer per-account edit/disable.
    const byId = new Map(body.data.map((d) => [d.id, d.lineAccountId] as const));
    expect(byId.get('a-global')).toBeNull();
    expect(byId.get('a-acc1')).toBe('acc-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/line_account_id IS NULL/);
    expect(calls[0].sql).toMatch(/line_account_id = \?/);
    expect(calls[0].binds).toEqual(['acc-1']);
  });

  test('falls back to getAutomations helper when no lineAccountId is provided', async () => {
    dbMocks.getAutomations.mockResolvedValue([
      { id: 'a-x', name: 'x', line_account_id: null, ...rowBase },
    ]);
    const { db } = makeAutomationDb([]);

    const res = await setupApp(db).request('/api/automations');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { id: string }[] };
    expect(body.data.map((d) => d.id)).toEqual(['a-x']);
    expect(dbMocks.getAutomations).toHaveBeenCalledTimes(1);
  });

  test('returns empty array when filter matches nothing and no globals exist', async () => {
    const rows: AutomationRow[] = [
      { id: 'a-other', name: 'other', line_account_id: 'acc-other', ...rowBase },
    ];
    const { db } = makeAutomationDb(rows);

    const res = await setupApp(db).request('/api/automations?lineAccountId=acc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe('GET /api/automations/:id/logs', () => {
  test.each([
    ['999999', 200],
    ['-1', 100],
    ['NaN', 100],
  ])('limit=%s を最大200件以内へ直す', async (raw, expected) => {
    dbMocks.getAutomationById.mockResolvedValue({ id: 'automation-1', line_account_id: null });
    dbMocks.getAutomationLogs.mockResolvedValue([]);
    const res = await setupApp({} as D1Database).request(`/api/automations/automation-1/logs?limit=${raw}`);
    expect(res.status).toBe(200);
    expect(dbMocks.getAutomationLogs).toHaveBeenCalledWith(
      expect.anything(),
      'automation-1',
      expected,
    );
  });
});
