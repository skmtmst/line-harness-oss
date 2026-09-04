import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Message } from '@line-crm/line-sdk';
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
  type SavedSearch,
  type SavedSearchAccess,
  jstNow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { listLimit } from './list-pagination.js';
import { resolveLineToken } from '../services/line-token.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  completeOutboundSendStatement,
  hashOutboundPayload,
  isValidIdempotencyKey,
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

async function inboxSavedViewAccess(c: Context<Env>): Promise<SavedSearchAccess | Response> {
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

function serializeInboxSavedView(row: SavedSearch) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    conditions: JSON.parse(row.conditions_json) as unknown,
    createdBy: row.created_by,
    lineAccountId: row.line_account_id,
    isShared: Boolean(row.is_shared),
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

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

chats.get('/api/chats', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff');
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const query = (c.req.query('q') ?? '').trim().slice(0, 200);
    const visibleScope = await getVisibleLineAccountScope(c.env.DB, staff);
    if (lineAccountId && !visibleScope.allowedAccountIds.includes(lineAccountId)) {
      return c.json({ success: false, error: '受信箱が見つかりません' }, 404);
    }
    const unansweredOnly =
      c.req.query('unansweredOnly') === 'true' || c.req.query('unansweredOnly') === '1';

    if (unansweredOnly) {
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
      conditions.push('c.operator_id = ?');
      conditionBindings.push(operatorId);
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
    const pageNeedsChats = Boolean(status || operatorId);

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
          CASE WHEN message_type = 'text' THEN SUBSTR(content, 1, 200) ELSE NULL END AS content,
          direction, message_type,
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

    // 新しい1000件を取って昇順に戻す。LIMIT 200 ASC だと古い200件だけで broadcast/scenario 等の
    // 新しい push が欠落していた（Shu で 481件中 281件欠落のバグあり）。一覧側と同様に test 配信は除外。
    // 現状の最重量ユーザー(481件)の2倍バッファ。これ以上の履歴はページング未実装（Phase 2 TODO）。
    const messages = await c.env.DB
      .prepare(
        `SELECT id, friend_id, direction, message_type, content, source, origin_kind,
                sent_by_staff_id,
                (SELECT name FROM staff_members sm WHERE sm.id = messages_log.sent_by_staff_id) AS sent_by_staff_name,
                (SELECT s.name FROM scenario_steps ss
                  JOIN scenarios s ON s.id = ss.scenario_id
                  WHERE ss.id = messages_log.scenario_step_id) AS scenario_name,
                created_at
         FROM messages_log
         WHERE friend_id = ? AND (delivery_type IS NULL OR delivery_type != 'test')
         ORDER BY created_at DESC LIMIT 1000`,
      )
      .bind(resolvedFriendId)
      .all();
    messages.results = (messages.results as Record<string, unknown>[]).reverse();

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
        messages: (messages.results as Record<string, unknown>[]).map((m) => ({
          id: m.id,
          direction: m.direction,
          messageType: m.message_type,
          content: m.content,
          source: m.source || null,
          originKind: m.origin_kind || null,
          sentByStaffId: m.sent_by_staff_id || null,
          sentByStaffName: m.sent_by_staff_name || null,
          scenarioName: m.scenario_name || null,
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
  return c.json({
    success: true,
    data: rows
      .filter((row) => row.scope === 'chats'
        && (row.line_account_id === access.lineAccountId
          ? access.canManageAll || Boolean(row.is_shared) || row.created_by === access.staffId
          : row.line_account_id === null && row.created_by === access.staffId))
      .map(serializeInboxSavedView),
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

    const body = await c.req.json<{ messageType?: string; content: string; revision?: number }>();
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
      message = { type: 'text', text: body.content };
    } else if (messageType === 'flex') {
      const contents = JSON.parse(body.content);
      message = { type: 'flex', altText: extractFlexAltText(contents), contents };
    } else if (messageType === 'image') {
      const parsed = JSON.parse(body.content) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
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

    const payloadHash = await hashOutboundPayload(
      JSON.stringify({ chatId: chat.id, friendId: friend.id, messageType, content: body.content }),
    );
    const reservation = await reserveOutboundSend(c.env.DB, {
      key: idempotencyKey,
      channel: 'line',
      resourceId: chat.id,
      payloadHash,
      retryInProgress: true,
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
      return c.json({ success: false, error: '同じメッセージを送信中です' }, 409);
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
    await lineClient.pushMessage(friend.line_user_id, [message], idempotencyKey);

    // メッセージログに記録
    const logId = idempotencyKey;
    const sentAt = jstNow();
    await c.env.DB.batch([
      c.env.DB
        .prepare(`INSERT OR IGNORE INTO messages_log
          (id, friend_id, direction, message_type, content, source, line_account_id,
           sent_by_staff_id, created_at)
          VALUES (?, ?, 'outgoing', ?, ?, 'manual', ?, ?, ?)`)
        .bind(
          logId,
          friend.id,
          messageType,
          body.content,
          friend.line_account_id ?? null,
          c.get('staff').id,
          sentAt,
        ),
      completeOutboundSendStatement(c.env.DB, {
        key: idempotencyKey,
        responseId: logId,
        now: new Date().toISOString(),
      }),
    ]);

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

export { chats };
