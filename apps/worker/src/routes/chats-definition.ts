import { tracedFetch as fetch } from '@line-crm/shared/server';
import { inputError } from '../lib/input-errors.js';
import type { Context } from 'hono';
import { getChatById, getFriendById, getLineAccountById, type InboxSavedViewConditions, type SavedSearchAccess, type ScheduledChatSendRow, jstNow } from '@line-crm/db';


import type { Env } from '../worker-env.js';
import { resolveLineToken } from '../services/line-token.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

export type InboxSavedViewAccess = SavedSearchAccess & { canSeeUnassigned: boolean };

export async function inboxSavedViewAccess(c: Context<Env>): Promise<InboxSavedViewAccess | Response> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return inputError(c, { success: false, error: 'LINE公式アカウントを選んでください' }, 400, ["lineAccountId"]);
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  }
  const staff = c.get('staff');
  return {
    lineAccountId,
    staffId: staff.id,
    canManageAll: staff.role === 'owner' || staff.role === 'admin',
    canSeeUnassigned: scope.canSeeUnassigned,
  };
}

export async function requireVisibleChat(c: Context<Env>, next: () => Promise<void>) {
  // Let the route return its stable 400 response without touching D1. No send or
  // record mutation is possible until a valid idempotency key is present.
  if (c.req.path.endsWith('/send')
    && !isValidIdempotencyKey(c.req.header('Idempotency-Key')?.trim())) {
    await next();
    return;
  }
  const id = c.req.param('id')!;
  const chat = await getChatById(c.env.DB, id);
  const friend = await getFriendById(c.env.DB, chat?.friend_id ?? id);
  const lineAccountId = (chat as { line_account_id?: string | null } | null)?.line_account_id
    ?? friend?.line_account_id
    ?? null;
  if ((!chat && !friend) || !await canAccessAllLineAccounts(
    c.env.DB,
    c.get('staff'),
    [lineAccountId],
  )) {
    return c.json({ success: false, error: 'Chat not found' }, 404);
  }
  await next();
}

export function clampLoadingSeconds(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : 5;
  return Math.min(60, Math.max(5, n));
}

export async function startLoadingAnimation(
  accessToken: string,
  chatId: string,
  loadingSeconds: number,
): Promise<void> {
  const response = await fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId, loadingSeconds }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      detail
        ? `LINE API error: ${response.status} - ${detail}`
        : `LINE API error: ${response.status}`,
    );
  }
}

export type ChatLike = {
  id: string;
  friend_id: string;
  operator_id: string | null;
  status: string;
  notes: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

export const EMPTY_INBOX_SAVED_VIEW_CONDITIONS: InboxSavedViewConditions = {
  version: 1,
  query: '',
  channels: ['line', 'email'],
  statuses: ['unread', 'in_progress', 'on_hold', 'resolved'],
  assignees: [],
  unread: 'all',
  quickFilter: 'all',
  messageTypes: [],
  receivedFrom: null,
  receivedTo: null,
  sort: 'newest',
  due: 'all',
};

export // id は chats.id もしくは friend.id のどちらか。friend.id のときは chats 行を遅延作成する。
// push / broadcast / scenario 配信だけを受けた友だちもチャット画面に現れるため、ここで lazy create が必要。
// 新規作成する場合は status='resolved' にし、last_message_at は messages_log の実際の最終時刻を使う
// （jstNow を入れると一覧並び順が壊れるため）。
async function resolveOrCreateChat(db: D1Database, id: string): Promise<ChatLike | null> {
  const existing = await getChatById(db, id);
  if (existing) return existing as ChatLike;
  const friend = await getFriendById(db, id);
  if (!friend) return null;
  // 最新行を選ぶ (unanswered-inbox / conversations の latest_chat CTE と同じ基準)。
  // 最古行を選ぶと、旧重複データがある DB で読み手と別の行に status を書いてしまう。
  const byFriend = await db
    .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(friend.id)
    .first<ChatLike>();
  if (byFriend) return byFriend;

  const lastMsg = await db
    .prepare(
      `SELECT MAX(created_at) AS last FROM messages_log WHERE friend_id = ? AND (delivery_type IS NULL OR delivery_type != 'test')`,
    )
    .bind(friend.id)
    .first<{ last: string | null }>();
  const newId = crypto.randomUUID();
  const now = jstNow();
  const lastMessageAt = lastMsg?.last ?? null;
  // 同時実行で二重挿入されないように WHERE NOT EXISTS + OR IGNORE で原子挿入。
  // 挿入結果に関わらず最新行を返して収束。
  await db
    .prepare(
      `INSERT OR IGNORE INTO chats (id, friend_id, status, last_message_at, created_at, updated_at)
       SELECT ?, ?, 'resolved', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM chats WHERE friend_id = ?)`,
    )
    .bind(newId, friend.id, lastMessageAt, now, now, friend.id)
    .run();
  return (await db
    .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(friend.id)
    .first<ChatLike>())!;
}

export type QuotedMessageRow = {
  id: string;
  direction: string;
  message_type: string;
  content: string;
  quote_token: string | null;
};

export /**
 * 引用元の検証。同じfriend・同じLINEアカウント・取消されていない
 * メッセージだけを引用できる。別アカウント・別friendの行を指定されても
 * 「無い」と同じ扱いにし、存在自体を外へ漏らさない。
 */
async function resolveQuotedMessage(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId: string | null;
    quotedMessageId: string;
  },
): Promise<QuotedMessageRow | null> {
  return db
    .prepare(
      `SELECT id, direction, message_type, content, quote_token
         FROM messages_log
        WHERE id = ? AND friend_id = ?
          AND line_account_id IS ?
          AND unsent_at IS NULL
          AND (delivery_type IS NULL OR delivery_type != 'test')`,
    )
    .bind(input.quotedMessageId, input.friendId, input.lineAccountId)
    .first<QuotedMessageRow>();
}

export /** 予約行を画面用の形へ写す。内部のlease情報は返さない。 */
function scheduledSendResponse(row: ScheduledChatSendRow) {
  return {
    id: row.id,
    messageType: row.message_type,
    content: row.content,
    quotedMessageId: row.quoted_message_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
  };
}

export async function resolveFriendAndAccessToken(
  db: D1Database,
  friendId: string,
  defaultAccessToken: string,
  context: string,
) {
  const friend = await getFriendById(db, friendId);
  if (!friend) {
    return { friend: null, accessToken: defaultAccessToken, liffId: null };
  }

  if (!friend.line_account_id) {
    return { friend, accessToken: resolveLineToken({
      accountToken: null, defaultToken: defaultAccessToken,
      accountId: friend.line_account_id, context,
    }), liffId: null };
  }

  const account = await getLineAccountById(db, friend.line_account_id);
  if (!account) {
    return { friend, accessToken: resolveLineToken({
      accountToken: null, defaultToken: defaultAccessToken,
      accountId: friend.line_account_id, context,
    }), liffId: null };
  }

  return { friend, accessToken: account.channel_access_token, liffId: account.liff_id ?? null };
}
