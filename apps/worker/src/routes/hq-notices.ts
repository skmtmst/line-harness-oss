import { Hono } from 'hono';
import { issueStaffLineLinkCode, listUnreadScreenNotices, markScreenNoticeRead } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { loadNoticeLineAccount } from '../services/platform-announcements.js';

/**
 * 統括の管理画面に出す運営からのお知らせ（★V6 37-7 の「画面のお知らせ」）と、
 * 契約者専用LINEの登録案内（LINE アカウント登録完了時のポップアップ。決定 2026-09-18）。
 * 本人（ログイン中の権限者）の分だけを扱う。
 */
export const hqNotices = new Hono<Env>();

hqNotices.get('/api/hq/notices', async (c) => {
  const staff = c.get('staff');
  const notices = await listUnreadScreenNotices(c.env.DB, staff.id);
  return c.json({ success: true, data: notices });
});

hqNotices.post('/api/hq/notices/:id/read', requireRole('owner', 'admin', 'staff'), async (c) => {
  const staff = c.get('staff');
  const ok = await markScreenNoticeRead(c.env.DB, c.req.param('id'), staff.id);
  return c.json({ success: true, data: { read: ok } });
});

/** 契約者専用LINEの登録案内。QR は画面側で描く。確認コードは本人用（24 時間）。 */
hqNotices.get('/api/hq/notices/line-registration', async (c) => {
  const staff = c.get('staff');
  const notice = await loadNoticeLineAccount(c.env);
  if (!notice) return c.json({ success: true, data: { available: false } });
  const linkedRow = await c.env.DB.prepare('SELECT notice_friend_id FROM staff_members WHERE id = ?').bind(staff.id).first<{ notice_friend_id: string | null }>();
  const linked = Boolean(linkedRow?.notice_friend_id);
  const code = linked ? null : await issueStaffLineLinkCode(c.env.DB, staff.id);
  return c.json({
    success: true,
    data: {
      available: true,
      accountName: notice.name,
      basicId: notice.basicId,
      addFriendUrl: notice.addFriendUrl,
      linked,
      code: code?.code ?? null,
      codeExpiresAt: code?.expiresAt ?? null,
    },
  });
});
