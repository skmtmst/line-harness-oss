import { Hono, type Context, type Next } from 'hono';
import {
  listEcActionExecutions,
  listEcIdentityCandidates,
  listEcOrders,
  retryEcActionExecution,
  type EcActionExecutionStatus,
  type EcOrderState,
} from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { sha256Hex } from '../middleware/auth.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

export const ecOperations = new Hono<Env>();

type EcPermission = 'ec.event.view' | 'ec.action.retry';

function requireEcPermission(permission: EcPermission) {
  return async (c: Context<Env>, next: Next) => {
    const staff = c.get('staff');
    if (!staff || (staff.role === 'staff' && !staff.permissionKeys?.includes(permission))) {
      return c.json({ success: false, error: 'この操作を行う権限がありません', code: 'FORBIDDEN' }, 403);
    }
    await next();
  };
}

function tenantId(c: Context<Env>): string {
  return c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
}

function lineAccountId(c: Context<Env>): string | null {
  const value = c.req.query('lineAccountId')?.trim() ?? '';
  return value || null;
}

function pagination(c: Context<Env>): { limit: number; offset: number } {
  const rawLimit = Number(c.req.query('limit') ?? 20);
  const rawOffset = Number(c.req.query('offset') ?? 0);
  return {
    limit: Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20,
    offset: Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0,
  };
}

async function visible(c: Context<Env>, accountId: string): Promise<boolean> {
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]);
}

const ORDER_STATES = new Set<EcOrderState>(['current', 'refunded', 'cancelled']);
const ACTION_STATES = new Set<EcActionExecutionStatus>([
  'pending', 'processing', 'succeeded', 'skipped', 'retryable_failed', 'permanent_failed',
]);
type IdentityState = 'pending' | 'linked' | 'different' | 'deferred' | 'invalidated';
const IDENTITY_STATES = new Set<IdentityState>([
  'pending', 'linked', 'different', 'deferred', 'invalidated',
]);

ecOperations.get(
  '/api/ec-commerce/orders',
  requireRole('owner', 'admin', 'staff'),
  requireEcPermission('ec.event.view'),
  async (c) => {
    const accountId = lineAccountId(c);
    const status = c.req.query('status')?.trim() || null;
    if (!accountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (status && !ORDER_STATES.has(status as EcOrderState)) {
      return c.json({ success: false, error: '注文の状態が正しくありません' }, 400);
    }
    if (!await visible(c, accountId)) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    try {
      const page = pagination(c);
      const data = await listEcOrders(c.env.DB, {
        lineAccountId: accountId, status: status as EcOrderState | null,
        query: c.req.query('query')?.trim().slice(0, 100) || '', ...page,
      });
      return c.json({ success: true, data, pagination: { total: data.total, ...page } });
    } catch (error) {
      console.error('GET /api/ec-commerce/orders error:', error);
      return c.json({ success: false, error: '注文を確認できませんでした' }, 500);
    }
  },
);

ecOperations.get(
  '/api/ec-commerce/action-executions',
  requireRole('owner', 'admin', 'staff'),
  requireEcPermission('ec.event.view'),
  async (c) => {
    const accountId = lineAccountId(c);
    const status = c.req.query('status')?.trim() || null;
    if (!accountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (status && !ACTION_STATES.has(status as EcActionExecutionStatus)) {
      return c.json({ success: false, error: '処理の状態が正しくありません' }, 400);
    }
    if (!await visible(c, accountId)) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    try {
      const page = pagination(c);
      const data = await listEcActionExecutions(c.env.DB, {
        lineAccountId: accountId, eventId: c.req.query('eventId')?.trim() || null,
        status: status as EcActionExecutionStatus | null, ...page,
      });
      return c.json({ success: true, data, pagination: { total: data.total, ...page } });
    } catch (error) {
      console.error('GET /api/ec-commerce/action-executions error:', error);
      return c.json({ success: false, error: 'ECの処理履歴を確認できませんでした' }, 500);
    }
  },
);

ecOperations.post(
  '/api/ec-commerce/action-executions/:id/retry',
  requireRole('owner', 'admin', 'staff'),
  requireEcPermission('ec.action.retry'),
  async (c) => {
    type RetryBody = { lineAccountId?: unknown; expectedVersion?: unknown };
    const body = await c.req.json<RetryBody>().catch((): RetryBody => ({}));
    const key = c.req.header('Idempotency-Key')?.trim() ?? '';
    if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()
      || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1
      || key.length < 8 || key.length > 200) {
      return c.json({ success: false, error: '対象アカウント、版、再実行キーを確認してください' }, 400);
    }
    const accountId = body.lineAccountId.trim();
    if (!await visible(c, accountId)) {
      return c.json({ success: false, error: '処理履歴が見つかりません' }, 404);
    }
    try {
      const requestFingerprint = await sha256Hex(JSON.stringify({
        id: c.req.param('id'), lineAccountId: accountId, expectedVersion: body.expectedVersion,
      }));
      const result = await retryEcActionExecution(c.env.DB, {
        id: c.req.param('id'), lineAccountId: accountId,
        expectedVersion: Number(body.expectedVersion), idempotencyKey: key,
        requestFingerprint, requestedBy: c.get('staff')!.id,
      });
      if (result.kind === 'not_found') {
        return c.json({ success: false, error: '処理履歴が見つかりません' }, 404);
      }
      if (result.kind === 'changed') {
        return c.json({ success: false, error: '処理履歴が更新されています', code: 'VERSION_CONFLICT' }, 409);
      }
      if (result.kind === 'invalid_state') {
        return c.json({
          success: false, error: 'この処理は再試行できません', code: 'RETRY_NOT_AVAILABLE', status: result.status,
        }, 409);
      }
      auditLog(c, 'ec.action.retry', { kind: 'ec-action-execution', id: result.execution.id });
      return c.json({ success: true, data: result.execution }, result.kind === 'queued' ? 202 : 200);
    } catch (error) {
      console.error('POST /api/ec-commerce/action-executions/:id/retry error:', error);
      return c.json({ success: false, error: 'ECの処理を再試行できませんでした' }, 500);
    }
  },
);

ecOperations.get(
  '/api/ec-commerce/identity-candidates',
  requireRole('owner', 'admin', 'staff'),
  requireEcPermission('ec.event.view'),
  async (c) => {
    const accountId = lineAccountId(c);
    const rawStatus = c.req.query('status')?.trim() || 'pending';
    if (!accountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
    if (!IDENTITY_STATES.has(rawStatus as IdentityState)) {
      return c.json({ success: false, error: '照合候補の状態が正しくありません' }, 400);
    }
    if (!await visible(c, accountId)) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    try {
      const page = pagination(c);
      const data = await listEcIdentityCandidates(c.env.DB, {
        tenantId: tenantId(c), lineAccountId: accountId,
        status: rawStatus as IdentityState,
        ...page,
      });
      return c.json({ success: true, data, pagination: { total: data.total, ...page } });
    } catch (error) {
      console.error('GET /api/ec-commerce/identity-candidates error:', error);
      return c.json({ success: false, error: '会員のつき合わせを確認できませんでした' }, 500);
    }
  },
);
