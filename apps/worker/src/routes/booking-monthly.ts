import { Hono } from 'hono';
import { listMonthlyContracts, MonthlyLedgerError, type MonthlyScope } from '@line-crm/db';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { requirePermission, requireRole } from '../middleware/role-guard.js';
import { GapError, gapAccount } from '../services/gap-common.js';
import { resolveAccountIdFromLiff, resolveFriendId, verifyCallerLineUserId } from './booking.js';
import { liffBookingJson } from './liff-booking-response.js';

export const bookingMonthly = new Hono<Env>();
bookingMonthly.onError((error, c) => {
  if (!(error instanceof GapError || error instanceof MonthlyLedgerError)) throw error;
  const response = { success: false, error: error.code, code: error.code, ...(error.code === 'monthly_tenant_required' ? {
    message: '会社の設定が済んでいないので月謝のオンライン購入はまだ使えません。運営にお問い合わせください',
  } : {}) };
  return c.req.path.startsWith('/api/liff/') ? liffBookingJson(c, response, error.status) : c.json(response, error.status);
});
bookingMonthly.use('/api/booking/admin/monthly-contracts*', requireRole('owner', 'admin', 'staff'), requirePermission('/booking/bookings'));

async function monthlyScope(c: Context<Env>, accountId: string): Promise<MonthlyScope> {
  c.header('Cache-Control', 'private, no-store');
  const account = await c.env.DB.prepare(`SELECT a.tenant_id FROM line_accounts a
    LEFT JOIN tenants t ON t.id=a.tenant_id WHERE a.id=? AND a.is_active=1 AND a.archived_at IS NULL
    AND (a.tenant_id IS NULL OR t.status='active')`).bind(accountId).first<{ tenant_id: string | null }>();
  if (!account) throw new GapError('not_found', 404);
  if (!account.tenant_id) throw new MonthlyLedgerError('monthly_tenant_required');
  return { tenantId: account.tenant_id, accountId };
}
function paging(c: Context<Env>) {
  const limit = Number(c.req.query('limit') ?? 20), offset = Number(c.req.query('offset') ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) throw new GapError('invalid_pagination');
  return { limit, offset };
}
bookingMonthly.get('/api/booking/admin/monthly-contracts', async c => {
  const accountId = await gapAccount(c), friendId = c.req.query('friend_id');
  if (!friendId) throw new GapError('missing_friend_id');
  if (!await c.env.DB.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=?').bind(friendId, accountId).first()) throw new GapError('not_found', 404);
  const scope = await monthlyScope(c, accountId);
  return c.json({ success: true, data: await listMonthlyContracts(c.env.DB, scope, friendId, paging(c)) });
});
bookingMonthly.get('/api/liff/booking/monthly-contracts', async c => {
  c.header('Cache-Control', 'private, no-store');
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return liffBookingJson(c, { error: 'unknown_liff' }, 404);
  const caller = await verifyCallerLineUserId(c);
  if (!caller) return liffBookingJson(c, { error: 'unauthorized' }, 401);
  const friendId = await resolveFriendId(c, caller, accountId);
  if (!friendId) return liffBookingJson(c, { error: 'friend_not_found' }, 404);
  const scope = await monthlyScope(c, accountId);
  return liffBookingJson(c, { success: true, data: await listMonthlyContracts(c.env.DB, scope, friendId, paging(c)) });
});
