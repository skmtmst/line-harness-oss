import { Hono } from 'hono';
import {
  decidePrepayOnly,
  getBookingSalesSummary,
  getNoshowSettings,
  logNoshowFlagEvent,
  saveNoshowSettings,
  setNoshowFlagMode,
  type NoshowNoPaymentMode,
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

// GET /api/booking/admin/noshow-settings — 無断キャンセルの数え方
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
      data: await getNoshowSettings(c.env.DB, accountId),
    });
  },
);

// PUT /api/booking/admin/noshow-settings — 数え方を変える
bookingPlus.put(
  '/api/booking/admin/noshow-settings',
  requireRole('owner', 'admin'),
  async (c) => {
    const accountId = accountIdOf(c);
    if (!accountId) return c.json({ success: false, error: 'account_id が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    const body = await c.req.json<{
      enabled?: unknown; threshold?: unknown; windowMonths?: unknown; noPaymentMode?: unknown;
    }>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ success: false, error: '設定を送ってください' }, 400);
    }
    const current = await getNoshowSettings(c.env.DB, accountId);
    const enabled = body.enabled === undefined ? current.enabled : body.enabled === true;
    const threshold = body.threshold === undefined ? current.threshold : Number(body.threshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      return c.json({ success: false, error: 'threshold は 1〜100 の整数で指定してください' }, 400);
    }
    const windowMonths = body.windowMonths === undefined ? current.windowMonths : Number(body.windowMonths);
    if (!Number.isInteger(windowMonths) || windowMonths < 1 || windowMonths > 120) {
      return c.json({ success: false, error: 'windowMonths は 1〜120 の整数で指定してください' }, 400);
    }
    let noPaymentMode: NoshowNoPaymentMode = current.noPaymentMode;
    if (body.noPaymentMode !== undefined) {
      if (body.noPaymentMode !== 'notice' && body.noPaymentMode !== 'notice_call') {
        return c.json({ success: false, error: 'noPaymentMode は notice か notice_call で指定してください' }, 400);
      }
      noPaymentMode = body.noPaymentMode;
    }
    const saved = await saveNoshowSettings(c.env.DB, accountId, {
      enabled, threshold, windowMonths, noPaymentMode,
    });
    return c.json({ success: true, data: saved });
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

// POST /api/booking/admin/friends/:friendId/prepay — 店が手で前払いのみにする・外す
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
    // 体だけでも送れるよう、読めないときは付ける扱いにする。
    const body = await c.req.json<{ mode?: unknown; reason?: unknown }>().catch(() => null);
    const mode = body?.mode ?? 'manual_on';
    if (mode !== 'manual_on' && mode !== 'manual_off') {
      return c.json({ success: false, error: 'mode は manual_on か manual_off で指定してください' }, 400);
    }
    // 印を外すときは理由を1行書く（だれがいつ外したか残す）。
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    if (mode === 'manual_off' && !reason) {
      return c.json({ success: false, error: '印を外すときは理由を1行書いてください' }, 400);
    }
    const staff = c.get('staff');
    await setNoshowFlagMode(c.env.DB, accountId, friendId, mode);
    await logNoshowFlagEvent(c.env.DB, {
      lineAccountId: accountId,
      friendId,
      action: mode,
      reason: reason || null,
      staffId: staff?.id ?? null,
      staffName: staff?.name ?? null,
    });
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
