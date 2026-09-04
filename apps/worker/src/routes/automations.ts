import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getAutomations,
  getAutomationById,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  getAutomationLogs,
  getAutomationExecutionRuns,
  type AutomationRunDomainStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import {
  AutomationDraftError,
  createAutomationDraftFromTemplate,
  getAutomationDraft,
  listAutomationDraftResources,
  listAutomationTemplates,
  updateAutomationDraft,
} from '../services/automation-drafts.js';
import { listLimit } from './list-pagination.js';

const automations = new Hono<Env>();

async function requireAutomationPermission(c: Context<Env>, next: () => Promise<void>) {
  const staff = c.get('staff');
  if (!staff || (staff.role === 'staff' && !staff.permissionKeys?.includes('/automations'))) {
    return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
  }
  await next();
}

async function requireDraftAccount(c: Context<Env>): Promise<string | Response> {
  const id = c.req.query('account_id')?.trim();
  if (!id) return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.allowedAccountIds.includes(id)) {
    return c.json({ success: false, error: '対象のLINE公式アカウントが見つかりません' }, 404);
  }
  return id;
}

function draftErrorResponse(c: Context<Env>, error: AutomationDraftError): Response {
  const status = error.code === 'version_conflict' ? 409
    : new Set(['not_found', 'template_not_found']).has(error.code) ? 404
      : 422;
  return c.json({
    success: false,
    error: error.message,
    code: error.code,
    ...(error.field ? { field: error.field } : {}),
  }, status);
}

async function draftEndpoint<T>(
  c: Context<Env>,
  run: () => Promise<T> | T,
  successStatus = 200,
): Promise<Response> {
  try {
    return c.json({ success: true, data: await run() }, successStatus as 200);
  } catch (error) {
    if (error instanceof AutomationDraftError) return draftErrorResponse(c, error);
    console.error(JSON.stringify({
      event: 'automation_draft_api_failed',
      path: c.req.path,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ success: false, error: 'オートメーションの下書きを処理できませんでした' }, 500);
  }
}

type ExecutionRunStatus =
  | 'queued'
  | 'claimed'
  | 'succeeded'
  | 'skipped'
  | 'retry_wait'
  | 'permanent_failed'
  | 'cancelled';

interface AutomationExecutionRun {
  id: string;
  ownerKind: 'automation';
  ownerId: string;
  lineAccountId: string;
  occurredAt: string;
  subject: string | null;
  accountLabel: string | null;
  triggerLabel: string;
  reference: null;
  status: ExecutionRunStatus;
  detail: string | null;
  durationMs: number | null;
  canRetry: false;
  automationId: string;
  automationName: string;
  automationVersionId: string;
  friendId: string | null;
  friendName: string | null;
  sourceEventId: string;
  domainStatus: AutomationRunDomainStatus;
  startedAt: string | null;
  completedAt: string | null;
  successfulActions: string[];
  skippedActions: string[];
  failedAction: string | null;
  failureReason: string | null;
}

interface AutomationExecutionRunsResponse {
  summary: {
    total: number;
    executed: number;
    skipped: number;
    failed: number;
    mostRunName: string | null;
    mostRunCount: number | null;
  };
  items: AutomationExecutionRun[];
  pagination: { total: number; limit: number; offset: number };
}

const COMMON_STATUS_TO_DOMAIN: Record<ExecutionRunStatus, AutomationRunDomainStatus[]> = {
  queued: ['queued'],
  claimed: ['running'],
  succeeded: ['success'],
  skipped: ['skipped_condition'],
  retry_wait: ['waiting'],
  permanent_failed: ['partial', 'failed'],
  cancelled: ['cancelled'],
};

const DOMAIN_STATUS_TO_COMMON: Record<AutomationRunDomainStatus, ExecutionRunStatus> = {
  queued: 'queued',
  running: 'claimed',
  waiting: 'retry_wait',
  success: 'succeeded',
  partial: 'permanent_failed',
  failed: 'permanent_failed',
  cancelled: 'cancelled',
  skipped_condition: 'skipped',
};

const TRIGGER_LABELS: Record<string, string> = {
  friend_add: '友だちが追加されたとき',
  message_received: 'メッセージが届いたとき',
  tag_change: 'タグが変わったとき',
  score_threshold: '行動スコアが条件に達したとき',
  cv_fire: '成果が記録されたとき',
  postback_received: 'メニューが押されたとき',
  calendar_booked: '予約が確定したとき',
  'ec.order.confirmed': '注文が確定したとき',
  'ec.order.shipped': '発送が完了したとき',
  'ec.subscription.upcoming': '定期便の予定が近づいたとき',
  'ec.subscription.payment_failed': '定期便の決済に失敗したとき',
  'ec.subscription.cancelled': '定期便が解約されたとき',
};

const ACTION_LABELS: Record<string, string> = {
  add_tag: 'タグを追加',
  remove_tag: 'タグを外す',
  start_scenario: 'シナリオを開始',
  send_message: 'メッセージを送信',
  send_webhook: '外部連携へ送信',
  switch_rich_menu: 'メニューを切り替え',
  update_support_mark: '対応マークを変更',
  add_mileage: 'マイルを追加',
  common_action: '共通アクションを実行',
  wait: '指定時間まで待機',
};

function actionLabels(value: string | null): string[] {
  if (!value) return [];
  return value.split(' / ').filter(Boolean).map((item) => ACTION_LABELS[item] ?? '登録した処理');
}

function safeFailureReason(code: string | null, failedAction: string | null): string {
  if (code === 'line_api_error') return 'LINEへの送信を完了できませんでした';
  if (code?.startsWith('webhook_')) return '外部連携先が応答しませんでした';
  if (code === 'common_action_version_missing') return '使う共通アクションの版を確認してください';
  return `${failedAction ?? '登録した処理'}を完了できませんでした`;
}

function defaultWindow() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function boundedInteger(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

async function requireVisibleAutomation(c: Context<Env>, next: () => Promise<void>) {
  const item = await getAutomationById(c.env.DB, c.req.param('id')!);
  if (!item || !await canAccessAllLineAccounts(
    c.env.DB,
    c.get('staff'),
    [item.line_account_id ?? null],
  )) {
    return c.json({ success: false, error: 'Automation not found' }, 404);
  }
  await next();
}

// ========== 自動化ルールCRUD ==========

/** 実行まで接続済みの処理だけを含む、サーバー管理の見本。 */
automations.get(
  '/api/automation-templates',
  requireAutomationPermission,
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = await requireDraftAccount(c);
    if (typeof accountId !== 'string') return accountId;
    return draftEndpoint(c, () => listAutomationTemplates());
  },
);

automations.get(
  '/api/automation-draft-resources',
  requireAutomationPermission,
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = await requireDraftAccount(c);
    if (typeof accountId !== 'string') return accountId;
    return draftEndpoint(c, () => listAutomationDraftResources(c.env.DB, accountId));
  },
);

automations.post(
  '/api/automation-templates/:key/drafts',
  requireAutomationPermission,
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = await requireDraftAccount(c);
    if (typeof accountId !== 'string') return accountId;
    return draftEndpoint(c, () => createAutomationDraftFromTemplate(c.env.DB, {
      templateKey: c.req.param('key'),
      lineAccountId: accountId,
      createdBy: c.get('staff')?.id,
    }), 201);
  },
);

automations.get(
  '/api/automation-drafts/:id',
  requireAutomationPermission,
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = await requireDraftAccount(c);
    if (typeof accountId !== 'string') return accountId;
    return draftEndpoint(c, () => getAutomationDraft(c.env.DB, {
      id: c.req.param('id'),
      lineAccountId: accountId,
    }));
  },
);

automations.put(
  '/api/automation-drafts/:id',
  requireAutomationPermission,
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = await requireDraftAccount(c);
    if (typeof accountId !== 'string') return accountId;
    type DraftBody = {
      expectedDraftVersionId?: unknown;
      name?: unknown;
      eventType?: unknown;
      triggerConfig?: unknown;
      actions?: unknown;
    };
    const body = await c.req.json<DraftBody>().catch((): DraftBody => ({}));
    return draftEndpoint(c, async () => {
      await updateAutomationDraft(c.env.DB, {
        id: c.req.param('id'),
        lineAccountId: accountId,
        expectedDraftVersionId: body.expectedDraftVersionId,
        name: body.name,
        eventType: body.eventType,
        triggerConfig: body.triggerConfig,
        actions: body.actions,
      });
      return { updated: true };
    });
  },
);

automations.get('/api/automations', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items;
    if (lineAccountId) {
      // NULL line_account_id = global automation (event-bus.ts:149 fires it for every account).
      // Include both account-bound and global rows so the UI mirrors the engine's match semantic.
      const result = await c.env.DB
        .prepare(`SELECT * FROM automations WHERE line_account_id IS NULL OR line_account_id = ? ORDER BY priority DESC, created_at DESC`)
        .bind(lineAccountId)
        .all();
      items = result.results as unknown as Awaited<ReturnType<typeof getAutomations>>;
    } else {
      items = await getAutomations(c.env.DB);
    }
    return c.json({
      success: true,
      data: items.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        eventType: a.event_type,
        conditions: JSON.parse(a.conditions),
        actions: JSON.parse(a.actions),
        isActive: Boolean(a.is_active),
        priority: a.priority,
        // null line_account_id = global automation. Surfacing this lets callers
        // distinguish globals from account-bound rows in the mixed result and
        // avoid unintentionally editing a rule that affects every account.
        lineAccountId: a.line_account_id ?? null,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/automations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** V6 25-1-B: 既存automation_runsを、共通実行記録契約で読む。 */
automations.get('/api/automation-runs', async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const requestedAccountId = (
      c.req.query('line_account_id') ?? c.req.query('lineAccountId')
    )?.trim();
    if (requestedAccountId && !scope.allowedAccountIds.includes(requestedAccountId)) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const allowedAccountIds = requestedAccountId ? [requestedAccountId] : scope.allowedAccountIds;
    const rawStatus = c.req.query('status') as ExecutionRunStatus | 'executed' | 'problems' | undefined;
    const status = rawStatus === 'executed'
      ? ['success', 'partial', 'failed'] as AutomationRunDomainStatus[]
      : rawStatus === 'problems'
        ? ['partial', 'failed'] as AutomationRunDomainStatus[]
        : rawStatus && COMMON_STATUS_TO_DOMAIN[rawStatus]
          ? COMMON_STATUS_TO_DOMAIN[rawStatus]
          : undefined;
    const limit = Math.max(1, boundedInteger(c.req.query('limit'), 20, 100));
    const offset = boundedInteger(c.req.query('offset'), 0, 1_000_000);
    const defaults = defaultWindow();
    const from = c.req.query('from') || defaults.from;
    const to = c.req.query('to') || defaults.to;

    const result = await getAutomationExecutionRuns(c.env.DB, {
      allowedAccountIds,
      from,
      to,
      status,
      search: c.req.query('search'),
      limit,
      offset,
    });

    const items: AutomationExecutionRun[] = result.rows.map((row) => {
      const successfulActions = actionLabels(row.successful_actions);
      const skippedActions = actionLabels(row.skipped_actions);
      const failedAction = row.failed_action ? (ACTION_LABELS[row.failed_action] ?? '登録した処理') : null;
      const failureReason = safeFailureReason(row.failure_code, failedAction);
      const statusLabel = DOMAIN_STATUS_TO_COMMON[row.status];
      const detail = row.status === 'skipped_condition'
        ? '条件に合わなかったため、何もしていません'
        : row.status === 'failed'
          ? failureReason
          : row.status === 'partial'
            ? [successfulActions.join('／'), skippedActions.length ? `${skippedActions.join('／')}は見送り` : null, failedAction ? failureReason : null].filter(Boolean).join('。') || null
            : successfulActions.join('／') || null;
      return {
        id: row.id,
        ownerKind: 'automation',
        ownerId: row.automation_id,
        lineAccountId: row.line_account_id,
        occurredAt: row.completed_at ?? row.started_at ?? row.created_at,
        subject: row.friend_name,
        accountLabel: row.account_name,
        triggerLabel: TRIGGER_LABELS[row.trigger_type] ?? '登録したきっかけ',
        reference: null,
        status: statusLabel,
        detail,
        durationMs: row.duration_ms,
        // 部分成功した処理を二重実行しない安全な再実行APIが無いため、表示しない。
        canRetry: false,
        automationId: row.automation_id,
        automationName: row.automation_name,
        automationVersionId: row.automation_version_id,
        friendId: row.friend_id,
        friendName: row.friend_name,
        sourceEventId: row.source_event_id,
        domainStatus: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        successfulActions,
        skippedActions,
        failedAction,
        failureReason: row.status === 'failed'
          ? failureReason
          : row.status === 'partial' && (row.failed_action || row.failure_code)
            ? failureReason
            : null,
      };
    });
    const body: AutomationExecutionRunsResponse = {
      summary: {
        total: result.summary.total,
        executed: result.summary.executed,
        skipped: result.summary.skipped,
        failed: result.summary.failed,
        mostRunName: result.summary.most_run_name,
        mostRunCount: result.summary.most_run_count,
      },
      items,
      pagination: { total: result.total, limit, offset },
    };
    return c.json({ success: true, data: body });
  } catch (err) {
    console.error('GET /api/automation-runs error:', err);
    return c.json({ success: false, error: '実行記録を読み込めませんでした' }, 500);
  }
});

automations.use('/api/automations/:id', requireVisibleAutomation);
automations.use('/api/automations/:id/*', requireVisibleAutomation);
automations.get('/api/automations/:id', async (c) => {
  try {
    const item = await getAutomationById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Automation not found' }, 404);

    // ログも取得
    const logs = await getAutomationLogs(c.env.DB, item.id, 50);

    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        description: item.description,
        eventType: item.event_type,
        conditions: JSON.parse(item.conditions),
        actions: JSON.parse(item.actions),
        isActive: Boolean(item.is_active),
        priority: item.priority,
        lineAccountId: item.line_account_id ?? null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        logs: logs.map((l) => ({
          id: l.id,
          friendId: l.friend_id,
          eventData: l.event_data ? JSON.parse(l.event_data) : null,
          actionsResult: l.actions_result ? JSON.parse(l.actions_result) : null,
          status: l.status,
          createdAt: l.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/automations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

automations.post('/api/automations', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      eventType: string;
      conditions?: Record<string, unknown>;
      actions: unknown[];
      priority?: number;
      lineAccountId?: string | null;
    }>();
    if (!body.name || !body.eventType || !body.actions) {
      return c.json({ success: false, error: 'name, eventType, actions are required' }, 400);
    }
    if (body.lineAccountId !== null && body.lineAccountId !== undefined
      && (!body.lineAccountId
        || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId]))) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    let item = await createAutomation(c.env.DB, body);
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE automations SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
      // Re-read so the response reports the persisted scope; the createAutomation
      // helper does not accept line_account_id, so item still has the pre-UPDATE value.
      const refreshed = await getAutomationById(c.env.DB, item.id);
      if (refreshed) item = refreshed;
    }
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        eventType: item.event_type,
        actions: JSON.parse(item.actions),
        isActive: Boolean(item.is_active),
        priority: item.priority,
        lineAccountId: item.line_account_id ?? null,
        createdAt: item.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/automations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

automations.put('/api/automations/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateAutomation(c.env.DB, id, body);
    const updated = await getAutomationById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        eventType: updated.event_type,
        conditions: JSON.parse(updated.conditions),
        actions: JSON.parse(updated.actions),
        isActive: Boolean(updated.is_active),
        priority: updated.priority,
        lineAccountId: updated.line_account_id ?? null,
      },
    });
  } catch (err) {
    console.error('PUT /api/automations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

automations.delete('/api/automations/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteAutomation(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/automations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 自動化ログ ==========

automations.get('/api/automations/:id/logs', async (c) => {
  try {
    const automationId = c.req.param('id');
    const limit = listLimit(c.req.query('limit'), 100);
    const logs = await getAutomationLogs(c.env.DB, automationId, limit);
    return c.json({
      success: true,
      data: logs.map((l) => ({
        id: l.id,
        automationId: l.automation_id,
        friendId: l.friend_id,
        eventData: l.event_data ? JSON.parse(l.event_data) : null,
        actionsResult: l.actions_result ? JSON.parse(l.actions_result) : null,
        status: l.status,
        createdAt: l.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/automations/:id/logs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { automations };
