import { isPublicLiffOperation } from './public-api-boundary.js';
import type { Context, MiddlewareHandler } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { boundPublicLiffInput, publicLiffQuerySelector } from './public-liff-input.js';

const UNAVAILABLE = {
  success: false,
  code: 'TENANT_SUSPENDED',
  error: '現在ご利用いただけません',
} as const;

/** アカウント選択はクエリを優先し、route 側の本人・所有権検査も維持する。 */
async function publicAccountSelector(c: Context<Env>): Promise<{ liffId: string; accountId: string }> {
  let { liffId, accountId } = publicLiffQuerySelector(c.req.url);
  if (!liffId && !accountId && !['GET', 'HEAD'].includes(c.req.method.toUpperCase())) {
    const parsed: unknown = c.get('validatedInputBody');
    const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
    liffId = typeof body?.liffId === 'string'
      ? body.liffId.trim()
      : typeof body?.liff_id === 'string' ? body.liff_id.trim() : '';
    accountId = typeof body?.accountId === 'string'
      ? body.accountId.trim()
      : typeof body?.account_id === 'string' ? body.account_id.trim() : '';
  }
  return { liffId, accountId };
}

/** 公開 LIFF は staff 認証を通らないため、独立した統括境界が必要になる。書込前に liffId と停止状態を1回の D1 読込で解決する。 */
export const tenantPublicBoundaryMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  if (!isPublicLiffOperation(c.req.method, new URL(c.req.url).pathname)) return next();
  const rejected = await boundPublicLiffInput(c);
  if (rejected) return rejected;
  const { liffId, accountId } = await publicAccountSelector(c);
  if (!liffId && !accountId) return next();

  const row = await c.env.DB.prepare(
    `SELECT CASE
       WHEN COALESCE(account.tenant_id, ?) = ? THEN 'active'
       WHEN tenant.status IN ('active', 'suspended', 'archived') THEN tenant.status
       ELSE 'archived'
     END AS tenant_status
       FROM line_accounts account
       LEFT JOIN tenants tenant ON tenant.id = COALESCE(account.tenant_id, ?)
      WHERE ${accountId && liffId ? 'account.id = ? AND account.liff_id = ?' : accountId ? 'account.id = ?' : 'account.liff_id = ?'} AND account.is_active = 1
      LIMIT 1`,
  ).bind(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, ...(accountId && liffId ? [accountId, liffId] : [accountId || liffId]))
    .first<{ tenant_status: 'active' | 'suspended' | 'archived' }>();
  if (!row && accountId && liffId) return c.json({ success: false, error: 'LINEアカウントの指定が一致しません' }, 403);
  if (row && row.tenant_status !== 'active') return c.json(UNAVAILABLE, 503);
  return next();
};
