import { Hono } from 'hono';
import {
  decidePrepayOnly,
  getBookingSalesSummary,
  getNoshowThreshold,
  saveNoshowThreshold,
  setNoshowFlagMode,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

/**
 * 予約の追加機能（7 売上・8 無断キャンセル）。
 * 画面は後から配るので、今は API・データ・試験だけ。今ある画面の動きは変えない。
 */

const bookingPlus = new Hono<Env>();

function accountIdOf(c: { req: { query: (name: string) => string | undefined } }): string | null {
  return c.req.query('account_id')?.trim() || null;
}

function validISODate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : `${value}T00:00:00.000Z`;
}

// GET /api/booking/admin/sales-summary — 予約からの売上
bookingPlus.get(
  '/api/booking/admin/sales-summary',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = accountIdOf(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const from = validISODate(c.req.query('from'));
    const to = validISODate(c.req.query('to'));
    if (!from || !to || from >= to) {
      return c.json({ success: false, error: 'from・to は YYYY-MM-DD で from < to にしてください' }, 400);
    }
    const summary = await getBookingSalesSummary(c.env.DB, accountId, from, to);
    return c.json({ success: true, data: summary });
  },
);

// GET /api/booking/admin/noshow-settings — 無断キャンセルの基準
bookingPlus.get(
  '/api/booking/admin/noshow-settings',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = accountIdOf(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    return c.json({
      success: true,
      data: { threshold: await getNoshowThreshold(c.env.DB, accountId) },
    });
  },
);

// PUT /api/booking/admin/noshow-settings — 基準を変える
bookingPlus.put(
  '/api/booking/admin/noshow-settings',
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = accountIdOf(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const body = await c.req.json<{ threshold?: unknown }>().catch(() => null);
    const threshold = Number(body?.threshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      return c.json({ success: false, error: 'threshold は 1〜100 の整数で指定してください' }, 400);
    }
    await saveNoshowThreshold(c.env.DB, accountId, threshold);
    return c.json({ success: true, data: { threshold } });
  },
);

// GET /api/booking/admin/friends/:friendId/noshow — その人の無断の数と前払いのみか
bookingPlus.get(
  '/api/booking/admin/friends/:friendId/noshow',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = accountIdOf(c);
    const friendId = c.req.param('friendId')?.trim();
    if (!accountId || !friendId) {
      return c.json({ success: false, error: 'account_id と friendId が必要です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const friend = await c.env.DB.prepare(
      `SELECT id FROM friends WHERE id = ? AND line_account_id = ?`,
    ).bind(friendId, accountId).first<{ id: string }>();
    if (!friend) return c.json({ success: false, error: '対象が見つかりません' }, 404);
    return c.json({ success: true, data: await decidePrepayOnly(c.env.DB, accountId, friendId) });
  },
);

// POST /api/booking/admin/friends/:friendId/prepay — 店が手で前払いのみにする
bookingPlus.post(
  '/api/booking/admin/friends/:friendId/prepay',
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = accountIdOf(c);
    const friendId = c.req.param('friendId')?.trim();
    if (!accountId || !friendId) {
      return c.json({ success: false, error: 'account_id と friendId が必要です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    await setNoshowFlagMode(c.env.DB, accountId, friendId, 'manual_on');
    return c.json({ success: true, data: await decidePrepayOnly(c.env.DB, accountId, friendId) });
  },
);

// DELETE /api/booking/admin/friends/:friendId/prepay — 店が手で外して自動に戻す
bookingPlus.delete(
  '/api/booking/admin/friends/:friendId/prepay',
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = accountIdOf(c);
    const friendId = c.req.param('friendId')?.trim();
    if (!accountId || !friendId) {
      return c.json({ success: false, error: 'account_id と friendId が必要です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    await setNoshowFlagMode(c.env.DB, accountId, friendId, 'auto');
    return c.json({ success: true, data: await decidePrepayOnly(c.env.DB, accountId, friendId) });
  },
);

export { bookingPlus };
