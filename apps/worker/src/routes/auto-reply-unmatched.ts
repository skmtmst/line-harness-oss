import { Hono } from 'hono';
import type { Env } from '../index.js';
import type {
  AutoReplyUnmatchedSettings,
  AutoReplyUnmatchedInput,
} from '@line-crm/shared';
import { requirePermission, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
export const autoReplyUnmatched = new Hono<Env>();
export async function readAutoReplyUnmatchedSettings(
  db: D1Database,
  id: string,
): Promise<AutoReplyUnmatchedSettings> {
  const r = await db
    .prepare(
      'SELECT message,version,updated_by,updated_at FROM auto_reply_unmatched_settings WHERE line_account_id=?',
    )
    .bind(id)
    .first<{
      message: string | null;
      version: number;
      updated_by: string;
      updated_at: string;
    }>();
  return {
    lineAccountId: id,
    message: r?.message ?? null,
    version: r?.version ?? 0,
    updatedBy: r?.updated_by ?? null,
    updatedAt: r?.updated_at ?? null,
  };
}
autoReplyUnmatched.use(
  '/api/auto-replies/unmatched-settings',
  requirePermission('/auto-replies'),
  async (c, next) => {
    const id = c.req.query('lineAccountId');
    if (!id) return c.json({ success: false, error: 'account_required' }, 400);
    if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [id])))
      return c.json({ success: false, error: 'not_found' }, 404);
    if (c.req.method === 'PUT' && c.get('staff')?.readOnly)
      return c.json({ success: false, error: 'read_only' }, 403);
    c.header('Cache-Control', 'no-store');
    await next();
  },
);
autoReplyUnmatched.get('/api/auto-replies/unmatched-settings', async (c) =>
  c.json({
    success: true,
    data: await readAutoReplyUnmatchedSettings(
      c.env.DB,
      c.req.query('lineAccountId')!,
    ),
  }),
);
autoReplyUnmatched.put(
  '/api/auto-replies/unmatched-settings',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const id = c.req.query('lineAccountId')!,
      b = await c.req.json<AutoReplyUnmatchedInput>().catch(() => null);
    if (
      !b ||
      !Number.isSafeInteger(b.expectedVersion) ||
      b.expectedVersion < 0 ||
      (b.message !== null &&
        (typeof b.message !== 'string' ||
          !b.message.trim() ||
          Array.from(b.message).length > 5000))
    )
      return c.json({ success: false, error: 'invalid_settings' }, 400);
    const r = await c.env.DB.prepare(
      `INSERT INTO auto_reply_unmatched_settings(line_account_id,message,updated_by,updated_at) SELECT ?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM auto_reply_unmatched_settings WHERE line_account_id=?) ON CONFLICT(line_account_id) DO UPDATE SET message=excluded.message,version=version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE version=?`,
    )
      .bind(
        id,
        b.message,
        c.get('staff').id,
        new Date().toISOString(),
        b.expectedVersion,
        id,
        b.expectedVersion,
      )
      .run();
    if (!r.meta.changes)
      return c.json({ success: false, error: 'version_conflict' }, 409);
    return c.json({
      success: true,
      data: await readAutoReplyUnmatchedSettings(c.env.DB, id),
    });
  },
);
