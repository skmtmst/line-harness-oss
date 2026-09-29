import type { MiddlewareHandler } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';

const UNAVAILABLE = {
  success: false,
  code: 'TENANT_SUSPENDED',
  error: '現在ご利用いただけません',
} as const;

/**
 * Public LIFF routes bypass authMiddleware, so they need an independent
 * server-side tenant wall. Most public booking/event/webinar entry points
 * already carry liffId; resolve it and tenant status in one D1 read before
 * any route can write.
 */
export const tenantPublicBoundaryMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith('/api/liff/')) return next();
  const url = new URL(c.req.url);
  let liffId = (url.searchParams.get('liffId') ?? url.searchParams.get('liff_id'))?.trim() || '';
  let accountId = (url.searchParams.get('accountId') ?? url.searchParams.get('account_id'))?.trim() || '';
  if (!liffId && !accountId && !['GET', 'HEAD'].includes(c.req.method.toUpperCase())) {
    const body = await c.req.raw.clone().json<Record<string, unknown>>().catch(() => null);
    liffId = typeof body?.liffId === 'string'
      ? body.liffId.trim()
      : typeof body?.liff_id === 'string' ? body.liff_id.trim() : '';
    accountId = typeof body?.accountId === 'string'
      ? body.accountId.trim()
      : typeof body?.account_id === 'string' ? body.account_id.trim() : '';
  }
  if (!liffId && !accountId) return next();

  const row = await c.env.DB.prepare(
    `SELECT CASE
       WHEN COALESCE(account.tenant_id, ?) = ? THEN 'active'
       WHEN tenant.status IN ('active', 'suspended', 'archived') THEN tenant.status
       ELSE 'archived'
     END AS tenant_status
       FROM line_accounts account
       LEFT JOIN tenants tenant ON tenant.id = COALESCE(account.tenant_id, ?)
      WHERE ${accountId ? 'account.id = ?' : 'account.liff_id = ?'} AND account.is_active = 1
      LIMIT 1`,
  ).bind(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, accountId || liffId)
    .first<{ tenant_status: 'active' | 'suspended' | 'archived' }>();
  if (row && row.tenant_status !== 'active') return c.json(UNAVAILABLE, 503);
  return next();
};
