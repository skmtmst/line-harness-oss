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
  getLineAccountScopeEntries: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { automations } = await import('./automations.js');

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

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.getLineAccountScopeEntries.mockImplementation(async (...args: unknown[]) =>
    dbMocks.getLineAccounts(...args));
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
      durationMs: 1200, canRetry: true,
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
