import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index.js';
import { dbFor } from '../services/db-router.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const ACCOUNT_QUERY_KEYS = ['account_id', 'lineAccountId', 'line_account_id'] as const;

/**
 * 認証済みの管理APIが、別の統括に属するLINEアカウントをクエリで指定するのを防ぐ。
 * 公開経路とリクエストボディはここでは扱わず、既存のルート内認可もそのまま残す。
 */
export const tenantScopeMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const staff = c.get('staff');
  if (!staff) return next();
  if (!c.req.path.startsWith('/api/')) return next();

  const candidates = ACCOUNT_QUERY_KEYS
    .map((key) => c.req.query(key))
    .filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return next();

  const scope = await getVisibleLineAccountScope(dbFor(c.env), staff);
  for (const id of candidates) {
    if (!scope.ids.includes(id)) {
      console.warn({
        event: 'tenant_boundary_denied',
        staff_id: staff.id,
        staff_tenant_id: staff.tenantId ?? null,
        requested_account_id: id,
        path: c.req.path,
      });
      return c.json({
        success: false,
        error: 'このLINEアカウントを操作する権限がありません',
      }, 403);
    }
  }

  return next();
};
