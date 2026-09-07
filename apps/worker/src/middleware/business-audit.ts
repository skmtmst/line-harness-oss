import type { MiddlewareHandler } from 'hono';
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

/**
 * 認証済み管理APIの変更を、routeごとの記録漏れに左右されず残す。
 * bodyは読まず、登録済みroute patternだけを記録するため顧客本文や秘密値は入らない。
 */
export const businessAuditMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  const staff = c.get('staff');
  if (!staff || !MUTATING_METHODS.has(c.req.method) || c.get('auditRecorded')) return;
  const db = c.env?.DB;
  if (!db || typeof db.prepare !== 'function') return;

  const routePath = c.req.routePath || new URL(c.req.url).pathname;
  const method = c.req.method.toLowerCase();
  const lineAccountId = c.req.query('lineAccountId') ?? c.req.query('account_id') ?? null;
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
