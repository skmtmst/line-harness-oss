import { Hono } from 'hono';
import { recordPlatformAudit } from '@line-crm/db';
import type { Env } from '../index.js';
import { requirePlatformAdminWrite } from '../middleware/platform-admin.js';
import { syncBillingInvoices } from '../services/billing-invoices-sync.js';
import { dbFor } from '../services/db-router.js';

export const opsBilling = new Hono<Env>();

opsBilling.use('/api/ops/billing/*', requirePlatformAdminWrite());

opsBilling.post('/api/ops/billing/sync', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ success: false, error: 'Stripe の接続設定がまだありません' }, 503);
  }
  const body = await c.req.json<{ months?: unknown } | null>().catch(() => null);
  const months = body?.months === undefined ? 12 : body.months;
  if (!Number.isInteger(months) || Number(months) < 1 || Number(months) > 12) {
    return c.json({ success: false, error: '取り込む期間は1〜12か月で指定してください' }, 400);
  }
  const now = new Date();
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - Number(months));
  const result = await syncBillingInvoices(c.env, { since, now });
  const staff = c.get('staff');
  await recordPlatformAudit(dbFor(c.env), {
    staffId: staff.id,
    staffName: staff.name,
    action: 'billing.sync',
    detail: {
      months,
      imported: result.imported,
      failed: result.failed,
      tenants: result.tenants,
      completed: result.completed,
    },
    visibleToTenant: false,
  });
  return c.json({ success: true, data: result });
});
