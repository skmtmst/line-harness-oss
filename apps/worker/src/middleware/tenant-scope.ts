import type { MiddlewareHandler } from 'hono';
import { auditDeviceFamily, maskAuditIp, recordAuditEvent } from '@line-crm/db';
import type { Env } from '../index.js';
import { canonicalDenyAuditFor } from '../lib/audit-log.js';
import { dbFor } from '../services/db-router.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

export const ACCOUNT_QUERY_KEYS = [
  'account_id',
  'accountId',
  'lineAccountId',
  'line_account_id',
  'account',
] as const;

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
      recordBoundaryDenial(c, id);
      return c.json({
        success: false,
        error: 'このLINEアカウントを操作する権限がありません',
      }, 403);
    }
  }

  return next();
};

/**
 * 境界で止めた要求のうち、正規の操作名が決まっているものは監査へ残す。
 *
 * route側の監査はここで止まると届かない。到達不能な拒否を残すため、
 * 境界自身が同じ操作名・結果deniedで1件だけ書く。URLや秘密値は渡さない。
 */
function recordBoundaryDenial(
  c: Parameters<MiddlewareHandler<Env>>[0],
  requestedAccountId: string,
): void {
  const canonical = canonicalDenyAuditFor(c.req.method, c.req.path);
  if (!canonical) return;
  const staff = c.get('staff');
  const db = c.env ? dbFor(c.env) : null;
  let writer: typeof recordAuditEvent | null = null;
  try {
    writer = typeof recordAuditEvent === 'function' ? recordAuditEvent : null;
  } catch {
    writer = null;
  }
  if (!db || typeof db.prepare !== 'function' || !writer) return;
  const task = writer(db, {
    tenantId: staff?.tenantId,
    lineAccountId: requestedAccountId,
    category: 'business',
    actorPrincipalId: staff?.id,
    actorRole: staff?.role,
    action: canonical.action,
    targetKind: canonical.kind,
    targetId: canonical.id,
    result: 'denied',
    requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
    ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
    deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
  }).catch((error: unknown) => {
    console.error('boundary audit insert failed:', error instanceof Error ? error.name : 'unknown');
  });
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
}
