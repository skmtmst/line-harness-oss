import { Hono, type Context, type Next } from 'hono';
import {
  ACCESS_ROLE_BUNDLES,
  listAccessUsers,
  listAuditEvents,
  type AccessRoleBundle,
  type AccessUserStatus,
  type AuditCategory,
  type AuditResult,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

export const access = new Hono<Env>();

const USER_STATUSES: AccessUserStatus[] = ['active', 'invited', 'expired', 'suspended'];
const ROLE_BUNDLES: AccessRoleBundle[] = ['administrator', 'operations', 'reception', 'view_only', 'custom'];
const AUDIT_CATEGORIES: AuditCategory[] = ['auth', 'business'];
const AUDIT_RESULTS: AuditResult[] = ['success', 'denied', 'failed'];

function hasPermission(c: Context<Env>, permission: string): boolean {
  const staff = c.get('staff');
  return staff.role === 'owner' || staff.role === 'admin' || staff.permissionKeys?.includes(permission) === true;
}

function requirePermission(permission: string) {
  return async (c: Context<Env>, next: Next) => {
    if (!hasPermission(c, permission)) {
      return c.json({ success: false, error: 'この情報を表示する権限がありません' }, 403);
    }
    return next();
  };
}

function integerQuery(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function enumQuery<T extends string>(raw: string | undefined, allowed: readonly T[]): T | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  return allowed.includes(raw as T) ? raw as T : null;
}

function dateQuery(raw: string | undefined): string | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

async function visibleScope(c: Context<Env>) {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const lineAccountId = c.req.query('lineAccountId')?.trim() || undefined;
  if (lineAccountId && !scope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: '対象が見つかりません' }, 404);
  }
  return { scope, lineAccountId };
}

access.get(
  '/api/access/users',
  requireRole('owner', 'admin', 'staff'),
  requirePermission('access.user.view'),
  async (c) => {
    const status = enumQuery(c.req.query('status'), USER_STATUSES);
    const roleBundle = enumQuery(c.req.query('roleBundle'), ROLE_BUNDLES);
    const limit = integerQuery(c.req.query('limit'), 50, 1, 200);
    const offset = integerQuery(c.req.query('offset'), 0, 0, 100_000);
    if (status === null || roleBundle === null || limit === null || offset === null) {
      return c.json({ success: false, error: '絞り込み条件を確認してください' }, 400);
    }
    const accessScope = await visibleScope(c);
    if (accessScope instanceof Response) return accessScope;
    try {
      const canReadEmail = hasPermission(c, 'access.user.email.view');
      const result = await listAccessUsers(c.env.DB, {
        tenantId: c.get('staff').tenantId ?? DEFAULT_TENANT_ID,
        allowedLineAccountIds: accessScope.scope.allowedAccountIds,
        lineAccountId: accessScope.lineAccountId,
        status,
        roleBundle,
        query: c.req.query('query'),
        includeEmailInSearch: canReadEmail,
        limit,
        offset,
      });
      return c.json({
        success: true,
        data: {
          items: result.items.map((item) => ({
            ...item,
            email: canReadEmail ? item.email : maskEmail(item.email),
          })),
          summary: result.summary,
          pagination: { total: result.total, limit: result.limit, offset: result.offset },
        },
      });
    } catch (error) {
      console.error('GET /api/access/users error:', error instanceof Error ? error.name : 'unknown');
      return c.json({ success: false, error: 'ログインユーザーを取得できませんでした' }, 500);
    }
  },
);

access.get(
  '/api/access/roles',
  requireRole('owner', 'admin', 'staff'),
  requirePermission('access.user.view'),
  async (c) => {
    const accessScope = await visibleScope(c);
    if (accessScope instanceof Response) return accessScope;
    try {
      const result = await listAccessUsers(c.env.DB, {
        tenantId: c.get('staff').tenantId ?? DEFAULT_TENANT_ID,
        allowedLineAccountIds: accessScope.scope.allowedAccountIds,
        lineAccountId: accessScope.lineAccountId,
        limit: 1,
      });
      return c.json({
        success: true,
        data: {
          items: ACCESS_ROLE_BUNDLES.map((bundle) => ({
            ...bundle,
            assignedUserCount: result.summary.roleCounts[bundle.id],
          })),
          totalBundles: ACCESS_ROLE_BUNDLES.length,
          totalAssignedUsers: Object.values(result.summary.roleCounts).reduce((sum, count) => sum + count, 0),
        },
      });
    } catch (error) {
      console.error('GET /api/access/roles error:', error instanceof Error ? error.name : 'unknown');
      return c.json({ success: false, error: '権限のかたまりを取得できませんでした' }, 500);
    }
  },
);

access.get(
  '/api/audit/events',
  requireRole('owner', 'admin', 'staff'),
  requirePermission('access.audit.view'),
  async (c) => {
    const category = enumQuery(c.req.query('category'), AUDIT_CATEGORIES);
    const result = enumQuery(c.req.query('result'), AUDIT_RESULTS);
    const from = dateQuery(c.req.query('from'));
    const to = dateQuery(c.req.query('to'));
    const limit = integerQuery(c.req.query('limit'), 20, 1, 200);
    const offset = integerQuery(c.req.query('offset'), 0, 0, 100_000);
    if (category === null || result === null || from === null || to === null || limit === null || offset === null) {
      return c.json({ success: false, error: '絞り込み条件を確認してください' }, 400);
    }
    if (from && to && Date.parse(from) > Date.parse(to)) {
      return c.json({ success: false, error: '期間の開始と終了を確認してください' }, 400);
    }
    const accessScope = await visibleScope(c);
    if (accessScope instanceof Response) return accessScope;
    try {
      const audit = await listAuditEvents(c.env.DB, {
        tenantId: c.get('staff').tenantId ?? DEFAULT_TENANT_ID,
        allowedLineAccountIds: accessScope.scope.allowedAccountIds,
        lineAccountId: accessScope.lineAccountId,
        category,
        result,
        actorId: c.req.query('actorId')?.trim() || undefined,
        action: c.req.query('action')?.trim() || undefined,
        query: c.req.query('query')?.trim() || undefined,
        from,
        to,
        limit,
        offset,
      });
      return c.json({
        success: true,
        data: {
          items: audit.items,
          summary: audit.summary,
          pagination: { total: audit.total, limit: audit.limit, offset: audit.offset },
        },
      });
    } catch (error) {
      console.error('GET /api/audit/events error:', error instanceof Error ? error.name : 'unknown');
      return c.json({ success: false, error: '操作記録を取得できませんでした' }, 500);
    }
  },
);
