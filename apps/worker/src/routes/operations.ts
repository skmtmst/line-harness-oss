import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import {
  OPERATION_CAPABILITIES,
  getOperationControlSet,
  getOperationIncident,
  listOperationIncidents,
  recordOperation,
  restoreOperationIncident,
  stopOperationCapabilities,
  type OperationCapability,
} from '@line-crm/db';

import type { Env } from '../index.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { getOperationImpactPreview } from '../services/operation-impact-preview.js';

export const operations = new Hono<Env>();

export const EMERGENCY_CONTROL_PERMISSION = 'operations.control.execute';

function canControlEmergency(c: Context<Env>): boolean {
  const staff = c.get('staff');
  if (staff?.role === 'owner') return true;
  return staff?.role === 'admin'
    && staff.permissionKeys?.includes(EMERGENCY_CONTROL_PERMISSION) === true;
}

async function requireEmergencyControlPermission(c: Context<Env>, next: Next) {
  if (!canControlEmergency(c)) {
    return c.json({
      success: false,
      error: '緊急停止・復旧の専用権限がありません。オーナーに権限付与を依頼してください',
    }, 403);
  }
  await next();
}

function requestedAccountId(value: string | null | undefined): string | null {
  return !value || value === 'all' ? null : value.trim();
}

async function canReadScope(c: Context<Env>, accountId: string | null): Promise<boolean> {
  if (accountId === null) return true;
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);
}

async function canControlScope(c: Context<Env>, accountId: string | null): Promise<boolean> {
  if (accountId === null) return c.get('staff')?.role === 'owner';
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);
}

function parseCapabilities(raw: unknown): OperationCapability[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const capabilities = raw.filter((value): value is OperationCapability =>
    typeof value === 'string' && OPERATION_CAPABILITIES.includes(value as OperationCapability));
  if (capabilities.length !== raw.length || new Set(capabilities).size !== capabilities.length) return null;
  return capabilities;
}

function historyLimit(raw: string | undefined): number {
  const value = Number(raw ?? 100);
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 200) : 100;
}

operations.get('/api/operations/control', requireRole('owner', 'admin'), async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  if (!await canReadScope(c, accountId)) {
    return c.json({ success: false, error: 'この範囲の緊急停止状態を表示する権限がありません' }, 403);
  }
  try {
    return c.json({ success: true, data: await getOperationControlSet(c.env.DB, accountId) });
  } catch (error) {
    console.error('GET /api/operations/control error:', error);
    return c.json({ success: false, error: '緊急停止状態を取得できませんでした' }, 500);
  }
});

operations.get('/api/operations/control/preview', requireRole('owner', 'admin'), async (c) => {
  const accountId = requestedAccountId(c.req.query('account_id'));
  if (accountId === null && c.get('staff')?.role !== 'owner') {
    return c.json({ success: false, error: '全アカウントの影響人数を表示する権限がありません' }, 403);
  }
  if (accountId !== null && !await canReadScope(c, accountId)) {
    return c.json({ success: false, error: 'このアカウントの影響人数を表示する権限がありません' }, 403);
  }
  try {
    const [control, impact] = await Promise.all([
      getOperationControlSet(c.env.DB, accountId),
      getOperationImpactPreview(c.env.DB, accountId),
    ]);
    const counts = {
      broadcast_dispatch: impact.broadcast_dispatch.itemCount,
      scenario_dispatch: impact.scenario_dispatch.itemCount,
      reminder_dispatch: impact.reminder_dispatch.itemCount,
      automation_actions: impact.automation_actions.itemCount,
      auto_reply_dispatch: impact.auto_reply_dispatch.itemCount,
    };
    const calculatedAt = new Date().toISOString();
    await recordOperation(c.env.DB, {
      targetKind: 'emergency_control',
      targetId: accountId ?? '*',
      action: 'previewed',
      actorId: c.get('staff')!.id,
      detail: {
        counts,
        hasUnknownAudience: Object.values(impact).some((metric) => metric.friendCount === null),
        calculatedAt,
      },
    });
    return c.json({
      success: true,
      data: {
        control,
        counts,
        impact,
        permissions: { canControl: canControlEmergency(c) },
        calculatedAt,
      },
    });
  } catch (error) {
    console.error('GET /api/operations/control/preview error:', error);
    return c.json({ success: false, error: '緊急停止の影響人数を取得できませんでした' }, 500);
  }
});

operations.get('/api/operations/history', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const incidents = await listOperationIncidents(c.env.DB, {
      accountIds: scope.allowedAccountIds,
      includeGlobal: c.get('staff')?.role === 'owner',
      limit: historyLimit(c.req.query('limit')),
    });
    return c.json({ success: true, data: incidents });
  } catch (error) {
    console.error('GET /api/operations/history error:', error);
    return c.json({ success: false, error: '緊急操作の履歴を取得できませんでした' }, 500);
  }
});

operations.get('/api/operations/incidents/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const incident = await getOperationIncident(c.env.DB, c.req.param('id'));
    if (!incident) return c.json({ success: false, error: '緊急操作の記録が見つかりません' }, 404);
    if (!await canReadScope(c, incident.lineAccountId)) {
      return c.json({ success: false, error: 'この緊急操作を表示する権限がありません' }, 403);
    }
    return c.json({ success: true, data: incident });
  } catch (error) {
    console.error('GET /api/operations/incidents/:id error:', error);
    return c.json({ success: false, error: '緊急操作の記録を取得できませんでした' }, 500);
  }
});

operations.post(
  '/api/operations/incidents',
  requireRole('owner', 'admin'),
  requireEmergencyControlPermission,
  requireIrreversibleConfirmation('operation-stop'),
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ success: false, error: '入力内容を読み取れませんでした' }, 400);
    }
    if (!Object.hasOwn(body, 'lineAccountId')
      || (body.lineAccountId !== null && typeof body.lineAccountId !== 'string')) {
      return c.json({ success: false, error: '停止する範囲を明示してください' }, 400);
    }
    const accountId = requestedAccountId(
      typeof body.lineAccountId === 'string' ? body.lineAccountId : null,
    );
    if (!await canControlScope(c, accountId)) {
      return c.json({ success: false, error: 'この範囲を緊急停止する権限がありません' }, 403);
    }
    const capabilities = parseCapabilities(body.capabilities);
    if (!capabilities) {
      return c.json({ success: false, error: '停止対象を1つ以上正しく指定してください' }, 400);
    }
    if (body.confirmation !== '停止') {
      return c.json({ success: false, error: '確認のため「停止」と入力してください' }, 400);
    }
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 200) {
      return c.json({ success: false, error: '停止理由を200文字以内で入力してください' }, 400);
    }
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      return c.json({ success: false, error: '最新の停止状態を読み直してください' }, 400);
    }
    const detail = typeof body.detail === 'string' && body.detail.trim()
      ? body.detail.trim().slice(0, 1_000)
      : null;

    try {
      const result = await stopOperationCapabilities(c.env.DB, {
        lineAccountId: accountId,
        capabilities,
        expectedVersion: Number(body.expectedVersion),
        actorId: c.get('staff')!.id,
        reason: body.reason.trim(),
        detail,
      });
      if (result.status === 'conflict') {
        return c.json({
          success: false,
          error: '別の管理者が先に変更しました。最新の状態を読み直してください。',
          data: result.control,
        }, 409);
      }
      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      console.error('POST /api/operations/incidents error:', error);
      return c.json({ success: false, error: '緊急停止状態を保存できませんでした' }, 500);
    }
  },
);

operations.post(
  '/api/operations/incidents/:id/restore',
  requireRole('owner', 'admin'),
  requireEmergencyControlPermission,
  requireIrreversibleConfirmation('operation-restore'),
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ success: false, error: '入力内容を読み取れませんでした' }, 400);
    }
    if (body.confirmation !== '復旧') {
      return c.json({ success: false, error: '確認のため「復旧」と入力してください' }, 400);
    }
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
      return c.json({ success: false, error: '最新の停止状態を読み直してください' }, 400);
    }

    try {
      const incident = await getOperationIncident(c.env.DB, c.req.param('id'));
      if (!incident) return c.json({ success: false, error: '緊急操作の記録が見つかりません' }, 404);
      if (!await canControlScope(c, incident.lineAccountId)) {
        return c.json({ success: false, error: 'この範囲を復旧する権限がありません' }, 403);
      }
      const result = await restoreOperationIncident(c.env.DB, {
        incidentId: incident.id,
        expectedVersion: Number(body.expectedVersion),
        actorId: c.get('staff')!.id,
      });
      if (result.status === 'not_found') {
        return c.json({ success: false, error: '復旧できる緊急停止ではありません' }, 409);
      }
      if (result.status === 'conflict') {
        return c.json({
          success: false,
          error: '別の管理者が先に変更しました。最新の状態を読み直してください。',
          data: result.control,
        }, 409);
      }
      return c.json({ success: true, data: result });
    } catch (error) {
      console.error('POST /api/operations/incidents/:id/restore error:', error);
      return c.json({ success: false, error: '復旧後の状態を保存できませんでした' }, 500);
    }
  },
);
