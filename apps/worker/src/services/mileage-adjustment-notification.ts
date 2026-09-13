import type { Context } from 'hono';
import {
  markMileageAdjustmentNotification,
  reserveMileageAdjustmentNotification,
  resolveLineCredential,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { dispatchLineProxyLocally } from './local-line-proxy.js';
import { pushViaHarnessProxy } from './line-proxy-send.js';

type NotificationFriend = {
  id: string;
  line_user_id: string;
  is_following: number;
  channel_access_token: string | null;
  channel_access_token_encrypted: string | null;
};

export function mileageAdjustmentMessage(input: {
  direction: 'increase' | 'decrease';
  amount: number;
  balanceAfter: number;
  expiresAt?: string | null;
}): string {
  const change = input.direction === 'increase' ? '増えました' : '減りました';
  const expiration = input.expiresAt
    ? `\nこのマイルの有効期限: ${new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(input.expiresAt))}`
    : '';
  return [
    `マイルが${input.amount.toLocaleString('ja-JP')} mile ${change}。`,
    `現在の利用可能残高は ${input.balanceAfter.toLocaleString('ja-JP')} mile です。${expiration}`,
  ].join('\n');
}

/**
 * 手動調整後の自動通知。調整自体は既に確定しているため、送信失敗で台帳を
 * 巻き戻さず failed を監査へ残す。同じ台帳行を再送しても二重送信しない。
 */
export async function sendMileageAdjustmentNotification(
  c: Context<Env>,
  input: {
    lineAccountId: string;
    friendId: string;
    ledgerEntryId: string;
    idempotencyKey: string;
    message: string;
  },
) {
  const reserved = await reserveMileageAdjustmentNotification(c.env.DB, input);
  if (reserved.status === 'sent') return reserved;
  try {
    const friend = await c.env.DB.prepare(
      `SELECT f.id, f.line_user_id, f.is_following,
              a.channel_access_token, a.channel_access_token_encrypted
         FROM friends f JOIN line_accounts a ON a.id = f.line_account_id
        WHERE f.id = ? AND f.line_account_id = ?`,
    ).bind(input.friendId, input.lineAccountId).first<NotificationFriend>();
    if (!friend || !friend.is_following || !friend.line_user_id) {
      return markMileageAdjustmentNotification(c.env.DB, {
        id: reserved.id, status: 'failed', errorCode: 'friend_unavailable',
      });
    }
    const accessToken = await resolveLineCredential(
      friend.channel_access_token_encrypted,
      friend.channel_access_token,
      { lineAccountId: input.lineAccountId, field: 'channel_access_token' },
    );
    const sent = await pushViaHarnessProxy(
      c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin,
      accessToken,
      friend.line_user_id,
      [{ type: 'text', text: input.message }],
      input.idempotencyKey,
      (request) => dispatchLineProxyLocally(request, c.env, c.executionCtx),
    );
    return markMileageAdjustmentNotification(c.env.DB, {
      id: reserved.id, status: 'sent', lineRequestId: sent.requestId,
    });
  } catch {
    return markMileageAdjustmentNotification(c.env.DB, {
      id: reserved.id, status: 'failed', errorCode: 'delivery_failed',
    });
  }
}
