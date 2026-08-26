import { Hono } from 'hono';
import {
  getLinkBaseUrl,
  setLinkBaseUrl,
  getTrackedLinkBaseUrl,
  setTrackedLinkBaseUrl,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';

const accountSettings = new Hono<Env>();
const MAX_TEST_RECIPIENTS = 90;

// GET /api/account-settings/test-recipients?accountId=xxx
accountSettings.get('/api/account-settings/test-recipients', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`
  ).bind(accountId).first<{ value: string }>();

  const friendIds: string[] = row ? JSON.parse(row.value) : [];

  if (friendIds.length === 0) {
    return c.json({ success: true, data: [] });
  }
  const placeholders = friendIds.map(() => '?').join(',');
  const friends = await c.env.DB.prepare(
    `SELECT id, display_name, picture_url FROM friends WHERE id IN (${placeholders})`
  ).bind(...friendIds).all<{ id: string; display_name: string; picture_url: string | null }>();

  return c.json({
    success: true,
    data: friends.results.map(f => ({
      id: f.id,
      displayName: f.display_name,
      pictureUrl: f.picture_url,
    })),
  });
});

// GET /api/account-settings/test-recipient-login-users?accountId=xxx
//
// LINE連携済みのログインユーザーを、テスト送信先の候補として返す。
// staff_membersはログイン権限、friendsは実際のLINE送信先なので、
// line_user_idで両方が一致する有効な行だけを候補にする。
accountSettings.get('/api/account-settings/test-recipient-login-users', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const tenantId = c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;

  const result = await c.env.DB.prepare(
    `SELECT
       f.id,
       COALESCE(NULLIF(f.display_name, ''), sm.name) AS display_name,
       f.picture_url,
       sm.name AS staff_name,
       CASE WHEN f.line_account_id = ? THEN 1 ELSE 0 END AS same_account
     FROM staff_members sm
     JOIN friends f ON f.line_user_id = sm.line_user_id
       AND (
         f.line_account_id = ?
         OR NOT EXISTS (
           SELECT 1 FROM friends scoped
            WHERE scoped.line_user_id = sm.line_user_id
              AND scoped.line_account_id = ?
         ) AND EXISTS (
           SELECT 1 FROM line_accounts fallback_account
            WHERE fallback_account.id = f.line_account_id
              AND COALESCE(fallback_account.tenant_id, ?) = ?
         )
       )
     WHERE sm.is_active = 1
       AND COALESCE(sm.tenant_id, ?) = ?
       AND sm.line_user_id IS NOT NULL
       AND f.is_following = 1
     ORDER BY same_account DESC, sm.created_at ASC`
  // C-2bで複合一意制約へ移行したら、上のNOT EXISTSフォールバックを外す。
  // 現在は既存の別アカウント・未割当行を候補から消さず、同じ応答を保つ。
  ).bind(
    accountId,
    accountId,
    accountId,
    DEFAULT_TENANT_ID,
    tenantId,
    DEFAULT_TENANT_ID,
    tenantId,
  ).all<{
    id: string;
    display_name: string | null;
    picture_url: string | null;
    staff_name: string;
    same_account: number;
  }>();

  return c.json({
    success: true,
    data: result.results.map((row) => ({
      id: row.id,
      displayName: row.display_name || row.staff_name,
      pictureUrl: row.picture_url,
      staffName: row.staff_name,
      sameAccount: row.same_account === 1,
    })),
  });
});

// PUT /api/account-settings/test-recipients
accountSettings.put('/api/account-settings/test-recipients', requireRole('owner'), async (c) => {
  const body = await c.req.json<{ accountId: string; friendIds: string[] }>();
  if (!body.accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  if (!Array.isArray(body.friendIds)) {
    return c.json({ success: false, error: 'friendIds must be an array' }, 400);
  }
  if (body.friendIds.length > MAX_TEST_RECIPIENTS) {
    return c.json({ success: false, error: `friendIds must contain at most ${MAX_TEST_RECIPIENTS} items` }, 400);
  }
  if (body.friendIds.some((friendId) => typeof friendId !== 'string' || friendId.length === 0)) {
    return c.json({ success: false, error: 'friendIds must contain non-empty strings' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }

  const uniqueFriendIds = [...new Set(body.friendIds)];
  if (uniqueFriendIds.length > 0) {
    const placeholders = uniqueFriendIds.map(() => '?').join(',');
    const matchingFriends = await c.env.DB.prepare(
      `SELECT id FROM friends WHERE line_account_id = ? AND id IN (${placeholders})`
    ).bind(body.accountId, ...uniqueFriendIds).all<{ id: string }>();
    if (matchingFriends.results.length !== uniqueFriendIds.length) {
      return c.json({ success: false, error: 'One or more friendIds are invalid for this account' }, 400);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');

  await c.env.DB.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, ?, 'test_recipients', ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(
    id, body.accountId, JSON.stringify(body.friendIds), now, now,
    JSON.stringify(body.friendIds), now,
  ).run();

  return c.json({ success: true });
});

// ── link_base_url (global setting, stored under sentinel '__global__') ─────────

/**
 * GET /api/account-settings/link-base-url
 * Returns the configured short-link base URL (or null if not set).
 */
accountSettings.get('/api/account-settings/link-base-url', async (c) => {
  const value = await getLinkBaseUrl(c.env.DB, '__global__');
  return c.json({ success: true, data: value });
});

/**
 * PUT /api/account-settings/link-base-url
 * Body: { value: string }
 * - Empty string clears the setting.
 * - Must start with https:// (if non-empty).
 * - Trailing slash is stripped before saving.
 */
accountSettings.put('/api/account-settings/link-base-url', requireRole('owner'), async (c) => {
  const body = await c.req
    .json<{ value?: string }>()
    .catch((): { value?: string } => ({}));
  const value = typeof body.value === 'string' ? body.value : '';

  try {
    await setLinkBaseUrl(c.env.DB, '__global__', value);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation error';
    return c.json({ success: false, error: message }, 400);
  }
});

// ── tracked_link_base_url (global setting) ────────────────────────────────────
// Base domain for message tracked links (/t/<code>). The domain must route
// /t/* to the Worker (Redirect Rule or Custom Domain). Unset → WORKER_URL.

accountSettings.get('/api/account-settings/tracked-link-base-url', async (c) => {
  const value = await getTrackedLinkBaseUrl(c.env.DB, '__global__');
  return c.json({ success: true, data: value });
});

accountSettings.put('/api/account-settings/tracked-link-base-url', requireRole('owner'), async (c) => {
  const body = await c.req
    .json<{ value?: string }>()
    .catch((): { value?: string } => ({}));
  const value = typeof body.value === 'string' ? body.value : '';

  try {
    await setTrackedLinkBaseUrl(c.env.DB, '__global__', value);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation error';
    return c.json({ success: false, error: message }, 400);
  }
});

export { accountSettings };
