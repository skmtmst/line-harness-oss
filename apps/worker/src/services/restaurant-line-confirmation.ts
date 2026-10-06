import type { Context } from 'hono';
import { isOperationCapabilityStopped, resolveLineCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { dbFor } from './db-router.js';
import { formatStartsAtForStore } from './booking-notifier.js';
import { pushViaHarnessProxy } from './line-proxy-send.js';
import { dispatchLineProxyLocally } from './local-line-proxy.js';

export type RestaurantLineNotice = {
  sent: boolean;
  reason: null | 'not_requested' | 'not_friend' | 'blocked' | 'sending_disabled'
    | 'account_unavailable' | 'not_confirmed' | 'send_failed';
};
/** 予約の保存後に呼ぶ。通知の失敗で予約を巻き戻さず、例外本文も返さない。 */
export async function sendRestaurantLineConfirmation(c: Context<Env>, input: {
  reservationId: string;
  storeId: string;
  tenantId: string;
  lineUid: string | null;
  startsAt: string;
  endsAt: string;
  guestCount: number;
  courseId: string | null;
  status: string;
}): Promise<RestaurantLineNotice> {
  try {
    if (!input.lineUid) return { sent: false, reason: 'not_friend' };
    if (input.status !== 'confirmed') return { sent: false, reason: 'not_confirmed' };
    const db = dbFor(c.env, input.storeId);
    const store = await db.prepare(`SELECT s.name, s.timezone, s.line_account_id,
        a.channel_access_token, a.channel_access_token_encrypted
      FROM rt_stores s JOIN line_accounts a ON a.id = s.line_account_id
      JOIN tenants t ON t.id = COALESCE(a.tenant_id, ?)
      WHERE s.id = ? AND COALESCE(a.tenant_id, ?) = ?
        AND a.is_active = 1 AND a.archived_at IS NULL AND t.status = 'active'`)
      .bind(DEFAULT_TENANT_ID, input.storeId, DEFAULT_TENANT_ID, input.tenantId)
      .first<{ name: string; timezone: string; line_account_id: string;
        channel_access_token: string | null; channel_access_token_encrypted: string | null }>();
    if (!store) return { sent: false, reason: 'account_unavailable' };
    // 電話番号や別アカウントの同じUIDから送り先を推定しない。
    const friend = await db.prepare('SELECT is_following FROM friends WHERE line_user_id = ? AND line_account_id = ?')
      .bind(input.lineUid, store.line_account_id).first<{ is_following: number }>();
    if (!friend) return { sent: false, reason: 'not_friend' };
    if (friend.is_following !== 1) return { sent: false, reason: 'blocked' };
    if (await isOperationCapabilityStopped(db, store.line_account_id, 'broadcast_dispatch')) {
      return { sent: false, reason: 'sending_disabled' };
    }
    const course = input.courseId ? await db.prepare('SELECT name FROM rt_menu_items WHERE id = ? AND store_id = ?')
      .bind(input.courseId, input.storeId).first<{ name: string }>() : null;
    const startsAt = formatStartsAtForStore(input.startsAt, store.timezone);
    const endsAt = formatStartsAtForStore(input.endsAt, store.timezone);
    const text = `予約が確定しました。\n店舗: ${store.name}\n日時: ${startsAt}〜${endsAt}\n人数: ${input.guestCount}名\nコース: ${course?.name ?? '席のみ'}\n\n変更・キャンセルはお店に直接ご連絡ください。`;
    const token = await resolveLineCredential(store.channel_access_token_encrypted, store.channel_access_token,
      { lineAccountId: store.line_account_id, field: 'channel_access_token' }, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
    if (!token) return { sent: false, reason: 'account_unavailable' };
    let executionCtx: ExecutionContext | undefined;
    try { executionCtx = c.executionCtx; } catch { /* 単体試験では省略できる */ }
    // 自動通知としてHarnessを通す。緊急停止を最後の送信直前にも判定し、履歴を残す。
    await pushViaHarnessProxy(c.env.WORKER_PUBLIC_URL || c.env.WORKER_URL || new URL(c.req.url).origin,
      token, input.lineUid, [{ type: 'text', text }], input.reservationId,
      request => dispatchLineProxyLocally(request, c.env, executionCtx));
    return { sent: true, reason: null };
  } catch {
    return { sent: false, reason: 'send_failed' };
  }
}
