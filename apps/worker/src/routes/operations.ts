import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  OPERATION_CAPABILITIES,
  getOperationControlSet,
  getOperationIncident,
  listOperationIncidents,
  restoreOperationIncident,
  stopOperationCapabilities,
  type OperationCapability,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

const operations = new Hono<Env>();

function requestedAccountId(value: string | undefined): string | null {
  return !value || value === 'all' ? null : value;
}

async function canUseScope(c: Context<Env>, accountId: string | null) {
  if (accountId === null) return c.get('staff')?.role === 'owner';
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);
}

function parseCapabilities(raw: unknown): OperationCapability[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const values = raw.filter((value): value is OperationCapability =>
    typeof value === 'string' && OPERATION_CAPABILITIES.includes(value as OperationCapability));
  if (values.length !== raw.length || new Set(values).size !== values.length) return null;
  return values;
}

async function countActive(
  db: D1Database,
  table: 'broadcasts' | 'scenarios' | 'reminders' | 'automations',
  activeSql: string,
  accountId: string | null,
): Promise<number> {
  const accountClause = accountId ? ' AND line_account_id = ?' : '';
  const statement = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${activeSql}${accountClause}`);
  const row = accountId
    ? await statement.bind(accountId).first<{ count: number }>()
    : await statement.first<{ count: number }>();
  return Number(row?.count ?? 0);
}

operations.get('/api/operations/control', async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  // 全体停止は全員が見えないと、別端末で通常運用と誤認する。
  // アカウント別状態だけ所属範囲を検査する。
  if (accountId !== null && !await canUseScope(c, accountId)) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  return c.json({ success: true, data: await getOperationControlSet(c.env.DB, accountId) });
});

operations.get('/api/operations/control/preview', async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  if (!await canUseScope(c, accountId)) return c.json({ success: false, error: 'Forbidden' }, 403);
  const [control, broadcasts, scenarios, reminders, automations] = await Promise.all([
    getOperationControlSet(c.env.DB, accountId),
    countActive(c.env.DB, 'broadcasts', "status IN ('scheduled', 'sending')", accountId),
    countActive(c.env.DB, 'scenarios', 'is_active = 1', accountId),
    countActive(c.env.DB, 'reminders', 'is_active = 1', accountId),
    countActive(c.env.DB, 'automations', 'is_active = 1', accountId),
  ]);
  return c.json({
    success: true,
    data: {
      control,
      counts: {
        broadcast_dispatch: broadcasts,
        scenario_dispatch: scenarios,
        reminder_dispatch: reminders,
        automation_actions: automations,
      },
      calculatedAt: new Date().toISOString(),
    },
  });
});

operations.get('/api/operations/history', async (c) => {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const incidents = await listOperationIncidents(c.env.DB, {
    accountIds: scope.allowedAccountIds,
    includeGlobal: c.get('staff')?.role === 'owner',
    limit: Number(c.req.query('limit') ?? 100),
  });
  return c.json({ success: true, data: incidents });
});

operations.post(
  '/api/operations/incidents',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('operation-stop'),
  async (c) => {
    const body = await c.req.json<{
      lineAccountId?: string | null;
      capabilities?: unknown;
      reason?: unknown;
      detail?: unknown;
      expectedVersion?: unknown;
      confirmation?: unknown;
    }>();
    const accountId = body.lineAccountId ?? null;
    if (!await canUseScope(c, accountId)) return c.json({ success: false, error: 'Forbidden' }, 403);
    const capabilities = parseCapabilities(body.capabilities);
    if (!capabilities) return c.json({ success: false, error: '停止対象を1つ以上正しく指定してください' }, 400);
    if (body.confirmation !== '停止') return c.json({ success: false, error: '確認のため「停止」と入力してください' }, 400);
    if (typeof body.reason !== 'string' || body.reason.trim().length === 0 || body.reason.length > 200) {
      return c.json({ success: false, error: '停止理由を200文字以内で入力してください' }, 400);
    }
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      return c.json({ success: false, error: 'expectedVersion は0以上の整数で指定してください' }, 400);
    }
    const result = await stopOperationCapabilities(c.env.DB, {
      lineAccountId: accountId,
      capabilities,
      expectedVersion: Number(body.expectedVersion),
      actorId: c.get('staff')!.id,
      reason: body.reason.trim(),
      detail: typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim().slice(0, 1000) : null,
    });
    if (result.status === 'conflict') {
      return c.json({ success: false, error: '別の管理者が先に変更しました。最新の状態を読み直してください。', data: result.control }, 409);
    }
    return c.json({ success: true, data: result }, 201);
  },
);

operations.post(
  '/api/operations/incidents/:id/restore',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('operation-restore'),
  async (c) => {
    const incident = await getOperationIncident(c.env.DB, c.req.param('id'));
    if (!incident) return c.json({ success: false, error: '停止記録が見つかりません' }, 404);
    if (!await canUseScope(c, incident.lineAccountId)) return c.json({ success: false, error: 'Forbidden' }, 403);
    const body = await c.req.json<{ expectedVersion?: unknown; confirmation?: unknown }>();
    if (body.confirmation !== '復旧') return c.json({ success: false, error: '確認のため「復旧」と入力してください' }, 400);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      return c.json({ success: false, error: 'expectedVersion は1以上の整数で指定してください' }, 400);
    }
    const result = await restoreOperationIncident(c.env.DB, {
      incidentId: incident.id,
      expectedVersion: Number(body.expectedVersion),
      actorId: c.get('staff')!.id,
    });
    if (result.status === 'not_found') return c.json({ success: false, error: '復旧できる停止記録ではありません' }, 409);
    if (result.status === 'conflict') {
      return c.json({ success: false, error: '別の管理者が先に変更しました。最新の状態を読み直してください。', data: result.control }, 409);
    }
    return c.json({ success: true, data: result });
  },
);

export { operations };
