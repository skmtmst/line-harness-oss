import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getFriends,
  getFriendById,
  getFriendAddBreakdown,
  addTagToFriend,
  removeTagFromFriend,
  getFriendTags,
  getFriendTagsByFriendIds,
  getFormSubmissionsByFriend,
  getScenarios,
  enrollFriendInScenario,
  getMileageSummaryForFriend,
  getMileageHistoryForFriend,
  getMileageSelfInsights,
  getMileageConnectedAccountsForFriend,
  jstNow,
  getTagAddedScenarioIds,
  getSavedSearchById,
  validateSearchConditions,
} from '@line-crm/db';
import type { Friend as DbFriend, Tag as DbTag } from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { buildMessage } from '../services/step-delivery.js';
import type { Env } from '../index.js';
import { resolveLineToken } from '../services/line-token.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import {
  completeOutboundSendStatement,
  hashOutboundPayload,
  isValidIdempotencyKey,
  reserveOutboundSend,
} from '../services/outbound-idempotency.js';
import { compileSavedSearch } from '../services/saved-search-filter.js';
import { listLimit, listOffset } from './list-pagination.js';

const friends = new Hono<Env>();

async function adminAccountScope(c: Context<Env>, alias = '') {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const column = `${alias}line_account_id`;
  const where = scope.allowedAccountIds.length
    ? `(${column} IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ` OR ${column} IS NULL` : ''})`
    : scope.canSeeUnassigned
      ? `${column} IS NULL`
      : '1 = 0';
  return { scope, where };
}

const requireVisibleFriend: MiddlewareHandler<Env> = async (c, next) => {
  const friend = await getFriendById(c.env.DB, c.req.param('id') ?? '');
  const accountId = friend
    ? ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null
    : null;
  if (!friend || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Friend not found' }, 404);
  }
  await next();
};

const requireIdempotencyKey: MiddlewareHandler<Env> = async (c, next) => {
  if (!isValidIdempotencyKey(c.req.header('Idempotency-Key')?.trim())) {
    return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
  }
  await next();
};

/**
 * Convert a D1 snake_case Friend row to the shared camelCase shape.
 *
 * Bare-row variant — emits ONLY columns that exist on the friends table.
 * Used by GET /api/friends/:id and metadata-update responses where we read
 * via plain `getFriendById()` and have no JOINed columns. The list endpoint
 * uses `serializeFriendListRow` instead, which adds firstTrackedLinkName +
 * chatStatus from the JOINed query.
 */
function serializeFriend(row: DbFriend) {
  return {
    id: row.id,
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    statusMessage: row.status_message,
    isFollowing: Boolean(row.is_following),
    metadata: JSON.parse(row.metadata || '{}'),
    refCode: (row as unknown as Record<string, unknown>).ref_code as string | null,
    lineAccountId: ((row as unknown as Record<string, unknown>).line_account_id as string | null) ?? null,
    userId: row.user_id,
    // 100 で足した列。友だち詳細（設計 `友だち詳細` の「名前」）が読む。
    // LINEの表示名と、こちらで付けた本名は別物。取り違えると別人に送るので、
    // 画面で両方を並べて出せるように、ここから返す。
    realName: ((row as unknown as Record<string, unknown>).real_name as string | null) ?? null,
    systemDisplayName:
      ((row as unknown as Record<string, unknown>).system_display_name as string | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Friend serializer for the list endpoint. Adds firstTrackedLinkName +
 * chatStatus from the JOINed query, present only when the caller opted into
 * the chat-status path (?includeChatStatus=true). When absent, the fields
 * default to nullish so the response shape stays consistent for clients that
 * don't request them.
 */
function serializeFriendListRow(
  row: DbFriend & {
    first_tracked_link_name?: string | null;
    chat_status?: string | null;
    operator_id?: string | null;
    operator_name?: string | null;
    support_mark_id?: string | null;
    support_mark_name?: string | null;
    support_mark_color?: string | null;
  },
  includeChatStatus: boolean,
) {
  const base = serializeFriend(row);
  if (!includeChatStatus) return base;
  return {
    ...base,
    // L-step style "ASP_LP名" — the campaign/landing-page name the friend
    // entered through, attributed once at friend-add time and never
    // overwritten (see migration 022). LEFT JOINed in the list query.
    firstTrackedLinkName: row.first_tracked_link_name ?? null,
    // chats.status defaulted to 'resolved' for friends without a chats row
    // (matches /api/chats listing). Friend-list and chats-list now agree on
    // 未対応/対応中/対応済み state.
    chatStatus: (row.chat_status ?? 'resolved') as 'unread' | 'in_progress' | 'resolved',
    operatorId: row.operator_id ?? null,
    operatorName: row.operator_name ?? null,
    supportMarkId: row.support_mark_id ?? null,
    supportMarkName: row.support_mark_name ?? null,
    supportMarkColor: row.support_mark_color ?? null,
  };
}

/** Convert a D1 snake_case Tag row to the shared camelCase shape */
function serializeTag(row: DbTag) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

// GET /api/friends - list with pagination
friends.get('/api/friends', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const limit = listLimit(c.req.query('limit'), 50);
    const offset = listOffset(c.req.query('offset'));
    const tagId = c.req.query('tagId');
    const lineAccountId = c.req.query('lineAccountId');
    const audienceId = c.req.query('audienceId')?.trim();
    const search = c.req.query('search');
    // ?includeTags=false skips per-row tag enrichment (N+1 of getFriendTags
    // → ~50 extra D1 reads on a wide list query). The list view needs tags
    // for filter chips, but autocomplete-style consumers (test-recipient
    // picker, broadcast recipient picker) only render id/displayName/picture
    // and pay the cost for nothing. Default true to keep the historical
    // behavior for existing callers.
    const includeTags = c.req.query('includeTags') !== 'false';
    // ?includeChatStatus=true — populate latestIncomingMessage,
    // latestOutgoingAt, activeScenario, and a derived `handled` flag for
    // each friend. Used by the L-step-style /friends listing; off by
    // default to keep the simple list / autocomplete paths cheap.
    const includeChatStatus = c.req.query('includeChatStatus') === 'true';
    // ?sort=oldest reverses default created_at DESC. Default = recent-first.
    // Search mode (when `search` is set) overrides both — we keep the
    // match-quality ranking and only flip the secondary `created_at` tier.
    const sort: 'recent' | 'oldest' = c.req.query('sort') === 'oldest' ? 'oldest' : 'recent';
    // ?handled=unhandled filters to friends whose latest activity is an
    // incoming message (mirroring the L-step "未対応" tab). Done in SQL so
    // pagination + total counts are correct; client-side filter would only
    // hide rows on the current page and leave `total` misleading.
    const handledFilter: 'unhandled' | null =
      c.req.query('handled') === 'unhandled' ? 'unhandled' : null;
    const operatorId = c.req.query('operatorId');
    const scenarioId = c.req.query('scenarioId');
    const parseScoreBoundary = (name: 'scoreMin' | 'scoreMax') => {
      const raw = c.req.query(name);
      if (raw === undefined) return { provided: false, value: 0 };
      if (!/^-?\d+$/.test(raw)) return null;
      const value = Number(raw);
      return Number.isSafeInteger(value) ? { provided: true, value } : null;
    };
    const scoreMin = parseScoreBoundary('scoreMin');
    const scoreMax = parseScoreBoundary('scoreMax');
    if (!scoreMin || !scoreMax || (scoreMin.provided && scoreMax.provided && scoreMin.value > scoreMax.value)) {
      return c.json({ success: false, error: 'scoreMin and scoreMax must be integers with min <= max' }, 400);
    }
    const savedSearchId = c.req.query('savedSearchId');

    const db = c.env.DB;
    const staff = c.get('staff');

    if (lineAccountId && !await canAccessAllLineAccounts(db, staff, [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    if (audienceId) {
      if (staff.role !== 'owner' && staff.role !== 'admin') {
        return c.json({ success: false, error: '対象者の個人一覧を表示する権限がありません' }, 403);
      }
      if (!lineAccountId) {
        return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
      }
      const audience = await db.prepare(
        `SELECT id, expires_at FROM analytics_result_audiences
          WHERE id = ? AND line_account_id = ?`,
      ).bind(audienceId, lineAccountId).first<{ id: string; expires_at: string }>();
      if (!audience) return c.json({ success: false, error: 'Not found' }, 404);
      if (audience.expires_at <= new Date().toISOString()) {
        return c.json({ success: false, error: 'この分析結果の対象者は24時間を過ぎました。もう一度集計してください' }, 410);
      }
    }

    // Build WHERE conditions
    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (tagId) {
      conditions.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
      binds.push(tagId);
    }
    if (audienceId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM analytics_result_audience_members arm
          WHERE arm.audience_id = ? AND arm.friend_id = f.id
        )`,
      );
      binds.push(audienceId);
    }
    if (lineAccountId) {
      const visibleScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!visibleScope.allowedAccountIds.includes(lineAccountId)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      conditions.push('f.line_account_id = ?');
      binds.push(lineAccountId);
    } else {
      const { scope, where } = await adminAccountScope(c, 'f.');
      conditions.push(where);
      binds.push(...scope.allowedAccountIds);
    }
    if (savedSearchId) {
      if (!lineAccountId) {
        return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
      }
      const row = await getSavedSearchById(db, savedSearchId, lineAccountId);
      const staff = c.get('staff');
      if (!row
          || row.scope !== 'friends'
          || (!row.is_shared && row.created_by !== staff.id && staff.role !== 'owner' && staff.role !== 'admin')) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      let rawConditions: unknown;
      try {
        rawConditions = JSON.parse(row.conditions_json);
      } catch {
        return c.json({ success: false, error: '保存した検索の条件が壊れています' }, 422);
      }
      const validated = validateSearchConditions(rawConditions);
      if (!validated.ok) {
        return c.json({ success: false, error: validated.error }, 422);
      }
      const compiled = compileSavedSearch(validated.value);
      if (!compiled.ok) {
        return c.json({ success: false, error: compiled.error }, 422);
      }
      conditions.push(compiled.value.sql);
      binds.push(...compiled.value.binds);
    }
    if (search) {
      conditions.push('f.display_name LIKE ?');
      binds.push(`%${search}%`);
    }
    if (scoreMin.provided) {
      conditions.push('f.score >= ?');
      binds.push(scoreMin.value);
    }
    if (scoreMax.provided) {
      conditions.push('f.score <= ?');
      binds.push(scoreMax.value);
    }
    // Unhandled filter: chats.status === 'unread'.
    //
    // We derive 対応マーク from chats.status — the same model the /chats UI
    // uses — instead of inferring from messages_log timestamps. Reasons:
    //   - silent auto-replies / postbacks intentionally do NOT flip the
    //     chat to unread (see webhook.ts), so a timestamp-based heuristic
    //     would mark them as 未対応 against the operator's intent
    //   - operators explicitly mark 対応済み (resolved) / 対応中 (in_progress)
    //     via the chats UI, and that state must be honored here
    //   - friends without any chat row default to 'resolved' (lazy-create
    //     in chats.ts:88 also seeds with 'resolved'), matching the chats
    //     listing's COALESCE(c.status, 'resolved') convention
    if (handledFilter === 'unhandled') {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM chats c
          WHERE c.friend_id = f.id AND c.status = 'unread'
        )`,
      );
    }
    if (operatorId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM chats c
          WHERE c.friend_id = f.id AND c.operator_id = ?
        )`,
      );
      binds.push(operatorId);
    }
    if (scenarioId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM friend_scenarios fs
          WHERE fs.friend_id = f.id
            AND fs.scenario_id = ?
            AND fs.status IN ('active', 'delivering')
        )`,
      );
      binds.push(scenarioId);
    }
    // Metadata filters: ?metadata.key=value (e.g. ?metadata.monthly_cost=〜100万円)
    // ?metadataNot.key=value is the「等しくない」side. 値を持たない人も含める
    // （項目そのものが無い人を外すと、絞り込みの意味が変わる）。
    const url = new URL(c.req.url);
    for (const [key, value] of url.searchParams.entries()) {
      if (key.startsWith('metadata.')) {
        const metaKey = key.slice('metadata.'.length);
        conditions.push(`json_extract(f.metadata, '$.' || ?) = ?`);
        binds.push(metaKey, value);
      } else if (key.startsWith('metadataNot.')) {
        const metaKey = key.slice('metadataNot.'.length);
        conditions.push(
          `(json_extract(f.metadata, '$.' || ?) IS NULL OR json_extract(f.metadata, '$.' || ?) != ?)`,
        );
        binds.push(metaKey, metaKey, value);
      }
    }

    /*
     * 詳細検索（設計 V2 2-2 の「絞り込み条件を設定」）の受け口。
     *
     * どれも足し算で、指定が無ければ何も起きない。既にある tagId / search /
     * handled はそのまま残してある（一覧やオートコンプリートが使っている）。
     */

    /** タグを複数（すべて満たす）。`?tagIds=a,b` */
    const tagIds = (c.req.query('tagIds') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    for (const t of tagIds) {
      conditions.push(
        'EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)',
      );
      binds.push(t);
    }

    /** このタグが付いていない人。`?excludeTagIds=a,b` */
    const excludeTagIds = (c.req.query('excludeTagIds') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    for (const t of excludeTagIds) {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)',
      );
      binds.push(t);
    }

    /** ステータスメッセージに含む。`?statusMessage=...` */
    const statusMessage = c.req.query('statusMessage');
    if (statusMessage) {
      conditions.push('f.status_message LIKE ?');
      binds.push(`%${statusMessage}%`);
    }

    /** 友だち登録日の範囲。`?createdFrom=YYYY-MM-DD&createdTo=YYYY-MM-DD` */
    const createdFrom = c.req.query('createdFrom');
    if (createdFrom) {
      conditions.push('f.created_at >= ?');
      binds.push(createdFrom);
    }
    const createdTo = c.req.query('createdTo');
    if (createdTo) {
      // その日の終わりまで含める。日付だけで比べると当日ぶんが落ちる。
      conditions.push('f.created_at <= ?');
      binds.push(`${createdTo}T23:59:59.999`);
    }

    /**
     * 対応マーク。chats は友だちごとに1行なので、その現在値を見る。
     */
    const chatStatus = c.req.query('chatStatus');
    if (chatStatus && ['unread', 'in_progress', 'on_hold', 'resolved'].includes(chatStatus)) {
      conditions.push(
        `COALESCE(
           (SELECT status FROM chats c
            WHERE c.friend_id = f.id),
           'resolved'
         ) = ?`,
      );
      binds.push(chatStatus);
    }

    /** 表示設定。`?visibility=following|blocked` 既定は指定なし（全部） */
    const visibility = c.req.query('visibility');
    if (visibility === 'following') {
      conditions.push('f.is_following = 1');
    } else if (visibility === 'blocked') {
      conditions.push('f.is_following = 0');
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM friends f ${where}`);
    const totalRow = await (binds.length > 0 ? countStmt.bind(...binds) : countStmt).first<{ count: number }>();
    const total = totalRow?.count ?? 0;

    // When `search` is present we want exact / prefix matches to surface
    // first regardless of friend age. Plain `ORDER BY created_at DESC`
    // pushes the most-likely candidate (e.g. the operator themselves,
    // friended on day-one of the account) below recently-added friends
    // whose displayName happens to contain the same substring. The
    // CASE expression below ranks: exact (0) → prefix (1) → word-start (2)
    // → generic substring (3), then created_at DESC inside each tier.
    //
    // - The exact tier uses `LIKE ?` (no wildcards) instead of `= ?` so
    //   SQLite's ASCII case-insensitive `LIKE` lets `shu` match `Shu`.
    //   Plain `=` is byte-exact and would relegate that row to tier 1
    //   alongside `Shun` / `shuji`, defeating the rerank.
    // - Word-start patterns include both ASCII space and full-width
    //   so Japanese names like `山田　太郎` match on the second name part.
    // The tracked_links / chats / operators JOINs are only needed when the
    // caller requested chat status. Skipping them on autocomplete-style calls
    // (?includeChatStatus omitted, includeTags=false) keeps a single keystroke
    // cheap. List view enables it.
    //
    // chats は migration 048 以降「1 friend = 1 chat」の UNIQUE 制約を持つ。
    // 同じ行から状態・担当ID・担当名を読むため、別々の相関サブクエリで
    // IDと名前がずれることも、行ごとに同じ検索を繰り返すこともない。
    const baseSelect = includeChatStatus
      ? `f.*, tl.name AS first_tracked_link_name,
         COALESCE(lc.status, 'resolved') AS chat_status,
         lc.operator_id AS operator_id,
         op.name AS operator_name,
         sm.id AS support_mark_id,
         sm.name AS support_mark_name,
         sm.color AS support_mark_color`
      : `f.*`;
    const baseFrom = includeChatStatus
      ? `FROM friends f
         LEFT JOIN tracked_links tl ON tl.id = f.first_tracked_link_id
         LEFT JOIN chats lc ON lc.friend_id = f.id
         LEFT JOIN operators op ON op.id = lc.operator_id
         LEFT JOIN support_marks sm ON sm.id = f.support_mark_id`
      : `FROM friends f`;
    // Secondary tier of the search-mode ORDER BY (after match_score) and the
    // primary tier in non-search mode. Switched by ?sort=oldest|recent.
    const createdOrder = sort === 'oldest' ? 'ASC' : 'DESC';
    let listStmt;
    let listBinds: unknown[];
    if (search) {
      const exactPattern = search;
      const prefixPattern = `${search}%`;
      const wordStartAscii = `% ${search}%`;
      const wordStartFullWidth = `%　${search}%`;
      listStmt = db.prepare(
        `SELECT ${baseSelect},
                CASE
                  WHEN f.display_name LIKE ? THEN 0
                  WHEN f.display_name LIKE ? THEN 1
                  WHEN f.display_name LIKE ? OR f.display_name LIKE ? THEN 2
                  ELSE 3
                END AS match_score
         ${baseFrom} ${where}
         ORDER BY match_score ASC, f.created_at ${createdOrder}
         LIMIT ? OFFSET ?`,
      );
      listBinds = [exactPattern, prefixPattern, wordStartAscii, wordStartFullWidth, ...binds, limit, offset];
    } else {
      listStmt = db.prepare(
        `SELECT ${baseSelect} ${baseFrom} ${where} ORDER BY f.created_at ${createdOrder} LIMIT ? OFFSET ?`,
      );
      listBinds = [...binds, limit, offset];
    }
    const listResult = await listStmt.bind(...listBinds).all<DbFriend>();
    const items = listResult.results;

    // 表示ページ分のタグを1回で取得する。友だちごとの問い合わせは行わない。
    // includeTags=false のオートコンプリート経路では、この1回も省略する。
    const tagsByFriendId = includeTags
      ? await getFriendTagsByFriendIds(db, items.map((friend) => friend.id))
      : new Map<string, DbTag[]>();
    let itemsWithTags = items.map((friend) => ({
      ...serializeFriendListRow(friend, includeChatStatus),
      tags: (tagsByFriendId.get(friend.id) ?? []).map(serializeTag),
    }));

    // Optional: hydrate chat status (latest in/out message, active scenario,
    // derived "handled" flag). Three batched queries instead of N×3 to keep
    // the request cheap even at limit=50. ROW_NUMBER() picks the freshest
    // row per friend; SQLite supports window functions on D1.
    if (includeChatStatus && items.length > 0) {
      const ids = items.map((f) => f.id);
      const placeholders = ids.map(() => '?').join(',');

      type IncomingRow = { friend_id: string; content: string; message_type: string; created_at: string };
      type OutgoingRow = { friend_id: string; max_at: string };
      type ScenarioRow = { friend_id: string; scenario_name: string; status: string };

      const [incomingRes, outgoingRes, scenarioRes] = await Promise.all([
        db
          .prepare(
            `SELECT friend_id, content, message_type, created_at FROM (
               SELECT friend_id, content, message_type, created_at,
                      ROW_NUMBER() OVER (PARTITION BY friend_id ORDER BY created_at DESC) AS rn
               FROM messages_log
               WHERE direction = 'incoming' AND friend_id IN (${placeholders})
             ) WHERE rn = 1`,
          )
          .bind(...ids)
          .all<IncomingRow>(),
        db
          .prepare(
            // delivery_type='test' は実顧客への配信ではない (テスト送信先への
            // ブロードキャスト)。/api/chats など他のチャット系ビューも同じく
            // test 配信を除外して "活動" を判定するので、そちらと整合させる。
            // 含めると、テスト送信先に登録されたまま実 incoming を放置している
            // 友だちの handled が誤って true に flip する事故が起きる。
            `SELECT friend_id, MAX(created_at) AS max_at FROM messages_log
             WHERE direction = 'outgoing'
               AND (delivery_type IS NULL OR delivery_type != 'test')
               AND friend_id IN (${placeholders})
             GROUP BY friend_id`,
          )
          .bind(...ids)
          .all<OutgoingRow>(),
        db
          .prepare(
            `SELECT fs.friend_id, s.name AS scenario_name, fs.status FROM (
               SELECT friend_id, scenario_id, status,
                      ROW_NUMBER() OVER (PARTITION BY friend_id ORDER BY started_at DESC) AS rn
               FROM friend_scenarios
               WHERE status IN ('active', 'delivering') AND friend_id IN (${placeholders})
             ) fs
             JOIN scenarios s ON s.id = fs.scenario_id
             WHERE fs.rn = 1`,
          )
          .bind(...ids)
          .all<ScenarioRow>(),
      ]);

      const incomingByFriend = new Map(incomingRes.results.map((r) => [r.friend_id, r]));
      const outgoingByFriend = new Map(outgoingRes.results.map((r) => [r.friend_id, r.max_at]));
      const scenarioByFriend = new Map(scenarioRes.results.map((r) => [r.friend_id, r]));

      // We're inside `if (includeChatStatus)` so every row was emitted by
      // serializeFriendListRow with chatStatus populated. TS can't narrow
      // through the union, so assert the populated shape locally.
      type WithChatStatus = (typeof itemsWithTags)[number] & {
        chatStatus: 'unread' | 'in_progress' | 'resolved';
        operatorId?: string | null;
        operatorName?: string | null;
        supportMarkId?: string | null;
        supportMarkName?: string | null;
        supportMarkColor?: string | null;
      };
      itemsWithTags = (itemsWithTags as WithChatStatus[]).map((f) => {
        const inc = incomingByFriend.get(f.id);
        const outAt = outgoingByFriend.get(f.id);
        const sc = scenarioByFriend.get(f.id);
        // 対応済み判定は chats.status 一本。messages_log の出入り時刻ではなく、
        // /chats 画面が見ている persisted state を使う。silent auto-reply や
        // postback のように "incoming だが unread にしない" イベントもあるので、
        // タイムスタンプベースで推測すると /chats と乖離する。
        const handled = f.chatStatus !== 'unread';
        return {
          ...f,
          latestIncomingMessage: inc
            ? { content: inc.content, messageType: inc.message_type, createdAt: inc.created_at }
            : null,
          latestOutgoingAt: outAt ?? null,
          activeScenario: sc ? { name: sc.scenario_name, status: sc.status } : null,
          operator:
            f.operatorId && f.operatorName
              ? { id: f.operatorId, name: f.operatorName }
              : null,
          supportMark:
            f.supportMarkId && f.supportMarkName
              ? {
                  id: f.supportMarkId,
                  name: f.supportMarkName,
                  color: f.supportMarkColor ?? '#8B938D',
                }
              : null,
          handled,
        };
      });
    }

    return c.json({
      success: true,
      data: {
        items: itemsWithTags,
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
        hasNextPage: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('GET /api/friends error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/count - friend count (must be before /:id)
// 友だち追加の内訳（設計 V2 4-6）。「はじめての人」と「以前からの友だち」を
// 分けて数える。追加時の配信を1本しか持てないうちは、returning の人数が
// そのまま「はじめまして」を誤って送った人数になる。
friends.get('/api/friends/add-breakdown', async (c) => {
  try {
    const days = Number(c.req.query('days') ?? '30');
    const lineAccountId = c.req.query('lineAccountId') ?? null;
    const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
    const statsScope = lineAccountId
      ? { allowedAccountIds: [lineAccountId], includeUnassigned: false }
      : await getVisibleLineAccountScope(c.env.DB, c.get('staff')).then((scope) => ({
          allowedAccountIds: scope.allowedAccountIds,
          includeUnassigned: scope.canSeeUnassigned,
        }));
    const data = await getFriendAddBreakdown(c.env.DB, safeDays, statsScope);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/friends/add-breakdown error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friends.get('/api/friends/count', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let count: number;
    if (lineAccountId) {
      const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?')
        .bind(lineAccountId).first<{ count: number }>();
      count = row?.count ?? 0;
    } else {
      const { scope, where } = await adminAccountScope(c);
      const row = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND ${where}`)
        .bind(...scope.allowedAccountIds).first<{ count: number }>();
      count = row?.count ?? 0;
    }
    return c.json({ success: true, data: { count } });
  } catch (err) {
    console.error('GET /api/friends/count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/ref-stats - ref code attribution stats
friends.get('/api/friends/ref-stats', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const accountScope = lineAccountId ? null : await adminAccountScope(c);
    const where = lineAccountId ? 'line_account_id = ?' : accountScope!.where;
    const binds = lineAccountId ? [lineAccountId] : accountScope!.scope.allowedAccountIds;
    const stmt = c.env.DB.prepare(
      `SELECT ref_code, COUNT(*) as count FROM friends WHERE ${where} AND ref_code IS NOT NULL GROUP BY ref_code ORDER BY count DESC`,
    );
    const result = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<{ ref_code: string; count: number }>();
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM friends WHERE ${where} AND ref_code IS NOT NULL`,
    ).bind(...binds).first<{ count: number }>();
    return c.json({
      success: true,
      data: {
        routes: result.results.map((r) => ({ refCode: r.ref_code, friendCount: r.count })),
        totalWithRef: total?.count ?? 0,
      },
    });
  } catch (err) {
    console.error('GET /api/friends/ref-stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id/mileage - admin wallet summary + recent ledger history
friends.get('/api/friends/:id/mileage', requireVisibleFriend, async (c) => {
  try {
    const friendId = c.req.param('id');
    const friend = await getFriendById(c.env.DB, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const requestedAccountId = c.req.query('accountId')?.trim();
    const friendAccountId =
      ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
    if (requestedAccountId && friendAccountId !== requestedAccountId) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 10;
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const [summary, history, insights, connections] = await Promise.all([
      getMileageSummaryForFriend(c.env.DB, friendId),
      getMileageHistoryForFriend(c.env.DB, friendId, { limit }),
      getMileageSelfInsights(c.env.DB, friendId),
      getMileageConnectedAccountsForFriend(c.env.DB, friendId, accountScope.allowedAccountIds),
    ]);
    return c.json({ success: true, data: { summary, history, insights, connections } });
  } catch (err) {
    console.error('GET /api/friends/:id/mileage error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id - get single friend with tags
/**
 * 友だち画面の上部に出す数（設計 `V2 2-2 友だち` の KPIs）。
 *
 * :id より前に置くこと。あとに置くと 'stats' が id として拾われる。
 */
friends.get('/api/friends/stats', async (c) => {
  try {
    const { getFriendStats } = await import('@line-crm/db');
    const accountId = c.req.query('accountId') ?? null;
    const statsScope = accountId
      ? { allowedAccountIds: [accountId], includeUnassigned: false }
      : await getVisibleLineAccountScope(c.env.DB, c.get('staff')).then((scope) => ({
          allowedAccountIds: scope.allowedAccountIds,
          includeUnassigned: scope.canSeeUnassigned,
        }));
    const stats = await getFriendStats(c.env.DB, statsScope);
    return c.json({ success: true as const, data: stats });
  } catch (err) {
    console.error('GET /api/friends/stats error:', err);
    return c.json({ success: false as const, error: '友だちの集計を取得できませんでした' }, 500);
  }
});

friends.get('/api/friends/:id', requireVisibleFriend, async (c) => {
  try {
    const id = c.req.param('id');
    const db = c.env.DB;

    const [friend, tags, formSubmissions, support] = await Promise.all([
      getFriendById(db, id),
      getFriendTags(db, id),
      getFormSubmissionsByFriend(db, id, 10),
      /*
       * 対応の状況（対応マーク・担当者・個別メモ）。
       *
       * 詳細画面はこれを出す設計だが、これまで返していなかったので
       * 「受信箱で扱っています」という案内文しか置けなかった。同じ人の
       * 話を2画面に分けて見に行くことになる。
       *
       * chats に行が無い友だちもいる（一度も受信していない）。その場合は
       * 未対応でも対応済みでもなく「やり取りがまだ無い」なので null を返し、
       * 画面側で出し分ける。
       */
      db
        .prepare(
          `SELECT c.status, c.notes, o.name AS operator_name
             FROM chats c
             LEFT JOIN operators o ON o.id = c.operator_id
            WHERE c.friend_id = ?
            LIMIT 1`,
        )
        .bind(id)
        .first<{ status: string; notes: string | null; operator_name: string | null }>()
        .catch(() => null),
    ]);

    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        ...serializeFriend(friend),
        tags: tags.map(serializeTag),
        support: support
          ? {
              status: support.status,
              operatorName: support.operator_name,
              notes: support.notes,
            }
          : null,
        formSubmissions: formSubmissions.map((submission) => ({
          id: submission.id,
          formId: submission.form_id,
          formName: submission.form_name,
          fields: JSON.parse(submission.form_fields || '[]') as unknown[],
          data: JSON.parse(submission.data || '{}') as Record<string, unknown>,
          createdAt: submission.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/friends/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friends/:id/tags - add tag
friends.post('/api/friends/:id/tags', requireRole('owner', 'admin', 'staff'), requireVisibleFriend, async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ tagId: string }>();

    if (!body.tagId) {
      return c.json({ success: false, error: 'tagId is required' }, 400);
    }

    const db = c.env.DB;
    await addTagToFriend(db, friendId, body.tagId);

    // Enroll in tag_added scenarios that match this tag
    /*
     * 「このタグが付いたら始まる」は scenario_triggers から引く（128）。
     * 1本のシナリオが複数のタグで始まる形も作れるようになったので、
     * scenarios.trigger_tag_id は判断に使わない。
     */
    for (const scenarioId of await getTagAddedScenarioIds(db, body.tagId)) {
      const existing = await db
        .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
        .bind(friendId, scenarioId)
        .first();
      if (!existing) {
        await enrollFriendInScenario(db, friendId, scenarioId);
      }
    }

    // イベントバス発火: tag_change
    await fireEvent(db, 'tag_change', { friendId, eventData: { tagId: body.tagId, action: 'add' } });

    return c.json({ success: true, data: null }, 201);
  } catch (err) {
    console.error('POST /api/friends/:id/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/friends/:id/tags/:tagId - remove tag
friends.delete('/api/friends/:id/tags/:tagId', requireRole('owner', 'admin', 'staff'), requireVisibleFriend, async (c) => {
  try {
    const friendId = c.req.param('id');
    const tagId = c.req.param('tagId');

    await removeTagFromFriend(c.env.DB, friendId, tagId);

    // イベントバス発火: tag_change
    await fireEvent(c.env.DB, 'tag_change', { friendId, eventData: { tagId, action: 'remove' } });

    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friends/:id/tags/:tagId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/friends/:id/metadata - merge metadata fields
friends.put('/api/friends/:id/metadata', requireRole('owner', 'admin', 'staff'), requireVisibleFriend, async (c) => {
  try {
    const friendId = c.req.param('id');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const body = await c.req.json<Record<string, unknown>>();
    const merged = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (value === null) delete merged[key];
      else if (typeof value === 'string') merged[key] = value;
      else return c.json({ success: false, error: 'metadata values must be string or null' }, 400);
    }
    const now = jstNow();

    await db
      .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(merged), now, friendId)
      .run();

    const updated = await getFriendById(db, friendId);
    const tags = await getFriendTags(db, friendId);

    return c.json({
      success: true,
      data: {
        ...serializeFriend(updated!),
        tags: tags.map(serializeTag),
      },
    });
  } catch (err) {
    console.error('PUT /api/friends/:id/metadata error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id/messages - get message history
friends.get('/api/friends/:id/messages', requireVisibleFriend, async (c) => {
  try {
    const friendId = c.req.param('id');
    // Fetch the latest 200 messages (DESC) then reverse to ASC for display.
    // Using ORDER BY ASC LIMIT 200 returns the OLDEST 200 rows, which silently
    // hides recent activity for chatty friends. Exclude delivery_type='test'
    // to stay consistent with /api/chats/:id, so the same friend shows the
    // same history across DirectMessagePanel and the chat panel.
    const result = await c.env.DB
      .prepare(
        `SELECT id, direction, message_type as messageType, content, created_at as createdAt
         FROM messages_log WHERE friend_id = ?
           AND (delivery_type IS NULL OR delivery_type != 'test')
         ORDER BY created_at DESC LIMIT 200`,
      )
      .bind(friendId)
      .all<{ id: string; direction: string; messageType: string; content: string; createdAt: string }>();
    return c.json({ success: true, data: result.results.reverse() });
  } catch (err) {
    console.error('GET /api/friends/:id/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friends/:id/messages - send message to friend
friends.post('/api/friends/:id/messages', requireRole('owner', 'admin', 'staff'), requireIdempotencyKey, requireVisibleFriend, async (c) => {
  try {
    const friendId = c.req.param('id');
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
    }
    const body = await c.req.json<{
      messageType?: string;
      content: string;
      altText?: string;
      trackLinks?: boolean;
    }>();

    if (!body.content) {
      return c.json({ success: false, error: 'content is required' }, 400);
    }

    const db = c.env.DB;
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const messageType = body.messageType ?? 'text';
    const payloadHash = await hashOutboundPayload(
      JSON.stringify({
        friendId: friend.id,
        messageType,
        content: body.content,
        altText: body.altText,
        trackLinks: body.trackLinks !== false,
      }),
    );
    const reservation = await reserveOutboundSend(db, {
      key: idempotencyKey,
      channel: 'line',
      resourceId: friend.id,
      payloadHash,
      retryInProgress: true,
      now: new Date().toISOString(),
    });
    if (reservation.kind === 'conflict') {
      return c.json({ success: false, error: '同じ送信キーを別の内容には使用できません' }, 409);
    }
    if (reservation.kind === 'in_progress') {
      return c.json({ success: false, error: '同じメッセージを送信中です' }, 409);
    }
    if (reservation.kind === 'replay') {
      return c.json({ success: true, data: { messageId: reservation.responseId, replayed: true } });
    }

    const { LineClient } = await import('@line-crm/line-sdk');
    // Resolve access token from friend's account (multi-account support)
    let accountToken: string | null = null;
    const friendAccountId =
      ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
    if (friendAccountId) {
      const { getLineAccountById } = await import('@line-crm/db');
      const account = await getLineAccountById(db, friendAccountId);
      accountToken = account?.channel_access_token ?? null;
    }
    const accessToken = resolveLineToken({
      accountToken,
      defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      accountId: friendAccountId,
      context: 'friends.direct-send',
    });
    const lineClient = new LineClient(accessToken);

    // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
    // trackLinks=false で明示的に短縮 OFF (URL をそのまま送る)
    const sendWorkerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    let tracked = { messageType, content: body.content };
    if (body.trackLinks !== false) {
      const { autoTrackContent } = await import('../services/auto-track.js');
      tracked = await autoTrackContent(
        db, messageType, body.content,
        sendWorkerUrl,
        { lineAccountId: friendAccountId },
      );
    }
    // 1:1 送信なので /t リンクに f=<friendId> を焼き込み、LIFF 識別ホップなしで
    // クリック帰属できるようにする（既存 /t リンクにも効くので trackLinks に関わらず実施）
    {
      const { appendFriendToTrackedLinks } = await import('../services/auto-track.js');
      tracked = {
        ...tracked,
        content: await appendFriendToTrackedLinks(db, tracked.content, sendWorkerUrl, friend.id),
      };
    }

    const message = buildMessage(tracked.messageType, tracked.content, body.altText);
    await lineClient.pushMessage(friend.line_user_id, [message], idempotencyKey);

    // Log outgoing message
    const logId = idempotencyKey;
    const sentAt = jstNow();
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO messages_log (
           id, friend_id, direction, message_type, content, broadcast_id,
           scenario_step_id, source, line_account_id, created_at
         ) VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'manual', ?, ?)`,
      )
        .bind(logId, friend.id, tracked.messageType, tracked.content, friendAccountId, sentAt),
      completeOutboundSendStatement(db, {
        key: idempotencyKey,
        responseId: logId,
        now: new Date().toISOString(),
      }),
    ]);

    return c.json({ success: true, data: { messageId: logId } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('POST /api/friends/:id/messages error:', errMsg);
    return c.json({ success: false, error: errMsg }, 500);
  }
});

export { friends };
