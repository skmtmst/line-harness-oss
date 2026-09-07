import type { Context, MiddlewareHandler } from 'hono';
import { auditDeviceFamily, maskAuditIp, recordAuditEvent } from '@line-crm/db';
import type { Env } from '../index.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function targetKind(routePath: string): string | null {
  const segment = routePath.split('/').filter(Boolean)[1];
  return segment?.slice(0, 100) ?? null;
}

function resultForStatus(status: number): 'success' | 'denied' | 'failed' {
  if (status === 401 || status === 403 || status === 404) return 'denied';
  return status >= 400 ? 'failed' : 'success';
}

async function requestLineAccountId(c: Context<Env>): Promise<string | null> {
  const queryValue = c.req.query('lineAccountId') ?? c.req.query('account_id');
  if (queryValue?.trim()) return queryValue.trim().slice(0, 160);
  if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) return null;
  try {
    const body = await c.req.raw.clone().json() as Record<string, unknown>;
    const value = body.lineAccountId ?? body.account_id;
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : null;
  } catch {
    return null;
  }
}

/**
 * 認証済み管理APIの変更を、routeごとの記録漏れに左右されず残す。
 * bodyからはaccount IDだけを抽出し、登録済みroute patternと結果だけを記録する。
 * 顧客本文や秘密値は監査入力へ渡さない。
 */
export const businessAuditMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const shouldAudit = Boolean(c.get('staff')) && MUTATING_METHODS.has(c.req.method);
  const lineAccountIdPromise = shouldAudit ? requestLineAccountId(c) : Promise.resolve(null);
  await next();
  const staff = c.get('staff');
  if (!staff || !shouldAudit || c.get('auditRecorded')) return;
  const db = c.env?.DB;
  if (!db || typeof db.prepare !== 'function') return;

  const routePath = c.req.routePath || new URL(c.req.url).pathname;
  const method = c.req.method.toLowerCase();
  const lineAccountId = await lineAccountIdPromise;
  const task = recordAuditEvent(db, {
    tenantId: staff.tenantId,
    lineAccountId,
    category: 'business',
    actorPrincipalId: staff.id,
    actorRole: staff.role,
    action: `api.${method}.${routePath}`,
    targetKind: targetKind(routePath),
    targetId: c.req.param('id') ?? null,
    result: resultForStatus(c.res.status),
    requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
    ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
    deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
  }).catch((error: unknown) => {
    console.error('business audit insert failed:', error instanceof Error ? error.name : 'unknown');
  });

  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
};
