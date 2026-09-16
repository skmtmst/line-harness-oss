import { Hono } from 'hono';
import type { Context } from 'hono';
import type { FlexContainer, Message } from '@line-crm/line-sdk';
import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getOperators,
  getOperatorById,
  createOperator,
  updateOperator,
  deleteOperator,
  getChats,
  getChatById,
  createChat,
  getFriendById,
  getLineAccountById,
  updateChat,
  markInboxConversationRead,
  getSavedSearches,
  getSavedSearchById,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  validateInboxSavedViewConditions,
  type InboxSavedViewConditions,
  type SavedSearch,
  type SavedSearchAccess,
  createScheduledChatSend,
  listPendingScheduledChatSends,
  cancelScheduledChatSend,
  updateScheduledChatSend,
  normalizeScheduledAt,
  type ScheduledChatSendRow,
  jstNow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { listLimit } from './list-pagination.js';
import { resolveLineToken } from '../services/line-token.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  classifyLineOutboundFailure,
  completeOutboundSendStatement,
  failOutboundSend,
  hashOutboundPayload,
  isValidIdempotencyKey,
  listOutboundSendFailures,
  reserveOutboundSend,
} from '../services/outbound-idempotency.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import {
  inboxEventStatement,
  inboxNoteStatement,
  isInboxStatus,
  acquireInboxReplyLease,
  releaseInboxReplyLease,
} from '../services/inbox-events.js';
import { fireEvent } from '../services/event-bus.js';

const chats = new Hono<Env>();

type InboxSavedViewAccess = SavedSearchAccess & { canSeeUnassigned: boolean };

async function inboxSavedViewAccess(c: Context<Env>): Promise<InboxSavedViewAccess | Response> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
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

async function requireVisibleChat(c: Context<Env>, next: () => Promise<void>) {
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

function clampLoadingSeconds(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : 5;
  return Math.min(60, Math.max(5, n));
}

async function startLoadingAnimation(
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

type ChatLike = {
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

function serializeInboxSavedView(
  row: SavedSearch,
  count?: { matchCount: number; matchCountCapped: boolean },
) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    conditions: JSON.parse(row.conditions_json) as unknown,
    createdBy: row.created_by,
    lineAccountId: row.line_account_id,
    isShared: Boolean(row.is_shared),
    displayOrder: row.display_order,
    isFavorite: row.display_order < 0,
    createdAt: row.created_at,
    matchCount: count?.matchCount ?? null,
    matchCountCapped: count?.matchCountCapped ?? false,
  };
}

async function countInboxSavedViewMatches(
  db: D1Database,
  input: {
    lineAccountId: string;
    staffId: string;
    canSeeUnassigned: boolean;
    conditions: InboxSavedViewConditions;
  },
): Promise<{ matchCount: number; matchCountCapped: boolean }> {
  const where: string[] = [
    'f.line_account_id = ?',
    `(c.id IS NOT NULL OR EXISTS (
      SELECT 1 FROM messages_log existing
       WHERE existing.friend_id = f.id
         AND (existing.delivery_type IS NULL OR existing.delivery_type != 'test')
    ))`,
  ];
  const bindings: unknown[] = [input.lineAccountId];
  const conditions = input.conditions;

  if (conditions.statuses.length < 4) {
    where.push(`COALESCE(c.status, 'resolved') IN (${conditions.statuses.map(() => '?').join(', ')})`);
    bindings.push(...conditions.statuses);
  }
  if (conditions.assignees.length > 0) {
    const named = conditions.assignees.filter((id) => id !== 'unassigned');
    const clauses: string[] = [];
    if (conditions.assignees.includes('unassigned')) clauses.push('c.operator_id IS NULL');
    if (named.length > 0) {
      clauses.push(`c.operator_id IN (${named.map(() => '?').join(', ')})`);
      bindings.push(...named);
    }
    where.push(`(${clauses.join(' OR ')})`);
  }
  if (conditions.query) {
    where.push(`(f.display_name LIKE ? OR EXISTS (
      SELECT 1 FROM messages_log searched
       WHERE searched.friend_id = f.id
         AND (searched.delivery_type IS NULL OR searched.delivery_type != 'test')
         AND searched.content LIKE ?
    ))`);
    const like = `%${conditions.query}%`;
    bindings.push(like, like);
  }
  if (conditions.unread === 'mine') {
    where.push(`EXISTS (
      SELECT 1 FROM messages_log incoming
       WHERE incoming.friend_id = f.id AND incoming.direction = 'incoming'
         AND (incoming.delivery_type IS NULL OR incoming.delivery_type != 'test')
         AND (sr.last_read_at IS NULL OR incoming.created_at > sr.last_read_at)
    )`);
  }
  if (conditions.messageTypes.length > 0) {
    where.push(`(
      SELECT latest.message_type FROM messages_log latest
       WHERE latest.friend_id = f.id
         AND (latest.delivery_type IS NULL OR latest.delivery_type != 'test')
       ORDER BY latest.created_at DESC LIMIT 1
    ) IN (${conditions.messageTypes.map(() => '?').join(', ')})`);
    bindings.push(...conditions.messageTypes);
  }
  if (conditions.receivedFrom) {
    where.push(`EXISTS (
      SELECT 1 FROM messages_log received
       WHERE received.friend_id = f.id AND received.direction = 'incoming'
         AND received.created_at >= ?
         AND (received.delivery_type IS NULL OR received.delivery_type != 'test')
    )`);
    bindings.push(conditions.receivedFrom);
  }
  if (conditions.receivedTo) {
    where.push(`EXISTS (
      SELECT 1 FROM messages_log received
       WHERE received.friend_id = f.id AND received.direction = 'incoming'
         AND received.created_at <= ?
         AND (received.delivery_type IS NULL OR received.delivery_type != 'test')
    )`);
    bindings.push(conditions.receivedTo);
  }
  if (conditions.due === 'overdue') {
    where.push(`COALESCE(c.status, 'resolved') = 'unread'`);
    where.push(`COALESCE(c.last_customer_message_at, c.last_message_at) < datetime('now', '-1 hour')`);
  }

  const lineRow = input.conditions.channels.includes('line') ? await db.prepare(
    `SELECT COUNT(*) AS count FROM (
       SELECT f.id
         FROM friends f
         LEFT JOIN chats c ON c.id = (
           SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
         )
         LEFT JOIN inbox_staff_reads sr
           ON sr.channel = 'line' AND sr.conversation_id = f.id AND sr.staff_id = ?
        WHERE ${where.join(' AND ')}
        LIMIT 1001
     )`,
  ).bind(input.staffId, ...bindings).first<{ count: number }>() : null;

  const emailWhere: string[] = [];
  const emailBindings: unknown[] = [];
  if (conditions.statuses.length < 4) {
    emailWhere.push(`t.status IN (${conditions.statuses.map(() => '?').join(', ')})`);
    emailBindings.push(...conditions.statuses);
  }
  if (conditions.assignees.length > 0) {
    const named = conditions.assignees.filter((id) => id !== 'unassigned');
    const clauses: string[] = [];
    if (conditions.assignees.includes('unassigned')) clauses.push('t.assigned_staff_id IS NULL');
    if (named.length > 0) {
      clauses.push(`t.assigned_staff_id IN (${named.map(() => '?').join(', ')})`);
      emailBindings.push(...named);
    }
    emailWhere.push(`(${clauses.join(' OR ')})`);
  }
  if (conditions.query) {
    emailWhere.push(`(t.customer_email LIKE ? OR t.customer_name LIKE ? OR t.subject LIKE ? OR EXISTS (
      SELECT 1 FROM support_email_messages searched
       WHERE searched.thread_id = t.id AND searched.body_text LIKE ?
    ))`);
    const like = `%${conditions.query}%`;
    emailBindings.push(like, like, like, like);
  }
  if (conditions.unread === 'mine') {
    emailWhere.push('(sr.last_read_at IS NULL OR t.last_incoming_at > sr.last_read_at)');
  }
  if (conditions.messageTypes.length > 0 && !conditions.messageTypes.includes('text')) {
    emailWhere.push('0=1');
  }
  if (conditions.receivedFrom) {
    emailWhere.push('t.last_incoming_at >= ?');
    emailBindings.push(conditions.receivedFrom);
  }
  if (conditions.receivedTo) {
    emailWhere.push('t.last_incoming_at <= ?');
    emailBindings.push(conditions.receivedTo);
  }
  if (conditions.due === 'overdue') {
    emailWhere.push(`t.status = 'unread'`);
    emailWhere.push(`t.last_incoming_at < datetime('now', '-1 hour')`);
  }
  const emailRow = input.conditions.channels.includes('email') && input.canSeeUnassigned
    ? await db.prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT t.id
           FROM support_email_threads t
           LEFT JOIN inbox_staff_reads sr
             ON sr.channel = 'email' AND sr.conversation_id = t.id AND sr.staff_id = ?
          ${emailWhere.length > 0 ? `WHERE ${emailWhere.join(' AND ')}` : ''}
          LIMIT 1001
       )`,
    ).bind(input.staffId, ...emailBindings).first<{ count: number }>()
    : null;
  const rawCount = Number(lineRow?.count ?? 0) + Number(emailRow?.count ?? 0);
  return { matchCount: Math.min(rawCount, 1000), matchCountCapped: rawCount > 1000 };
}

const EMPTY_INBOX_SAVED_VIEW_CONDITIONS: InboxSavedViewConditions = {
  version: 1,
  query: '',
  channels: ['line', 'email'],
  statuses: ['unread', 'in_progress', 'on_hold', 'resolved'],
  assignees: [],
  unread: 'all',
  messageTypes: [],
  receivedFrom: null,
  receivedTo: null,
  sort: 'newest',
  due: 'all',
};

// id は chats.id もしくは friend.id のどちらか。friend.id のときは chats 行を遅延作成する。
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

type QuotedMessageRow = {
  id: string;
  direction: string;
  message_type: string;
  content: string;
  quote_token: string | null;
};

/**
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

/** 予約行を画面用の形へ写す。内部のlease情報は返さない。 */
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

async function resolveFriendAndAccessToken(
  db: D1Database,
  friendId: string,
  defaultAccessToken: string,
  context: string,
) {
  const friend = await getFriendById(db, friendId);
  if (!friend) {
    return { friend: null, accessToken: defaultAccessToken };
  }

  if (!friend.line_account_id) {
    return { friend, accessToken: resolveLineToken({
      accountToken: null, defaultToken: defaultAccessToken,
      accountId: friend.line_account_id, context,
    }) };
  }

  const account = await getLineAccountById(db, friend.line_account_id);
  if (!account) {
    return { friend, accessToken: resolveLineToken({
      accountToken: null, defaultToken: defaultAccessToken,
      accountId: friend.line_account_id, context,
    }) };
  }

  return { friend, accessToken: account.channel_access_token };
}

// ========== オペレーターCRUD ==========

chats.get('/api/operators', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const items = await getOperators(c.env.DB);
    return c.json({
      success: true,
      data: items.map((o) => ({
        id: o.id,
        name: o.name,
      })),
    });
  } catch (err) {
    console.error('GET /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/operators', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; role?: string }>();
    if (!body.name || !body.email) return c.json({ success: false, error: 'name and email are required' }, 400);
    const item = await createOperator(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, email: item.email, role: item.role } }, 201);
  } catch (err) {
    console.error('POST /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.put('/api/operators/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateOperator(c.env.DB, id, body);
    const updated = await getOperatorById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.delete('/api/operators/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteOperator(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== チャットCRUD ==========

/**
 * 受信箱の上部に出す数（設計 `V2 2-1 受信箱` の KPIs）。
 *
 * :id より先に置く。あとに置くと 'stats' が id として解釈される。
 */
chats.get('/api/chats/stats', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const { getInboxStats } = await import('@line-crm/db');
    const { getVisibleLineAccountScope } = await import('../services/account-access.js');
    const staff = c.get('staff');
    const accountScope = await getVisibleLineAccountScope(c.env.DB, staff);
    const stats = await getInboxStats(c.env.DB, staff?.id ?? null, {
      allowedAccountIds: accountScope.allowedAccountIds,
      includeUnassigned: accountScope.canSeeUnassigned,
    });
    return c.json({ success: true as const, data: stats });
  } catch (err) {
    console.error('GET /api/chats/stats error:', err);
    return c.json({ success: false as const, error: '受信箱の集計を取得できませんでした' }, 500);
  }
});

/** 個別送信の失敗台帳。必ずLINEアカウントを指定し、担当範囲の中だけ返す。 */
chats.get('/api/chats/outbound-failures', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: '送信失敗履歴が見つかりません' }, 404);
    }
    const failures = await listOutboundSendFailures(c.env.DB, {
      lineAccountId,
      limit: listLimit(c.req.query('limit'), 50, 100),
    });
    return c.json({ success: true, data: failures });
  } catch (err) {
    console.error('GET /api/chats/outbound-failures error:', err);
    return c.json({ success: false, error: '送信失敗履歴を取得できませんでした' }, 500);
  }
});

chats.get('/api/chats', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff');
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const unreadOnly = c.req.query('unreadOnly') === '1' || c.req.query('unreadOnly') === 'true';
    const quickFilter = c.req.query('quickFilter');
    if (quickFilter && quickFilter !== 'reply' && quickFilter !== 'overdue') {
      return c.json({ success: false, error: 'invalid_quick_filter' }, 400);
    }
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const query = (c.req.query('q') ?? '').trim().slice(0, 200);
    const visibleScope = await getVisibleLineAccountScope(c.env.DB, staff);
    if (lineAccountId && !visibleScope.allowedAccountIds.includes(lineAccountId)) {
      return c.json({ success: false, error: '受信箱が見つかりません' }, 404);
    }
    const unansweredOnly =
      c.req.query('unansweredOnly') === 'true' || c.req.query('unansweredOnly') === '1';

    if (unansweredOnly) {
      if (unreadOnly || quickFilter || operatorId === 'unassigned') {
        return c.json({ success: false, error: 'incompatible_filters' }, 400);
      }
      const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(200, Math.max(1, requestedLimit))
        : 200;
      const { computeUnansweredInbox } = await import('../services/unanswered-inbox.js');
      const unanswered = await computeUnansweredInbox(c.env.DB, {
        q: query || undefined,
        account: lineAccountId,
        status,
        operatorId,
        page: 1,
        pageSize: limit,
        allowedAccountIds: visibleScope.allowedAccountIds,
        canSeeUnassigned: visibleScope.canSeeUnassigned,
      });
      if (unanswered.rows.length === 0) return c.json({ success: true, data: [] });

      // 未対応サービスで確定した最大200人だけの会話メタ情報を取る。
      // json_each へID配列を1 bindで渡すため、D1の100 bind上限にも当たらない。
      const chatRows = await c.env.DB.prepare(
        `SELECT f.id AS friend_id, f.display_name, f.picture_url,
                c.operator_id, c.status, c.revision, c.notes,
                CASE
                  WHEN c.last_customer_message_at IS NOT NULL
                   AND (sr.last_read_at IS NULL OR c.last_customer_message_at > sr.last_read_at)
                  THEN 1 ELSE 0
                END AS is_unread_for_staff,
                c.created_at, c.updated_at
           FROM friends f
           INNER JOIN chats c ON c.friend_id = f.id
           LEFT JOIN inbox_staff_reads sr
             ON sr.channel = 'line'
            AND sr.conversation_id = f.id
            AND sr.staff_id = ?
          WHERE f.id IN (SELECT value FROM json_each(?))`,
      ).bind(staff.id, JSON.stringify(unanswered.rows.map((row) => row.friendId))).all<Record<string, unknown>>();
      const byFriend = new Map(chatRows.results.map((row) => [row.friend_id as string, row]));
      const data = unanswered.rows.flatMap((row) => {
        const chat = byFriend.get(row.friendId);
        if (!chat) return [];
        return [{
          id: row.friendId,
          friendId: row.friendId,
          friendName: row.displayName || '名前なし',
          friendPictureUrl: row.pictureUrl,
          operatorId: chat.operator_id,
          status: chat.status,
          revision: Number(chat.revision ?? 0),
          notes: chat.notes,
          lastMessageAt: row.lastIncomingAt,
          lastMessageContent: row.lastIncomingType === 'text' ? row.lastIncomingContent : null,
          lastMessageDirection: 'incoming' as const,
          lastMessageType: row.lastIncomingType,
          isUnread: Boolean(chat.is_unread_for_staff),
          createdAt: chat.created_at,
          updatedAt: chat.updated_at,
        }];
      });
      return c.json({ success: true, data });
    }

    // List everyone who has any message history (incoming or outgoing — push/broadcast/scenario included)
    // PLUS any chats row that exists even before any messages_log entry is written.
    // Source = messages_log ∪ chats.friend_id; chats は status/operator/notes 用に LEFT JOIN で最新1件だけ採用。
    //
    // recent_msg CTE で friend_id ごとに最新の messages_log 行をひとつ取得し、本文 preview と
    // direction (incoming/outgoing) を一覧に出す。
    //
    // パフォーマンス対策 (2026-07-06 本番実測で全面改修):
    //   旧実装は messages_log (96k 行) を ROW_NUMBER × 2 + GROUP BY で 3 回スキャンし、
    //   さらに LIMIT なしで全 friend (10k 行) を返していた → 本番 D1 実測 3.47 秒 / 781k rows_read。
    //   新実装は (a) ROW_NUMBER を argmax GROUP BY に置換 (SQLite の bare-column +
    //   単一 MAX() は max 行の値を返す documented 挙動)、(b) CTE を MATERIALIZED して
    //   二重評価を防止、(c) page CTE で先に対象 friend を limit 件に確定してから
    //   preview を計算、(d) デフォルト LIMIT 200 (最終行は last_message_at DESC)。
    //   同条件の本番実測: 459ms / 165k rows_read (旧 LIMIT 300 時)。
    //   - content は text のみ先頭 200 文字まで切り詰めて返す (flex/image など raw JSON を
    //     返すと broadcast 後の rows で multi-MB レスポンスになる)。
    //   - lineAccountId 指定時は messages_log スキャンを対象アカの friend に絞る。
    const accountFilterBindings: string[] = [];
    let accountFilterSql: string;
    if (lineAccountId) {
      accountFilterSql = `friend_id IN (SELECT id FROM friends WHERE line_account_id = ?)`;
      accountFilterBindings.push(lineAccountId);
    } else {
      const accountClauses: string[] = [];
      if (visibleScope.allowedAccountIds.length > 0) {
        accountClauses.push(
          `line_account_id IN (${visibleScope.allowedAccountIds.map(() => '?').join(', ')})`,
        );
        accountFilterBindings.push(...visibleScope.allowedAccountIds);
      }
      if (visibleScope.canSeeUnassigned) accountClauses.push('line_account_id IS NULL');
      accountFilterSql = accountClauses.length > 0
        ? `friend_id IN (SELECT id FROM friends WHERE ${accountClauses.join(' OR ')})`
        : '0=1';
    }

    // 不正値や負値を SQLite の「LIMIT 無制限」に渡さず、未対応絞り込みも含めて
    // 1回の応答を最大200件に止める。未対応一覧は上の専用DBページングで扱う。
    const limit = listLimit(c.req.query('limit'), 200);
    // カーソルページング: (last_message_at, friend_id) の複合カーソルより古い行を返す。
    // offset 方式は「取得の合間に新着で行が押し下げられた分が欠落する」構造問題が
    // あるため採用しない。friend_id は同時刻 (broadcast 一斉配信等) のタイブレーク。
    const beforeAt = c.req.query('beforeAt') || undefined;
    const beforeId = c.req.query('beforeId') || undefined;
    const useCursor = Boolean(beforeAt && beforeId);

    const conditions: string[] = [];
    const conditionBindings: unknown[] = [];
    if (status) {
      conditions.push(`COALESCE(c.status, 'resolved') = ?`);
      conditionBindings.push(status);
    }
    if (operatorId) {
      if (operatorId === 'unassigned') conditions.push('c.operator_id IS NULL');
      else {
        conditions.push('c.operator_id = ?');
        conditionBindings.push(operatorId);
      }
    }
    if (unreadOnly) {
      conditions.push(`EXISTS (
        SELECT 1 FROM messages_log incoming
        LEFT JOIN inbox_staff_reads reads
          ON reads.channel = 'line' AND reads.conversation_id = f.id AND reads.staff_id = ?
        WHERE incoming.friend_id = f.id AND incoming.direction = 'incoming'
          AND (incoming.delivery_type IS NULL OR incoming.delivery_type != 'test')
          AND (reads.last_read_at IS NULL OR incoming.created_at > reads.last_read_at)
      )`);
      conditionBindings.push(staff.id);
    }
    if (quickFilter) {
      conditions.push(`COALESCE(c.status, 'resolved') = 'unread'`);
      if (quickFilter === 'overdue') {
        // Keep the existing UI definition: one hour since the displayed latest message.
        conditions.push(`julianday(COALESCE((
          SELECT MAX(latest.created_at) FROM messages_log latest
          WHERE latest.friend_id = f.id
            AND (latest.delivery_type IS NULL OR latest.delivery_type != 'test')
        ), d.last_message_at)) <= julianday(?)`);
        conditionBindings.push(new Date(Date.now() - 60 * 60 * 1000).toISOString());
      }
    }
    if (lineAccountId) {
      conditions.push('f.line_account_id = ?');
      conditionBindings.push(lineAccountId);
    }
    if (query) {
      conditions.push(`(
        f.display_name LIKE ? OR EXISTS (
          SELECT 1 FROM messages_log mq
          WHERE mq.friend_id = f.id
            AND (mq.delivery_type IS NULL OR mq.delivery_type != 'test')
            AND mq.content LIKE ?
        )
      )`);
      const like = `%${query}%`;
      conditionBindings.push(like, like);
    }
    // status / operator filter は chats を参照するので、その時だけ page CTE 側でも
    // chats を lookup する (無条件時は 全friend × chats lookup を省く)。
    const pageNeedsChats = Boolean(status || operatorId || quickFilter);

    // preview は **最新の incoming (ユーザー発)** を優先する。auto_reply / scenario 等の
    // outbound が直後に書き込まれて preview を上書きすると「ユーザーが何と言ったか」が
    // 一覧から見えなくなる (operator triage の主目的が損なわれる)。
    // incoming が無い (broadcast push など outbound only) chat は最新 outbound にフォールバック。
    // text 以外 (flex/image/sticker 等) は content を NULL にして payload size を抑える
    // (フロントは type で 📋 Flex / 📷 画像 等のラベルを出すので content は不要)。
    // any_agg の bare column (content 等) は「単一 MAX() を含む集約は max 行の
    // 値を返す」という SQLite の documented 挙動で argmax として使っている。
    // 集約は page 確定後の friend に絞って実行する (全 friend 分の content を
    // materialize しない)。last_any は並び順決定専用のスリムな全走査 1 回のみ。
    const sql = `
      WITH last_any AS MATERIALIZED (
        SELECT friend_id, MAX(created_at) AS last_message_at
        FROM messages_log
        WHERE (delivery_type IS NULL OR delivery_type != 'test')
          AND ${accountFilterSql}
        GROUP BY friend_id
      ),
      deduped AS MATERIALIZED (
        SELECT friend_id, MAX(last_message_at) AS last_message_at FROM (
          SELECT friend_id, last_message_at FROM last_any
          UNION ALL
          SELECT friend_id, last_message_at FROM chats WHERE ${accountFilterSql}
        ) GROUP BY friend_id
      ),
      page AS MATERIALIZED (
        SELECT d.friend_id, d.last_message_at
        FROM deduped d
        INNER JOIN friends f ON f.id = d.friend_id
        ${pageNeedsChats ? `LEFT JOIN chats c ON c.id = (
          SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
        )` : ''}
        WHERE 1=1
        ${conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : ''}
        ${useCursor ? 'AND (d.last_message_at < ? OR (d.last_message_at = ? AND d.friend_id < ?))' : ''}
        ORDER BY d.last_message_at DESC, d.friend_id DESC
        LIMIT ?
      ),
      any_agg AS (
        SELECT friend_id,
          CASE
            WHEN unsent_at IS NOT NULL THEN NULL
            WHEN message_type = 'text' THEN SUBSTR(content, 1, 200)
            ELSE NULL
          END AS content,
          direction,
          CASE WHEN unsent_at IS NOT NULL THEN 'unsent' ELSE message_type END AS message_type,
          MAX(created_at) AS created_at
        FROM messages_log
        WHERE (delivery_type IS NULL OR delivery_type != 'test')
          AND friend_id IN (SELECT friend_id FROM page)
        GROUP BY friend_id
      ),
      latest_incoming AS (
        SELECT friend_id, MAX(created_at) AS last_incoming_at
        FROM messages_log
        WHERE direction = 'incoming'
          AND (delivery_type IS NULL OR delivery_type != 'test')
          AND friend_id IN (SELECT friend_id FROM page)
        GROUP BY friend_id
      ),
      /*
       * 一覧に出す1行は「最後のメッセージ」。送信でも受信でも、いちばん新しいもの。
       *
       * 以前は受信を優先していた（incoming があればそちらを出す）。そのせいで、
       * こちらが返信したあとも一覧には古い受信が出たままで、返したのかどうかが
       * 一覧から読めなかった。
       *
       * 「返信を待っている人」の判定は unanswered-inbox サービスが別に持っている
       * ので、ここを最新に変えても未対応の数え方は変わらない。
       */
      recent_msg AS (
        SELECT a.friend_id,
          a.content AS content,
          a.direction AS direction,
          a.message_type AS message_type,
          a.created_at AS preview_at
        FROM any_agg a
      )
      SELECT
        f.id AS id,
        f.id AS friend_id,
        f.display_name,
        f.picture_url,
        f.line_user_id,
        f.line_account_id,
        c.operator_id,
        COALESCE(c.status, 'resolved') AS status,
        COALESCE(c.revision, 0) AS revision,
        c.notes,
        COALESCE(rm.preview_at, d.last_message_at) AS last_message_at,
        rm.content AS last_message_content,
        rm.direction AS last_message_direction,
        rm.message_type AS last_message_type,
        CASE
          WHEN ri.last_incoming_at IS NOT NULL
           AND (sr.last_read_at IS NULL OR ri.last_incoming_at > sr.last_read_at)
          THEN 1 ELSE 0
        END AS is_unread_for_staff,
        COALESCE(c.created_at, d.last_message_at) AS created_at,
        COALESCE(c.updated_at, d.last_message_at) AS updated_at
      FROM page d
      INNER JOIN friends f ON f.id = d.friend_id
      LEFT JOIN chats c ON c.id = (
        SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
      )
      LEFT JOIN recent_msg rm ON rm.friend_id = f.id
      LEFT JOIN latest_incoming ri ON ri.friend_id = f.id
      LEFT JOIN inbox_staff_reads sr
        ON sr.channel = 'line'
       AND sr.conversation_id = f.id
       AND sr.staff_id = ?
      ORDER BY d.last_message_at DESC, d.friend_id DESC
    `;

    // placeholder 順 = SQL 出現順: last_any(account) → deduped 内 chats(account) →
    // page 条件 → cursor (beforeAt ×2 + beforeId) → LIMIT。
    // any_agg は page で friend が確定済みのため account filter 不要。
    const allBindings: unknown[] = [];
    allBindings.push(...accountFilterBindings, ...accountFilterBindings);
    allBindings.push(...conditionBindings);
    if (useCursor) allBindings.push(beforeAt, beforeAt, beforeId);
    allBindings.push(limit, staff.id);
    const result = await c.env.DB.prepare(sql).bind(...allBindings).all();

    const data = result.results.map((ch: Record<string, unknown>) => ({
      id: ch.id as string,
      friendId: ch.friend_id,
      friendName: ch.display_name || '名前なし',
      friendPictureUrl: ch.picture_url || null,
      operatorId: ch.operator_id,
      status: ch.status,
      revision: Number(ch.revision ?? 0),
      notes: ch.notes,
      lastMessageAt: ch.last_message_at,
      lastMessageContent: ch.last_message_content || null,
      lastMessageDirection: ch.last_message_direction || null,
      lastMessageType: ch.last_message_type || null,
      isUnread: Boolean(ch.is_unread_for_staff),
      createdAt: ch.created_at,
      updatedAt: ch.updated_at,
    }));

    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats/:id', requireVisibleChat, async (c) => {
  try {
    const rawId = c.req.param('id')!;

    // id は chats.id または friend.id のどちらでもOK。
    // 優先順: chats.id 一致 → friend.id のとき chats.friend_id 最新行 → 何も無ければ friend のみで synthetic
    let chatRow = await getChatById(c.env.DB, rawId);
    let friendId: string | null = null;

    if (!chatRow) {
      const friendRow = await getFriendById(c.env.DB, rawId);
      if (!friendRow) return c.json({ success: false, error: 'Chat not found' }, 404);
      friendId = friendRow.id;
      // 同じ friend に紐づく chats 行があれば採用（lazy-create 後の再読みで status/notes を拾うため）
      const existing = await c.env.DB
        .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(friendRow.id)
        .first<{ id: string; friend_id: string; operator_id: string | null; status: string; notes: string | null; last_message_at: string | null; created_at: string; updated_at: string; revision: number }>();
      if (existing) {
        chatRow = existing as Awaited<ReturnType<typeof getChatById>>;
      }
    }

    const resolvedFriendId = chatRow?.friend_id ?? friendId!;
    // 公開 ID は常に friend_id に統一する（lazy-create で ID が変わるのを防ぐため）。
    const responseId = resolvedFriendId;
    const operatorId = chatRow?.operator_id ?? null;
    const status = chatRow?.status ?? 'resolved';
    const notes = chatRow?.notes ?? null;
    const revision = chatRow?.revision ?? 0;
    const lastMessageAt = chatRow?.last_message_at ?? null;
    const createdAt = chatRow?.created_at ?? null;

    const friend = await c.env.DB
      .prepare(`SELECT display_name, real_name, picture_url, line_user_id, metadata FROM friends WHERE id = ?`)
      .bind(resolvedFriendId)
      .first<{
        display_name: string | null;
        real_name: string | null;
        picture_url: string | null;
        line_user_id: string;
        metadata: string | null;
      }>();
    let friendMetadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(friend?.metadata || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        friendMetadata = parsed as Record<string, unknown>;
      }
    } catch {
      // 壊れた任意項目があっても受信箱そのものは開ける。
    }

    // 直近から limit 件ずつ返すカーソルページング。全文一括(LIMIT 1000)だと長期の
    // 会話で応答が重くなり、画像/Flex再描画時のスクロール追従も高コストになる。
    // 1件多めに取って「続きがあるか」だけ見て捨てる(limit+1方式)。
    const rawMessageLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const messageLimit = Number.isSafeInteger(rawMessageLimit)
      ? Math.min(1000, Math.max(1, rawMessageLimit))
      : 100;
    const beforeAt = c.req.query('beforeAt') || undefined;
    const beforeId = c.req.query('beforeId') || undefined;
    const useMessageCursor = Boolean(beforeAt && beforeId);
    const messageBindings: unknown[] = [resolvedFriendId];
    if (useMessageCursor) messageBindings.push(beforeAt, beforeAt, beforeId);
    messageBindings.push(messageLimit + 1);
    const messages = await c.env.DB
      .prepare(
        `SELECT messages_log.id, messages_log.friend_id, messages_log.direction, messages_log.message_type,
                CASE WHEN messages_log.unsent_at IS NOT NULL THEN '' ELSE messages_log.content END AS content,
                CASE WHEN messages_log.unsent_at IS NOT NULL THEN 1 ELSE 0 END AS is_unsent,
                messages_log.source, messages_log.origin_kind,
                messages_log.sent_by_staff_id,
                (SELECT name FROM staff_members sm WHERE sm.id = messages_log.sent_by_staff_id) AS sent_by_staff_name,
                (SELECT s.name FROM scenario_steps ss
                  JOIN scenarios s ON s.id = ss.scenario_id
                  WHERE ss.id = messages_log.scenario_step_id) AS scenario_name,
                messages_log.quoted_message_id,
                q.direction AS quoted_direction,
                q.message_type AS quoted_message_type,
                CASE WHEN q.unsent_at IS NOT NULL THEN '' ELSE q.content END AS quoted_content,
                CASE WHEN q.unsent_at IS NOT NULL THEN 1 ELSE 0 END AS quoted_is_unsent,
                q.created_at AS quoted_created_at,
                messages_log.created_at
         FROM messages_log
         LEFT JOIN messages_log q ON q.id = messages_log.quoted_message_id
         WHERE messages_log.friend_id = ? AND (messages_log.delivery_type IS NULL OR messages_log.delivery_type != 'test')
         ${useMessageCursor ? 'AND (messages_log.created_at < ? OR (messages_log.created_at = ? AND messages_log.id < ?))' : ''}
         ORDER BY messages_log.created_at DESC, messages_log.id DESC LIMIT ?`,
      )
      .bind(...messageBindings)
      .all();
    // 新しい push の欠落を防ぐため DESC で取って昇順に戻す(従来どおり)。
    const messageRows = messages.results as Record<string, unknown>[];
    const hasMoreMessages = messageRows.length > messageLimit;
    if (hasMoreMessages) messageRows.pop();
    messageRows.reverse();

    return c.json({
      success: true,
      data: {
        id: responseId,
        friendId: resolvedFriendId,
        friendName: friend?.display_name || '名前なし',
        friendRealName: friend?.real_name || null,
        friendPictureUrl: friend?.picture_url || null,
        isAttention: friendMetadata.__attention === '1',
        operatorId,
        status,
        notes,
        revision,
        lastMessageAt,
        createdAt,
        // 古い履歴が残っているか。画面は「前のメッセージ」ボタンで遡る。
        hasMoreMessages,
        messages: messageRows.map((m) => ({
          id: m.id,
          direction: m.direction,
          messageType: m.message_type,
          content: m.content,
          isUnsent: Boolean(m.is_unsent),
          source: m.source || null,
          originKind: m.origin_kind || null,
          sentByStaffId: m.sent_by_staff_id || null,
          sentByStaffName: m.sent_by_staff_name || null,
          scenarioName: m.scenario_name || null,
          quoted: m.quoted_message_id
            ? {
                id: m.quoted_message_id,
                direction: m.quoted_direction,
                messageType: m.quoted_message_type,
                content: m.quoted_content,
                isUnsent: Boolean(m.quoted_is_unsent),
                createdAt: m.quoted_created_at,
              }
            : null,
          createdAt: m.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 開いた担当者だけを既読にする。対応状態は共有だが、既読位置は共有しない。
chats.post('/api/chats/:id/read', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  try {
    const resolved = await resolveOrCreateChat(c.env.DB, c.req.param('id'));
    if (!resolved) return c.json({ success: false, error: 'Chat not found' }, 404);
    const latest = await c.env.DB
      .prepare(
        `SELECT MAX(created_at) AS last_read_at
         FROM messages_log
         WHERE friend_id = ? AND direction = 'incoming'
           AND (delivery_type IS NULL OR delivery_type != 'test')`,
      )
      .bind(resolved.friend_id)
      .first<{ last_read_at: string | null }>();
    if (latest?.last_read_at) {
      await markInboxConversationRead(c.env.DB, {
        staffId: c.get('staff').id,
        channel: 'line',
        conversationId: resolved.friend_id,
        lastReadAt: latest.last_read_at,
      });
    }
    return c.json({ success: true, data: { isUnread: false } });
  } catch (err) {
    console.error('POST /api/chats/:id/read error:', err);
    return c.json({ success: false, error: '既読状態を更新できませんでした' }, 500);
  }
});

chats.post('/api/chats/read-all', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const now = jstNow();
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const clauses: string[] = [];
    const accountBindings: string[] = [];
    if (scope.allowedAccountIds.length > 0) {
      clauses.push(`f.line_account_id IN (${scope.allowedAccountIds.map(() => '?').join(', ')})`);
      accountBindings.push(...scope.allowedAccountIds);
    }
    if (scope.canSeeUnassigned) clauses.push('f.line_account_id IS NULL');
    if (clauses.length === 0) return c.json({ success: true, data: { marked: true } });
    await c.env.DB
      .prepare(
        `INSERT INTO inbox_staff_reads
           (staff_id, channel, conversation_id, last_read_at, updated_at)
         SELECT ?, 'line', m.friend_id, MAX(m.created_at), ?
         FROM messages_log m
         INNER JOIN friends f ON f.id = m.friend_id
         WHERE m.direction = 'incoming'
           AND (m.delivery_type IS NULL OR m.delivery_type != 'test')
           AND (${clauses.join(' OR ')})
         GROUP BY m.friend_id
         ON CONFLICT(staff_id, channel, conversation_id) DO UPDATE SET
           last_read_at = excluded.last_read_at,
           updated_at = excluded.updated_at`,
      )
      .bind(c.get('staff').id, now, ...accountBindings)
      .run();
    return c.json({ success: true, data: { marked: true } });
  } catch (err) {
    console.error('POST /api/chats/read-all error:', err);
    return c.json({ success: false, error: '既読状態を更新できませんでした' }, 500);
  }
});

chats.get(
  '/api/chats/:id/events',
  requireRole('owner', 'admin', 'staff'),
  requireVisibleChat,
  async (c) => {
    const resolved = await resolveOrCreateChat(c.env.DB, c.req.param('id'));
    if (!resolved) return c.json({ success: false, error: 'Chat not found' }, 404);
    const rows = await c.env.DB.prepare(
      `SELECT id, event_type, before_json, after_json, actor_staff_id,
              (SELECT name FROM staff_members sm WHERE sm.id = e.actor_staff_id) AS actor_staff_name,
              reason, correlation_id, created_at
       FROM inbox_conversation_events e
       WHERE channel = 'line' AND conversation_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 200`,
    ).bind(resolved.friend_id).all<Record<string, unknown>>();
    return c.json({
      success: true,
      data: rows.results.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        before: row.before_json ? JSON.parse(String(row.before_json)) : null,
        after: row.after_json ? JSON.parse(String(row.after_json)) : null,
        actorStaffId: row.actor_staff_id,
        actorStaffName: row.actor_staff_name,
        reason: row.reason,
        correlationId: row.correlation_id,
        createdAt: row.created_at,
      })),
    });
  },
);

chats.get('/api/inbox/saved-views', requireRole('owner', 'admin', 'staff'), async (c) => {
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const rows = await getSavedSearches(c.env.DB, 'chats', access);
  const visibleRows = rows.filter((row) => row.scope === 'chats'
    && (row.line_account_id === access.lineAccountId
      ? access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId
      : row.line_account_id === null && row.created_by === access.staffId));
  const counts = await Promise.all(visibleRows.map(async (row) => {
    const parsed = validateInboxSavedViewConditions(JSON.parse(row.conditions_json) as unknown);
    return countInboxSavedViewMatches(c.env.DB, {
      lineAccountId: access.lineAccountId,
      staffId: access.staffId,
      canSeeUnassigned: access.canSeeUnassigned,
      // 受信箱より前の `{ all, any }` 行は、画面と同じく「絞りなし」へ倒す。
      conditions: parsed.ok ? parsed.value : EMPTY_INBOX_SAVED_VIEW_CONDITIONS,
    });
  }));
  return c.json({
    success: true,
    data: visibleRows.map((row, index) => serializeInboxSavedView(row, counts[index])),
  });
});

chats.post('/api/inbox/saved-views', requireRole('owner', 'admin', 'staff'), async (c) => {
  const staff = c.get('staff');
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);
  if (name.length > 40) return c.json({ success: false, error: '名前は40文字以内で入力してください' }, 400);
  const conditions = validateInboxSavedViewConditions(body.conditions);
  if (!conditions.ok) return c.json({ success: false, error: conditions.error }, 422);
  const isShared = body.isShared === true;
  if (isShared && staff.role === 'staff') {
    return c.json({ success: false, error: '共有の検索を作る権限がありません' }, 403);
  }
  const rows = await getSavedSearches(c.env.DB, 'chats', access);
  if (rows.filter((row) => row.created_by === staff.id).length >= 50) {
    return c.json({ success: false, error: '保存できる検索は50件までです' }, 422);
  }
  if (rows.some((row) => row.created_by === staff.id && row.name === name)) {
    return c.json({ success: false, error: '同じ名前の保存検索があります' }, 409);
  }
  const saved = await createSavedSearch(c.env.DB, {
    name,
    scope: 'chats',
    conditions: conditions.value,
    createdBy: staff.id,
    lineAccountId: access.lineAccountId,
    isShared,
    displayOrder: body.isFavorite === true ? -1 : 0,
  });
  return c.json({ success: true, data: serializeInboxSavedView(saved) }, 201);
});

chats.patch('/api/inbox/saved-views/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const staff = c.get('staff');
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const existing = await getSavedSearchById(c.env.DB, c.req.param('id'), access.lineAccountId);
  if (!existing || existing.scope !== 'chats' || existing.line_account_id !== access.lineAccountId) {
    return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  }
  if (existing.created_by !== staff.id && staff.role === 'staff') {
    return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  }
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  const patch: Parameters<typeof updateSavedSearch>[3] = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);
    if (name.length > 40) return c.json({ success: false, error: '名前は40文字以内で入力してください' }, 400);
    const rows = await getSavedSearches(c.env.DB, 'chats', access);
    if (rows.some((row) => row.id !== existing.id && row.created_by === existing.created_by && row.name === name)) {
      return c.json({ success: false, error: '同じ名前の保存検索があります' }, 409);
    }
    patch.name = name;
  }
  if (body.conditions !== undefined) {
    const conditions = validateInboxSavedViewConditions(body.conditions);
    if (!conditions.ok) return c.json({ success: false, error: conditions.error }, 422);
    patch.conditions = conditions.value;
  }
  if (body.isShared !== undefined) {
    if (staff.role === 'staff') return c.json({ success: false, error: '共有設定を変える権限がありません' }, 403);
    patch.isShared = body.isShared === true;
  }
  if (body.isFavorite !== undefined) {
    patch.displayOrder = body.isFavorite === true ? -1 : 0;
  }
  const saved = await updateSavedSearch(c.env.DB, existing.id, access, patch);
  if (!saved) return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  return c.json({ success: true, data: serializeInboxSavedView(saved!) });
});

chats.delete('/api/inbox/saved-views/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const staff = c.get('staff');
  const access = await inboxSavedViewAccess(c);
  if (access instanceof Response) return access;
  const existing = await getSavedSearchById(c.env.DB, c.req.param('id'), access.lineAccountId);
  if (!existing || existing.scope !== 'chats' || existing.line_account_id !== access.lineAccountId
      || (existing.created_by !== staff.id && staff.role === 'staff')) {
    return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  }
  const deleted = await deleteSavedSearch(c.env.DB, existing.id, access);
  if (!deleted) return c.json({ success: false, error: '保存検索が見つかりません' }, 404);
  return c.json({ success: true, data: null });
});

chats.post('/api/chats', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; operatorId?: string; lineAccountId?: string | null }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    if (body.lineAccountId !== null && body.lineAccountId !== undefined
      && (!body.lineAccountId
        || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId]))) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const item = await createChat(c.env.DB, body);
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE chats SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, friendId: item.friend_id, status: item.status } }, 201);
  } catch (err) {
    console.error('POST /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// チャットのアサイン/ステータス更新/ノート更新
chats.put('/api/chats/:id', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  try {
    const id = c.req.param('id');
    const resolved = await resolveOrCreateChat(c.env.DB, id);
    if (!resolved) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{
      operatorId?: string | null;
      status?: string;
      notes?: string;
      revision?: number;
      reason?: string;
    }>();
    if (body.status !== undefined && !isInboxStatus(body.status)) {
      return c.json({ success: false, error: '対応状態が正しくありません' }, 400);
    }
    if (body.notes !== undefined && body.notes.length > 10_000) {
      return c.json({ success: false, error: '内部メモは10,000文字以内で入力してください' }, 400);
    }
    if (body.operatorId) {
      const operator = await getOperatorById(c.env.DB, body.operatorId);
      if (!operator || !operator.is_active) {
        return c.json({ success: false, error: '担当者が見つかりません' }, 400);
      }
    }

    const expectedRevision = body.revision ?? resolved.revision;
    if (expectedRevision !== resolved.revision) {
      return c.json({
        success: false,
        error: 'ほかの担当者が先に更新しました。最新の内容を確認してください',
        code: 'REVISION_CONFLICT',
        data: { revision: resolved.revision },
      }, 409);
    }

    const sets: string[] = [];
    const bindings: unknown[] = [];
    const events: D1PreparedStatement[] = [];
    const now = jstNow();
    const correlationId = crypto.randomUUID();
    const eventGuard = {
      table: 'chats' as const,
      id: resolved.id,
      revision: expectedRevision + 1,
      updatedAt: now,
    };
    if (body.operatorId !== undefined && body.operatorId !== resolved.operator_id) {
      sets.push('operator_id = ?');
      bindings.push(body.operatorId);
      events.push(inboxEventStatement(c.env.DB, {
        channel: 'line', conversationId: resolved.friend_id, eventType: 'assignment',
        before: { operatorId: resolved.operator_id }, after: { operatorId: body.operatorId },
        actorStaffId: c.get('staff').id, reason: body.reason, correlationId, createdAt: now,
        guard: eventGuard,
      }));
    }
    if (body.status !== undefined && body.status !== resolved.status) {
      sets.push('status = ?');
      bindings.push(body.status);
      events.push(inboxEventStatement(c.env.DB, {
        channel: 'line', conversationId: resolved.friend_id, eventType: 'status',
        before: { status: resolved.status }, after: { status: body.status },
        actorStaffId: c.get('staff').id, reason: body.reason, correlationId, createdAt: now,
        guard: eventGuard,
      }));
    }
    if (body.notes !== undefined && body.notes !== (resolved.notes ?? '')) {
      const notes = body.notes.trim();
      sets.push('notes = ?');
      bindings.push(notes || null);
      events.push(inboxEventStatement(c.env.DB, {
        channel: 'line', conversationId: resolved.friend_id, eventType: 'note',
        before: { hasNote: Boolean(resolved.notes) }, after: { hasNote: Boolean(notes) },
        actorStaffId: c.get('staff').id, reason: body.reason, correlationId, createdAt: now,
        guard: eventGuard,
      }));
      if (notes) {
        events.push(inboxNoteStatement(c.env.DB, {
          channel: 'line', conversationId: resolved.friend_id, body: notes,
          actorStaffId: c.get('staff').id, createdAt: now, guard: eventGuard,
        }));
      }
    }
    if (sets.length > 0) {
      sets.push('revision = revision + 1', 'updated_at = ?');
      bindings.push(now, resolved.id, expectedRevision);
      const [updateResult] = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE chats SET ${sets.join(', ')} WHERE id = ? AND revision = ?`,
        ).bind(...bindings),
        ...events,
      ]);
      if ((updateResult.meta?.changes ?? 0) !== 1) {
        return c.json({
          success: false,
          error: 'ほかの担当者が先に更新しました。最新の内容を確認してください',
          code: 'REVISION_CONFLICT',
        }, 409);
      }
      if (body.operatorId !== undefined
        && body.operatorId !== null
        && body.operatorId !== resolved.operator_id) {
        const assignedFriend = await getFriendById(c.env.DB, resolved.friend_id);
        await fireEvent(c.env.DB, 'staff_assigned', {
          sourceEventId: correlationId,
          sourceKind: 'inbox_assignment',
          occurredAt: now,
          friendId: resolved.friend_id,
          eventData: { staffId: body.operatorId },
        }, undefined, assignedFriend?.line_account_id).catch((error) => {
          console.error('staff_assigned automation error:', error);
        });
      }
    }
    const updated = await getChatById(c.env.DB, resolved.id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      // 公開 ID は friend_id に統一
      data: {
        id: updated.friend_id,
        friendId: updated.friend_id,
        operatorId: updated.operator_id,
        status: updated.status,
        notes: updated.notes,
        revision: updated.revision,
      },
    });
  } catch (err) {
    console.error('PUT /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// オペレーター入力中のローディング表示を開始
chats.post('/api/chats/:id/loading', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let loadingSecondsInput: number | undefined;
    try {
      const body = await c.req.json<{ loadingSeconds?: number }>();
      loadingSecondsInput = body.loadingSeconds;
    } catch {
      loadingSecondsInput = undefined;
    }
    const loadingSeconds = clampLoadingSeconds(loadingSecondsInput);

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      'chats.loading-animation',
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    await startLoadingAnimation(
      accessToken,
      friend.line_user_id,
      loadingSeconds,
    );

    return c.json({ success: true, data: { started: true, loadingSeconds } });
  } catch (err) {
    console.error('POST /api/chats/:id/loading error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return c.json({ success: false, error: message }, 500);
  }
});

// オペレーターからメッセージ送信
chats.post('/api/chats/:id/send', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  let leasedConversationId: string | null = null;
  try {
    const chatId = c.req.param('id');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
    }
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    // 壊れたJSONは外側catchの500に落とさない。運用者が原因を判別できるよう400で返す。
    let body: { messageType?: string; content: string; revision?: number; quotedMessageId?: string };
    try {
      body = await c.req.json<{ messageType?: string; content: string; revision?: number; quotedMessageId?: string }>();
    } catch {
      return c.json({ success: false, error: 'content is required' }, 400);
    }
    if (!body.content) return c.json({ success: false, error: 'content is required' }, 400);
    if (body.revision !== undefined && body.revision !== chat.revision) {
      return c.json({
        success: false,
        error: 'ほかの担当者が先に更新しました。最新の会話を確認してください',
        code: 'REVISION_CONFLICT',
        data: { revision: chat.revision },
      }, 409);
    }

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      'chats.manual-send',
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    if (!await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [friend.line_account_id ?? null],
    )) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // 引用元の検証は外部送信より前に行う。別friend・別アカウント・取消済みを
    // 指定されてもここで止め、LINE呼び出しも保存もしない。
    // 引用元の検証は外部送信より前に行う。別friend・別アカウント・取消済みを
    // 指定されてもここで止め、LINE呼び出しも保存もしない。
    let quoted: QuotedMessageRow | null = null;
    if (body.quotedMessageId) {
      quoted = await resolveQuotedMessage(c.env.DB, {
        friendId: friend.id,
        lineAccountId: friend.line_account_id ?? null,
        quotedMessageId: body.quotedMessageId,
      });
      if (!quoted) {
        return c.json({ success: false, error: '引用元のメッセージが見つかりません' }, 404);
      }
    }

    const leaseNow = new Date();
    const lease = await acquireInboxReplyLease(c.env.DB, {
      channel: 'line',
      conversationId: friend.id,
      staffId: c.get('staff').id,
      conversationRevision: chat.revision,
      now: leaseNow.toISOString(),
      expiresAt: new Date(leaseNow.getTime() + 60_000).toISOString(),
    });
    if (!lease.acquired) {
      return c.json({
        success: false,
        error: 'ほかの担当者が返信中です。送信せず、少し待って最新の会話を確認してください',
        code: 'REPLY_LEASE_CONFLICT',
        data: { staffId: lease.staffId, expiresAt: lease.expiresAt },
      }, 409);
    }
    leasedConversationId = friend.id;

    // LINE APIでメッセージ送信
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(accessToken);
    const messageType = body.messageType ?? 'text';
    let message: Message;
    if (messageType === 'text') {
      // LINEのtext上限(5000字)を超える本文はここで止める。送ってから弾かれると
      // 送信済みか未送信かが分からなくなり、運用者が二重送信しかねない。
      if (body.content.length > 5000) {
        return c.json({ success: false, error: 'メッセージは5000文字以内で入力してください' }, 400);
      }
      message = { type: 'text', text: body.content };
    } else if (messageType === 'flex') {
      // 壊れたJSONは外側catchの500に落とさず400で返す(形式が合うJSONは従来どおり送る)。
      let contents: FlexContainer;
      try {
        contents = JSON.parse(body.content) as FlexContainer;
      } catch {
        return c.json({ success: false, error: 'Flexメッセージの形式が正しくありません' }, 400);
      }
      message = { type: 'flex', altText: extractFlexAltText(contents), contents };
    } else if (messageType === 'image') {
      let parsed: {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      try {
        parsed = JSON.parse(body.content) as {
          originalContentUrl: string;
          previewImageUrl: string;
        };
      } catch {
        return c.json({ success: false, error: '画像メッセージの形式が正しくありません' }, 400);
      }
      message = {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } else {
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
      });
      leasedConversationId = null;
      return c.json({ success: false, error: 'messageType is not supported' }, 400);
    }

    // 引用元にLINEのquoteTokenが残っていれば、顧客側にも引用表示として届く。
    if (quoted?.quote_token) message.quoteToken = quoted.quote_token;

    const payloadHash = await hashOutboundPayload(
      JSON.stringify({
        chatId: chat.id,
        friendId: friend.id,
        messageType,
        content: body.content,
        quotedMessageId: quoted?.id ?? null,
      }),
    );
    const reservation = await reserveOutboundSend(c.env.DB, {
      key: idempotencyKey,
      channel: 'line',
      resourceId: chat.id,
      payloadHash,
      lineAccountId: friend.line_account_id ?? null,
      // in_progress はLINE受理後の応答喪失を含み得るため、自動再送しない。
      retryInProgress: false,
      now: new Date().toISOString(),
    });
    if (reservation.kind === 'conflict') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({ success: false, error: '同じ送信キーを別の内容には使用できません' }, 409);
    }
    if (reservation.kind === 'in_progress') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: '同じメッセージを送信中か、送信結果を確認中です',
        code: 'OUTBOUND_SEND_IN_PROGRESS',
      }, 409);
    }
    if (reservation.kind === 'failed') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: reservation.retryable ? '再送できる時刻までお待ちください' : 'この送信は自動再送できません',
        code: reservation.code,
        data: { retryable: reservation.retryable, nextRetryAt: reservation.nextRetryAt },
      }, 409);
    }
    if (reservation.kind === 'unknown') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: 'LINEへの送達結果を確認できないため、自動再送を停止しました',
        code: reservation.code,
        data: { retryable: false, nextRetryAt: null },
      }, 409);
    }
    if (reservation.kind === 'replay') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: true,
        data: {
          sent: true,
          messageId: reservation.responseId,
          sentByStaffName: c.get('staff').name,
          revision: chat.revision,
          replayed: true,
        },
      });
    }

    // LINE 側にも同じキーを渡す。DB保存前に通信が切れて再実行されても、
    // LINE API が同一リクエストを二重配信しない。
    const outboundLeaseToken = reservation.leaseToken;
    try {
      await lineClient.pushMessage(friend.line_user_id, [message], idempotencyKey);
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failure = classifyLineOutboundFailure(error, failedAt);
      await failOutboundSend(c.env.DB, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: failure.status,
        code: failure.code,
        retryable: failure.retryable,
        nextRetryAt: failure.nextRetryAt,
        now: failedAt,
      });
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
      });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: failure.status === 'unknown'
          ? 'LINEへの送達結果を確認できないため、自動再送を停止しました'
          : 'LINEへ送信できませんでした',
        code: failure.code,
        data: { retryable: failure.retryable, nextRetryAt: failure.nextRetryAt },
      }, failure.httpStatus);
    }

    // メッセージログに記録
    const logId = idempotencyKey;
    const sentAt = jstNow();
    try {
      await c.env.DB.batch([
        c.env.DB
          .prepare(`INSERT OR IGNORE INTO messages_log
            (id, friend_id, direction, message_type, content, source, line_account_id,
             sent_by_staff_id, created_at, quoted_message_id)
            VALUES (?, ?, 'outgoing', ?, ?, 'manual', ?, ?, ?, ?)`)
          .bind(
            logId,
            friend.id,
            messageType,
            body.content,
            friend.line_account_id ?? null,
            c.get('staff').id,
            sentAt,
            quoted?.id ?? null,
          ),
        completeOutboundSendStatement(c.env.DB, {
          key: idempotencyKey,
          responseId: logId,
          now: new Date().toISOString(),
          leaseToken: outboundLeaseToken,
        }),
      ]);
    } catch {
      const failedAt = new Date().toISOString();
      await failOutboundSend(c.env.DB, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: 'unknown',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        retryable: false,
        nextRetryAt: null,
        now: failedAt,
      });
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
      });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: 'LINEには受理された可能性がありますが、送信履歴を確定できませんでした',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        data: { retryable: false, nextRetryAt: null },
      }, 503);
    }

    // チャットの最終メッセージ日時を更新（chat.id を直接使う — friend_id で呼ばれても resolveOrCreateChat 済み）
    await updateChat(c.env.DB, chat.id, { status: 'in_progress', lastMessageAt: sentAt });
    const updatedChat = await getChatById(c.env.DB, chat.id);
    await inboxEventStatement(c.env.DB, {
      channel: 'line',
      conversationId: friend.id,
      eventType: 'send',
      before: null,
      after: { messageId: logId, status: 'in_progress', source: 'manual' },
      actorStaffId: c.get('staff').id,
      correlationId: idempotencyKey,
      createdAt: sentAt,
    }).run();

    // 初回返信の時刻を残す（107）。
    //
    // 受信してから最初に返すまでの時間を出すために要る。
    // まだ入っていないときだけ入れる。2回目以降の返信で上書きすると、
    // 「最初に返すまで」ではなく「最後に返したのはいつか」になる。
    //
    // 失敗しても送信そのものは成功しているので、握りつぶす。
    try {
      await c.env.DB
        .prepare(
          `UPDATE chats SET first_replied_at = ?
            WHERE id = ? AND first_replied_at IS NULL`,
        )
        .bind(jstNow(), chat.id)
        .run();
    } catch (e) {
      console.error('first_replied_at update error:', e);
    }

    await fireEvent(c.env.DB, 'manual_reply_sent', {
      sourceEventId: logId,
      sourceKind: 'manual_reply',
      occurredAt: sentAt,
      friendId: friend.id,
      eventData: { staffId: c.get('staff').id },
    }, undefined, friend.line_account_id).catch((error) => {
      console.error('manual_reply_sent automation error:', error);
    });

    await releaseInboxReplyLease(c.env.DB, {
      channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
    });
    leasedConversationId = null;

    return c.json({
      success: true,
      data: {
        sent: true,
        messageId: logId,
        sentByStaffName: c.get('staff').name,
        revision: updatedChat?.revision ?? chat.revision + 1,
      },
    });
  } catch (err) {
    if (leasedConversationId) {
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: leasedConversationId, staffId: c.get('staff').id,
      }).catch(() => undefined);
    }
    console.error('POST /api/chats/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/chats/:id/send-combined — 画像と本文を1回の送信単位にする(N-022)。
 *
 * 単体送信口を2回呼ぶと、画像だけ届いて本文が落ちる部分送信になる。
 * 結合口は画像URL・本文長・権限・所属を外部送信前にすべて検証し、
 * LINEへは1回のpush要求のメッセージ配列として送る。片方の検証失敗時は
 * LINE呼び出し0回・保存0件。冪等予約は単体口と共用する。
 */
chats.post('/api/chats/:id/send-combined', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  let leasedConversationId: string | null = null;
  try {
    const chatId = c.req.param('id');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
    }
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let body: { image?: { originalContentUrl?: unknown; previewImageUrl?: unknown } | null; text?: unknown; revision?: number; quotedMessageId?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'content is required' }, 400);
    }
    const image = body.image ?? null;
    const text = typeof body.text === 'string' ? body.text : null;
    if (!image && !text) return c.json({ success: false, error: 'content is required' }, 400);
    if (body.revision !== undefined && body.revision !== chat.revision) {
      return c.json({
        success: false,
        error: 'ほかの担当者が先に更新しました。最新の会話を確認してください',
        code: 'REVISION_CONFLICT',
        data: { revision: chat.revision },
      }, 409);
    }

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      'chats.manual-send',
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    if (!await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [friend.line_account_id ?? null],
    )) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // 引用元の検証は外部送信より前に行う(単体送信口と同じ境界)。
    let quoted: QuotedMessageRow | null = null;
    if (body.quotedMessageId) {
      quoted = await resolveQuotedMessage(c.env.DB, {
        friendId: friend.id,
        lineAccountId: friend.line_account_id ?? null,
        quotedMessageId: body.quotedMessageId,
      });
      if (!quoted) {
        return c.json({ success: false, error: '引用元のメッセージが見つかりません' }, 404);
      }
    }

    // 外部送信の前に両方を検証する。片方でも壊れていれば送らず保存しない。
    let imagePart: { originalContentUrl: string; previewImageUrl: string } | null = null;
    if (image) {
      if (typeof image.originalContentUrl !== 'string' || !image.originalContentUrl
        || typeof image.previewImageUrl !== 'string' || !image.previewImageUrl) {
        return c.json({ success: false, error: '画像メッセージの形式が正しくありません' }, 400);
      }
      imagePart = {
        originalContentUrl: image.originalContentUrl,
        previewImageUrl: image.previewImageUrl,
      };
    }
    let textPart: string | null = null;
    if (text) {
      if (text.length > 5000) {
        return c.json({ success: false, error: 'メッセージは5000文字以内で入力してください' }, 400);
      }
      textPart = text;
    }
    const messages: Message[] = [
      ...(imagePart ? [{ type: 'image', ...imagePart } as Message] : []),
      ...(textPart !== null ? [{ type: 'text', text: textPart } as Message] : []),
    ];
    // 引用は先頭のメッセージに付ける(1送信要求につき1つの引用元)。
    if (quoted?.quote_token && messages.length > 0) {
      messages[0].quoteToken = quoted.quote_token;
    }

    const leaseNow = new Date();
    const lease = await acquireInboxReplyLease(c.env.DB, {
      channel: 'line',
      conversationId: friend.id,
      staffId: c.get('staff').id,
      conversationRevision: chat.revision,
      now: leaseNow.toISOString(),
      expiresAt: new Date(leaseNow.getTime() + 60_000).toISOString(),
    });
    if (!lease.acquired) {
      return c.json({
        success: false,
        error: 'ほかの担当者が返信中です。送信せず、少し待って最新の会話を確認してください',
        code: 'REPLY_LEASE_CONFLICT',
        data: { staffId: lease.staffId, expiresAt: lease.expiresAt },
      }, 409);
    }
    leasedConversationId = friend.id;

    const payloadHash = await hashOutboundPayload(
      JSON.stringify({
        chatId: chat.id,
        friendId: friend.id,
        combined: true,
        image: imagePart,
        text: textPart,
        quotedMessageId: quoted?.id ?? null,
      }),
    );
    const reservation = await reserveOutboundSend(c.env.DB, {
      key: idempotencyKey,
      channel: 'line',
      resourceId: chat.id,
      payloadHash,
      lineAccountId: friend.line_account_id ?? null,
      retryInProgress: false,
      now: new Date().toISOString(),
    });
    if (reservation.kind === 'conflict') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({ success: false, error: '同じ送信キーを別の内容には使用できません' }, 409);
    }
    if (reservation.kind === 'in_progress') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: '同じメッセージを送信中か、送信結果を確認中です',
        code: 'OUTBOUND_SEND_IN_PROGRESS',
      }, 409);
    }
    if (reservation.kind === 'failed') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: reservation.retryable ? '再送できる時刻までお待ちください' : 'この送信は自動再送できません',
        code: reservation.code,
        data: { retryable: reservation.retryable, nextRetryAt: reservation.nextRetryAt },
      }, 409);
    }
    if (reservation.kind === 'unknown') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: 'LINEへの送達結果を確認できないため、自動再送を停止しました',
        code: reservation.code,
        data: { retryable: false, nextRetryAt: null },
      }, 409);
    }
    if (reservation.kind === 'replay') {
      await releaseInboxReplyLease(c.env.DB, { channel: 'line', conversationId: friend.id, staffId: c.get('staff').id });
      leasedConversationId = null;
      return c.json({
        success: true,
        data: {
          sent: true,
          messageId: reservation.responseId,
          sentByStaffName: c.get('staff').name,
          revision: chat.revision,
          replayed: true,
        },
      });
    }

    // 1回のpush要求にまとめる。2回の独立pushにしない。
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(accessToken);
    const outboundLeaseToken = reservation.leaseToken;
    try {
      await lineClient.pushMessage(friend.line_user_id, messages, idempotencyKey);
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failure = classifyLineOutboundFailure(error, failedAt);
      await failOutboundSend(c.env.DB, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: failure.status,
        code: failure.code,
        retryable: failure.retryable,
        nextRetryAt: failure.nextRetryAt,
        now: failedAt,
      });
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
      });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: failure.status === 'unknown'
          ? 'LINEへの送達結果を確認できないため、自動再送を停止しました'
          : 'LINEへ送信できませんでした',
        code: failure.code,
        data: { retryable: failure.retryable, nextRetryAt: failure.nextRetryAt },
      }, failure.httpStatus);
    }

    const logBaseId = idempotencyKey;
    const sentAt = jstNow();
    const rows = [
      ...(imagePart ? [{
        id: `${logBaseId}:0`,
        messageType: 'image',
        content: JSON.stringify(imagePart),
      }] : []),
      ...(textPart !== null ? [{
        id: `${logBaseId}:${imagePart ? 1 : 0}`,
        messageType: 'text',
        content: textPart,
      }] : []),
    ];
    try {
      await c.env.DB.batch([
        ...rows.map((row, index) =>
          c.env.DB
            .prepare(`INSERT OR IGNORE INTO messages_log
              (id, friend_id, direction, message_type, content, source, line_account_id,
               sent_by_staff_id, created_at, quoted_message_id)
              VALUES (?, ?, 'outgoing', ?, ?, 'manual', ?, ?, ?, ?)`)
            .bind(
              row.id,
              friend.id,
              row.messageType,
              row.content,
              friend.line_account_id ?? null,
              c.get('staff').id,
              sentAt,
              // 引用は先頭メッセージに付けたので、記録も先頭行にだけ持たせる。
              index === 0 ? quoted?.id ?? null : null,
            ),
        ),
        completeOutboundSendStatement(c.env.DB, {
          key: idempotencyKey,
          responseId: logBaseId,
          now: new Date().toISOString(),
          leaseToken: outboundLeaseToken,
        }),
      ]);
    } catch {
      const failedAt = new Date().toISOString();
      await failOutboundSend(c.env.DB, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: 'unknown',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        retryable: false,
        nextRetryAt: null,
        now: failedAt,
      });
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
      });
      leasedConversationId = null;
      return c.json({
        success: false,
        error: 'LINEには受理された可能性がありますが、送信履歴を確定できませんでした',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        data: { retryable: false, nextRetryAt: null },
      }, 503);
    }

    await updateChat(c.env.DB, chat.id, { status: 'in_progress', lastMessageAt: sentAt });
    const updatedChat = await getChatById(c.env.DB, chat.id);
    await inboxEventStatement(c.env.DB, {
      channel: 'line',
      conversationId: friend.id,
      eventType: 'send',
      before: null,
      after: { messageId: logBaseId, status: 'in_progress', source: 'manual' },
      actorStaffId: c.get('staff').id,
      correlationId: idempotencyKey,
      createdAt: sentAt,
    }).run();

    try {
      await c.env.DB
        .prepare(
          `UPDATE chats SET first_replied_at = ?
            WHERE id = ? AND first_replied_at IS NULL`,
        )
        .bind(jstNow(), chat.id)
        .run();
    } catch (e) {
      console.error('first_replied_at update error:', e);
    }

    await fireEvent(c.env.DB, 'manual_reply_sent', {
      sourceEventId: logBaseId,
      sourceKind: 'manual_reply',
      occurredAt: sentAt,
      friendId: friend.id,
      eventData: { staffId: c.get('staff').id },
    }, undefined, friend.line_account_id).catch((error) => {
      console.error('manual_reply_sent automation error:', error);
    });

    await releaseInboxReplyLease(c.env.DB, {
      channel: 'line', conversationId: friend.id, staffId: c.get('staff').id,
    });
    leasedConversationId = null;

    return c.json({
      success: true,
      data: {
        sent: true,
        messageId: logBaseId,
        messageIds: rows.map((row) => row.id),
        sentByStaffName: c.get('staff').name,
        revision: updatedChat?.revision ?? chat.revision + 1,
      },
    });
  } catch (err) {
    if (leasedConversationId) {
      await releaseInboxReplyLease(c.env.DB, {
        channel: 'line', conversationId: leasedConversationId, staffId: c.get('staff').id,
      }).catch(() => undefined);
    }
    console.error('POST /api/chats/:id/send-combined error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 送信予約(N-025) ==========

// 予約時刻は「いまより先」だけを受け付ける。画面のdatetime-localはJSTで
// 入力されるが、保存はUTCへ正規化するため境界ずれは起きない。
function validateScheduledAt(raw: unknown): { ok: true; scheduledAt: string } | { ok: false } {
  if (typeof raw !== 'string' || !raw) return { ok: false };
  let scheduledAt: string;
  try {
    scheduledAt = normalizeScheduledAt(raw);
  } catch {
    return { ok: false };
  }
  if (Date.parse(scheduledAt) <= Date.now()) return { ok: false };
  return { ok: true, scheduledAt };
}

/**
 * POST /api/chats/:id/schedule — 返信の予約作成。
 * Idempotency-Keyは必須で、同じキーの再送は新しい予約を作らず既存を返す。
 */
chats.post('/api/chats/:id/schedule', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  try {
    const chatId = c.req.param('id');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
    }
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let body: { content?: unknown; scheduledAt?: unknown; quotedMessageId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'content is required' }, 400);
    }
    const content = typeof body.content === 'string' ? body.content : '';
    if (!content) return c.json({ success: false, error: 'content is required' }, 400);
    if (content.length > 5000) {
      return c.json({ success: false, error: 'メッセージは5000文字以内で入力してください' }, 400);
    }
    const time = validateScheduledAt(body.scheduledAt);
    if (!time.ok) {
      return c.json({ success: false, error: '未来の日時を指定してください' }, 400);
    }

    const { friend } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      'chats.schedule-send',
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    if (!await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [friend.line_account_id ?? null],
    )) {
      return c.json({ success: false, error: 'Chat not found' }, 404);
    }

    // 引用元の検証は単体送信口と同じ境界。無効な引用は予約を作らない。
    let quotedMessageId: string | null = null;
    if (typeof body.quotedMessageId === 'string' && body.quotedMessageId) {
      const quoted = await resolveQuotedMessage(c.env.DB, {
        friendId: friend.id,
        lineAccountId: friend.line_account_id ?? null,
        quotedMessageId: body.quotedMessageId,
      });
      if (!quoted) {
        return c.json({ success: false, error: '引用元のメッセージが見つかりません' }, 404);
      }
      quotedMessageId = quoted.id;
    }

    const { row, created } = await createScheduledChatSend(c.env.DB, {
      id: crypto.randomUUID(),
      friendId: friend.id,
      lineAccountId: friend.line_account_id ?? null,
      staffId: c.get('staff').id,
      messageType: 'text',
      content,
      quotedMessageId,
      idempotencyKey,
      scheduledAt: time.scheduledAt,
      now: new Date().toISOString(),
    });

    return c.json({
      success: true,
      data: { ...scheduledSendResponse(row), replayed: !created },
    });
  } catch (err) {
    console.error('POST /api/chats/:id/schedule error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** GET /api/chats/:id/scheduled — 会話の待機中・送信中の予約一覧。 */
chats.get('/api/chats/:id/scheduled', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await getChatById(c.env.DB, chatId)
      ?? await resolveOrCreateChat(c.env.DB, chatId).catch(() => null);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);
    const rows = await listPendingScheduledChatSends(c.env.DB, chat.friend_id);
    return c.json({
      success: true,
      data: { scheduled: rows.map(scheduledSendResponse) },
    });
  } catch (err) {
    console.error('GET /api/chats/:id/scheduled error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * PATCH /api/chats/:id/scheduled/:scheduleId — 予約の時刻・本文変更。
 * scheduled の行だけCASで書き換える。sending以降は409。
 */
chats.patch('/api/chats/:id/scheduled/:scheduleId', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  try {
    const chatId = c.req.param('id');
    const scheduleId = c.req.param('scheduleId');
    const chat = await getChatById(c.env.DB, chatId)
      ?? await resolveOrCreateChat(c.env.DB, chatId).catch(() => null);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let body: { scheduledAt?: unknown; content?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'content is required' }, 400);
    }
    const updates: { scheduledAt?: string; content?: string } = {};
    if (body.scheduledAt !== undefined) {
      const time = validateScheduledAt(body.scheduledAt);
      if (!time.ok) {
        return c.json({ success: false, error: '未来の日時を指定してください' }, 400);
      }
      updates.scheduledAt = time.scheduledAt;
    }
    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || !body.content) {
        return c.json({ success: false, error: 'content is required' }, 400);
      }
      if (body.content.length > 5000) {
        return c.json({ success: false, error: 'メッセージは5000文字以内で入力してください' }, 400);
      }
      updates.content = body.content;
    }
    if (updates.scheduledAt === undefined && updates.content === undefined) {
      return c.json({ success: false, error: '変更する項目がありません' }, 400);
    }

    const result = await updateScheduledChatSend(c.env.DB, {
      id: scheduleId,
      friendId: chat.friend_id,
      scheduledAt: updates.scheduledAt,
      content: updates.content,
      now: new Date().toISOString(),
    });
    if (result === 'not_found') {
      return c.json({ success: false, error: '予約が見つかりません' }, 404);
    }
    if (result === 'locked') {
      return c.json({
        success: false,
        error: '送信処理が始まったか、すでに処理済みの予約です',
        code: 'SCHEDULE_LOCKED',
      }, 409);
    }
    return c.json({ success: true, data: { updated: true } });
  } catch (err) {
    console.error('PATCH /api/chats/:id/scheduled/:scheduleId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** DELETE /api/chats/:id/scheduled/:scheduleId — 予約の取消。scheduled の行だけCAS。 */
chats.delete('/api/chats/:id/scheduled/:scheduleId', requireRole('owner', 'admin', 'staff'), requireVisibleChat, async (c) => {
  try {
    const chatId = c.req.param('id');
    const scheduleId = c.req.param('scheduleId');
    const chat = await getChatById(c.env.DB, chatId)
      ?? await resolveOrCreateChat(c.env.DB, chatId).catch(() => null);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    const result = await cancelScheduledChatSend(c.env.DB, {
      id: scheduleId,
      friendId: chat.friend_id,
      staffId: c.get('staff').id,
      now: new Date().toISOString(),
    });
    if (result === 'not_found') {
      return c.json({ success: false, error: '予約が見つかりません' }, 404);
    }
    if (result === 'locked') {
      return c.json({
        success: false,
        error: '送信処理が始まったか、すでに処理済みの予約です',
        code: 'SCHEDULE_LOCKED',
      }, 409);
    }
    return c.json({ success: true, data: { cancelled: true } });
  } catch (err) {
    console.error('DELETE /api/chats/:id/scheduled/:scheduleId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { chats };
