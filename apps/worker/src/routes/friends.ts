import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getFriends,
  getFriendById,
  getFriendWithFirstTrackedLinkName,
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
  getSavedSearches,
  createSavedSearch,
  countSavedSearches,
  recordSavedSearchUsage,
  validateSearchConditions,
  SAVED_SEARCH_LIMIT,
} from '@line-crm/db';
import type { Friend as DbFriend, Tag as DbTag, SavedSearch, SavedSearchAccess } from '@line-crm/db';
import type { SavedSearchConditions } from '@line-crm/shared';
import { fireEvent } from '../services/event-bus.js';
import { buildMessage } from '../services/step-delivery.js';
import type { Env } from '../index.js';
import { resolveLineToken } from '../services/line-token.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { resolveRequestBoundaries } from '../services/request-boundary.js';
import {
  classifyLineOutboundFailure,
  completeOutboundSendStatement,
  failOutboundSend,
  hashOutboundPayload,
  isValidIdempotencyKey,
  reserveOutboundSend,
} from '../services/outbound-idempotency.js';
import { compileSavedSearch } from '../services/saved-search-filter.js';
import { getSavedSearchMatchPreview } from '../services/saved-search-insights.js';
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

/**
 * 利用者入力を LIKE パターンに埋める前の逃がし (#496-18)。
 *
 * `%` / `_` をそのまま渡すとワイルドカードとして効いて過剰一致する
 * （注入ではなく人数・ページ送りのぶれ）。`\` も逃がしたうえで、
 * 使う側はすべて `ESCAPE '\'` を付ける。
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export const requireVisibleFriend: MiddlewareHandler<Env> = async (c, next) => {
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

async function friendSavedViewAccess(c: Context<Env>): Promise<SavedSearchAccess | Response> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
  }
  const staff = c.get('staff');
  return {
    lineAccountId,
    staffId: staff.id,
    canManageAll: staff.role === 'owner' || staff.role === 'admin',
  };
}

async function serializeFriendSavedView(db: D1Database, row: SavedSearch) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.conditions_json);
  } catch {
    parsed = null;
  }
  const validated = validateSearchConditions(parsed);
  const match = validated.ok && row.line_account_id
    ? await getSavedSearchMatchPreview(db, validated.value, row.line_account_id)
    : {
        total: null,
        byChannel: { line: null, mail: null },
        calculatedAt: jstNow(),
        error: validated.ok ? 'LINE公式アカウントを確認できません' : validated.error,
      };
  return {
    id: row.id,
    name: row.name,
    conditions: parsed,
    revision: Number(row.revision ?? 1),
    isShared: Boolean(row.is_shared),
    ownerId: row.created_by,
    lineAccountId: row.line_account_id,
    displayOrder: row.display_order,
    match,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

// V6 機能3の正規URL。旧 /api/saved-searches は互換口として残す。
friends.get('/api/friends/saved-views', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const access = await friendSavedViewAccess(c);
    if (access instanceof Response) return access;
    const id = c.req.query('id')?.trim();
    if (id) {
      const row = await getSavedSearchById(c.env.DB, id, access.lineAccountId);
      if (!row || row.scope !== 'friends' || (row.condition_format ?? 'search_v1') !== 'search_v1'
          || (!access.canManageAll && !row.is_shared && row.created_by !== access.staffId)) {
        return c.json({ success: false, error: '保存した検索が見つかりません' }, 404);
      }
      return c.json({ success: true, data: await serializeFriendSavedView(c.env.DB, row) });
    }
    const rows = await getSavedSearches(c.env.DB, 'friends', access, 'search_v1');
    const items = await Promise.all(rows.map((row) => serializeFriendSavedView(c.env.DB, row)));
    return c.json({ success: true, data: { items, total: items.length } });
  } catch (error) {
    console.error('GET /api/friends/saved-views error:', error);
    return c.json({ success: false, error: '保存した検索を読み込めませんでした' }, 500);
  }
});

friends.post('/api/friends/saved-views', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const access = await friendSavedViewAccess(c);
    if (access instanceof Response) return access;
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 40) {
      return c.json({ success: false, error: '名前は1文字以上40文字以内で入力してください' }, 422);
    }
    if (body.isShared === true && !access.canManageAll) {
      return c.json({ success: false, error: '共有の検索を作る権限がありません' }, 403);
    }
    const validated = validateSearchConditions(body.conditions);
    if (!validated.ok) return c.json({ success: false, error: validated.error }, 422);
    const compiled = compileSavedSearch(validated.value);
    if (!compiled.ok) return c.json({ success: false, error: compiled.error }, 422);
    const duplicate = await c.env.DB.prepare(
      `SELECT id FROM saved_searches
        WHERE scope = 'friends' AND condition_format = 'search_v1'
          AND line_account_id = ? AND created_by = ?
          AND lower(trim(name)) = lower(trim(?))
        LIMIT 1`,
    ).bind(access.lineAccountId, access.staffId, name).first<{ id: string }>();
    if (duplicate) {
      return c.json({ success: false, error: '同じ名前の保存した検索があります' }, 409);
    }
    const count = await countSavedSearches(c.env.DB, {
      scope: 'friends',
      conditionFormat: 'search_v1',
      createdBy: access.staffId,
      lineAccountId: access.lineAccountId,
    });
    if (count >= SAVED_SEARCH_LIMIT) {
      return c.json({ success: false, error: `保存できる検索は${SAVED_SEARCH_LIMIT}件までです` }, 422);
    }
    const saved = await createSavedSearch(c.env.DB, {
      name,
      scope: 'friends',
      conditionFormat: 'search_v1',
      conditions: validated.value,
      createdBy: access.staffId,
      lineAccountId: access.lineAccountId,
      isShared: body.isShared === true,
    });
    return c.json({ success: true, data: await serializeFriendSavedView(c.env.DB, saved) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) {
      return c.json({ success: false, error: '同じ名前の保存した検索があります' }, 409);
    }
    if (error instanceof SyntaxError) {
      return c.json({ success: false, error: '送信内容のJSONが正しくありません' }, 400);
    }
    console.error('POST /api/friends/saved-views error:', error);
    return c.json({ success: false, error: '保存した検索を作成できませんでした' }, 500);
  }
});

// GET /api/friends - list with pagination
friends.get('/api/friends', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const rawConditions = c.req.query('conditions');
    let directConditions: SavedSearchConditions | undefined;
    if (rawConditions) {
      if (rawConditions.length > 16_000) {
        return c.json({ success: false, error: '検索条件が大きすぎます' }, 422);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawConditions);
      } catch {
        return c.json({ success: false, error: '検索条件のJSONが正しくありません' }, 422);
      }
      const validated = validateSearchConditions(parsed);
      if (!validated.ok) return c.json({ success: false, error: validated.error }, 422);
      directConditions = validated.value;
    }
    const limit = listLimit(c.req.query('limit'), directConditions?.list?.limit ?? 50);
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
    const requestedSort = c.req.query('sort') ?? directConditions?.list?.sort;
    const sort: 'recent' | 'oldest' = requestedSort === 'oldest' ? 'oldest' : 'recent';
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
    if (savedSearchId && directConditions) {
      return c.json({ success: false, error: '保存した検索と直接指定した条件は同時に使えません' }, 400);
    }

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
    let appliedSavedSearchRevision: number | null = null;
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
      appliedSavedSearchRevision = Number(row.revision ?? 1);
    }
    if (directConditions) {
      const compiled = compileSavedSearch(directConditions);
      if (!compiled.ok) return c.json({ success: false, error: compiled.error }, 422);
      conditions.push(compiled.value.sql);
      binds.push(...compiled.value.binds);
    }
    if (search) {
      conditions.push(`f.display_name LIKE ? ESCAPE '\\'`);
      binds.push(`%${escapeLikePattern(search)}%`);
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
      conditions.push(`f.status_message LIKE ? ESCAPE '\\'`);
      binds.push(`%${escapeLikePattern(statusMessage)}%`);
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
      const escapedSearch = escapeLikePattern(search);
      const exactPattern = escapedSearch;
      const prefixPattern = `${escapedSearch}%`;
      const wordStartAscii = `% ${escapedSearch}%`;
      const wordStartFullWidth = `%　${escapedSearch}%`;
      listStmt = db.prepare(
        `SELECT ${baseSelect},
                CASE
                  WHEN f.display_name LIKE ? ESCAPE '\\' THEN 0
                  WHEN f.display_name LIKE ? ESCAPE '\\' THEN 1
                  WHEN f.display_name LIKE ? ESCAPE '\\' OR f.display_name LIKE ? ESCAPE '\\' THEN 2
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

    if (savedSearchId && lineAccountId && appliedSavedSearchRevision !== null) {
      try {
        await recordSavedSearchUsage(db, {
          savedSearchId,
          lineAccountId,
          revision: appliedSavedSearchRevision,
          referenceKind: 'friends',
          usedBy: staff.id,
        });
      } catch (error) {
        // 集計台帳の一時失敗で、友だち一覧そのものを表示不能にしない。
        console.error('saved search usage record error:', error);
      }
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
    if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
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
    if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
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
    if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
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

/*
 * GET /api/friends/:id/upcoming — 受信箱の顧客情報に出す「次の予定」(IDEA-02)。
 *
 * 返すのは確定している未来の予定だけ:
 *   - nextBooking … 予約（bookings / event_bookings / meet_consultations の
 *     うち status が requested/confirmed で開始が未来のものの最先着）
 *   - nextAutoDelivery … 確定した自動配信（friend_scenarios の
 *     next_delivery_at と、queued 済みの reminder_delivery_runs の最先着）
 *
 * 条件付きでしか出ない将来配信（絞り込み配信の動的対象など）はここに
 * 含めない。「未確定を確定予定と表示しない」ため。
 *
 * それぞれの取得は独立させ、片方の失敗でもう片方まで隠さない。
 * 失敗は null ではなく *_Error=true で返し、画面が「未取得」と
 * 「予定なし」を区別できるようにする。
 */
friends.get('/api/friends/:id/upcoming', requireVisibleFriend, async (c) => {
  try {
    const friendId = c.req.param('id');
    const db = c.env.DB;
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const accountId =
      ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
    const nowIso = new Date().toISOString();

    type BookingCandidate = {
      kind: 'booking' | 'event_booking' | 'meet_consultation';
      id: string;
      title: string;
      startsAt: string;
      status: string;
    };

    const fetchNextBooking = async (): Promise<BookingCandidate | null> => {
      const candidates: BookingCandidate[] = [];
      if (accountId) {
        // 予約（店舗メニュー）。LINE未連携の予約客レコード経由も拾う。
        const booking = await db
          .prepare(
            `SELECT b.id, b.starts_at, b.status, m.name AS title
               FROM bookings b
               JOIN menus m ON m.id = b.menu_id
               LEFT JOIN booking_customers bc ON bc.id = b.booking_customer_id
              WHERE b.line_account_id = ?
                AND b.status IN ('requested', 'confirmed')
                AND b.starts_at > ?
                AND (b.friend_id = ? OR bc.friend_id = ?)
              ORDER BY b.starts_at ASC
              LIMIT 1`,
          )
          .bind(accountId, nowIso, friendId, friendId)
          .first<{ id: string; starts_at: string; status: string; title: string | null }>();
        if (booking) {
          candidates.push({
            kind: 'booking',
            id: booking.id,
            title: booking.title ?? '予約',
            startsAt: booking.starts_at,
            status: booking.status,
          });
        }
        // イベント予約。開催時刻は予約枠（event_slots）側にある。
        const eventBooking = await db
          .prepare(
            `SELECT eb.id, eb.status, es.starts_at, e.name AS title, e.id AS event_id
               FROM event_bookings eb
               JOIN event_slots es ON es.id = eb.slot_id
               JOIN events e ON e.id = eb.event_id
              WHERE eb.friend_id = ?
                AND eb.line_account_id = ?
                AND eb.status IN ('requested', 'confirmed')
                AND es.starts_at > ?
              ORDER BY es.starts_at ASC
              LIMIT 1`,
          )
          .bind(friendId, accountId, nowIso)
          .first<{ id: string; status: string; starts_at: string; title: string | null; event_id: string }>();
        if (eventBooking) {
          candidates.push({
            kind: 'event_booking',
            id: eventBooking.event_id,
            title: eventBooking.title ?? 'イベント',
            startsAt: eventBooking.starts_at,
            status: eventBooking.status,
          });
        }
      }
      // Google Meet 個別相談。アカウント列を持たないため友だちIDで引く。
      const meet = await db
        .prepare(
          `SELECT id, title, starts_at, status
             FROM meet_consultations
            WHERE friend_id = ?
              AND status = 'confirmed'
              AND starts_at > ?
            ORDER BY starts_at ASC
            LIMIT 1`,
        )
        .bind(friendId, nowIso)
        .first<{ id: string; title: string | null; starts_at: string; status: string }>();
      if (meet) {
        candidates.push({
          kind: 'meet_consultation',
          id: meet.id,
          title: meet.title ?? '個別相談',
          startsAt: meet.starts_at,
          status: meet.status,
        });
      }
      candidates.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
      return candidates[0] ?? null;
    };

    type AutoDeliveryCandidate = {
      kind: 'scenario' | 'reminder';
      id: string;
      name: string;
      scheduledAt: string;
    };

    const fetchNextAutoDelivery = async (): Promise<AutoDeliveryCandidate | null> => {
      const candidates: AutoDeliveryCandidate[] = [];
      // シナリオの確定済み次通。paused は止まっているので「確定」に入れない。
      const scenario = await db
        .prepare(
          `SELECT fs.scenario_id AS id, s.name, fs.next_delivery_at AS scheduled_at
             FROM friend_scenarios fs
             JOIN scenarios s ON s.id = fs.scenario_id
            WHERE fs.friend_id = ?
              AND fs.status IN ('active', 'delivering')
              AND fs.next_delivery_at IS NOT NULL
            ORDER BY fs.next_delivery_at ASC
            LIMIT 1`,
        )
        .bind(friendId)
        .first<{ id: string; name: string | null; scheduled_at: string }>();
      if (scenario) {
        candidates.push({
          kind: 'scenario',
          id: scenario.id,
          name: scenario.name ?? 'シナリオ',
          scheduledAt: scenario.scheduled_at,
        });
      }
      // リマインダの確定済み配信（queued=予定、claimed=送信中、retry_wait=再試行待ち）。
      const reminder = await db
        .prepare(
          `SELECT rr.reminder_id AS id, r.name, rr.scheduled_at
             FROM reminder_delivery_runs rr
             JOIN reminders r ON r.id = rr.reminder_id
            WHERE rr.friend_id = ?
              AND rr.status IN ('queued', 'claimed', 'retry_wait')
            ORDER BY rr.scheduled_at ASC
            LIMIT 1`,
        )
        .bind(friendId)
        .first<{ id: string; name: string | null; scheduled_at: string }>();
      if (reminder) {
        candidates.push({
          kind: 'reminder',
          id: reminder.id,
          name: reminder.name ?? 'リマインダ',
          scheduledAt: reminder.scheduled_at,
        });
      }
      candidates.sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0));
      return candidates[0] ?? null;
    };

    const [bookingResult, autoDeliveryResult] = await Promise.allSettled([
      fetchNextBooking(),
      fetchNextAutoDelivery(),
    ]);

    return c.json({
      success: true,
      data: {
        nextBooking: bookingResult.status === 'fulfilled' ? bookingResult.value : null,
        nextBookingError: bookingResult.status === 'rejected',
        nextAutoDelivery: autoDeliveryResult.status === 'fulfilled' ? autoDeliveryResult.value : null,
        nextAutoDeliveryError: autoDeliveryResult.status === 'rejected',
      },
    });
  } catch (err) {
    console.error('GET /api/friends/:id/upcoming error:', err);
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
    if (accountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
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

    const [friend, tags, formSubmissions, formSubmissionTotal, support] = await Promise.all([
      // 一覧と同じ first_tracked_link_id → tracked_links.name 基準で
      // 流入元名を添える（N-036）。無い・消えた流入元は null で、
      // 画面側は従来どおり「不明」を出す。
      getFriendWithFirstTrackedLinkName(db, id),
      getFriendTags(db, id),
      /*
       * 回答は最新10件まで。「あと何件あるか」が分かるよう、総数を
       * 別に数えて返す（INBOX-17）。画面側は「全N件中10件を表示」と
       * 続きへの導線を出せる。
       */
      getFormSubmissionsByFriend(db, id, 10),
      db
        .prepare('SELECT COUNT(*) AS total FROM form_submissions WHERE friend_id = ?')
        .bind(id)
        .first<{ total: number }>()
        .then((row) => row?.total ?? 0)
        .catch(() => null),
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
        firstTrackedLinkName: friend.first_tracked_link_name ?? null,
        tags: tags.map(serializeTag),
        support: support
          ? {
              status: support.status,
              operatorName: support.operator_name,
              notes: support.notes,
            }
          : null,
        formSubmissionTotal,
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
    const tag = await db.prepare(
      'SELECT id, line_account_id, manual_assignment_allowed FROM tags WHERE id = ?',
    ).bind(body.tagId).first<Pick<DbTag, 'id' | 'line_account_id' | 'manual_assignment_allowed'>>();
    if (!tag) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const friendAccountId = ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
    const tagAccountId = tag.line_account_id ?? null;
    // N-041/N-044(#803): friends行とtags行の所属をDBから解決し、共通境界へ渡す。
    const boundary = await resolveRequestBoundaries(db, c.get('staff'), [friendAccountId, tagAccountId]);
    if (!boundary.allowed) {
      if (boundary.reason === 'unauthenticated') {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }
      if (boundary.reason === 'forbidden') {
        return c.json({ success: false, error: 'Forbidden' }, 403);
      }
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }
    // 別所属の組合せは存在を漏らさず拒否する。所属なしタグ(共通)は従来どおり付けられる。
    if (tagAccountId !== null && tagAccountId !== friendAccountId) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }
    // 手動付与禁止のタグは付けられない。
    if (Number(tag.manual_assignment_allowed ?? 1) !== 1) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }

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

    // N-040(#808): 改訂値付きの更新は1回の条件付きUPDATEで突合する。
    // 指定なしは従来どおり無条件更新（既存互換）。
    const expectedUpdatedAt = c.req.query('expectedUpdatedAt')?.trim() || null;
    if (expectedUpdatedAt) {
      const applied = await db
        .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
        .bind(JSON.stringify(merged), now, friendId, expectedUpdatedAt)
        .run();
      if ((applied.meta?.changes ?? 0) === 0) {
        const current = await getFriendById(db, friendId);
        if (!current) {
          return c.json({ success: false, error: 'Friend not found' }, 404);
        }
        return c.json({
          success: false,
          code: 'METADATA_CONFLICT',
          error: 'ほかの変更が先に保存されました。最新の状態を読み直して、もう一度お試しください',
          currentUpdatedAt: (current as unknown as Record<string, unknown>).updated_at ?? null,
        }, 409);
      }
    } else {
      await db
        .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(merged), now, friendId)
        .run();
    }

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

friends.get(
  '/api/friends/:id/timeline',
  requireRole('owner', 'admin', 'staff'),
  requireVisibleFriend,
  async (c) => {
    try {
      const limitRaw = Number(c.req.query('limit') ?? 50);
      const offsetRaw = Number(c.req.query('cursor') ?? 0);
      if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100
          || !Number.isInteger(offsetRaw) || offsetRaw < 0) {
        return c.json({ success: false, error: 'ページ位置が正しくありません' }, 400);
      }
      const friendId = c.req.param('id');
      /*
        N-717: compound SELECTはD1の SQLITE_MAX_COMPOUND_SELECT(既定5)を超えて
        "too many terms in compound SELECT" になる（better-sqlite3の既定上限は
        500なので手元試験は通ってしまい、D1でだけ落ちる）。
        4項ずつのCTEへ割り、外側でUNION ALLへまとめて5項以下に収める形を保つ。
        IDEA-03 で注文・写真投稿を足したので、専用ソース10項を
        group_a(4) + group_b(4) + group_c(2) の3CTEへ分け、外側は3項。

        重複の扱い（IDEA-03「重複なし」）:
        analytics_events は事実の分析用の写しで、同じ出来事が専用台帳にも
        1行ある（受信メッセージ→messages_log、フォーム回答→form_submissions、
        予約の確定/取消→各予約台帳、注文→ec_orders、postback→messages_log）。
        そのevent_typeはanalytics側から外し、1つの出来事が2行出ないようにする。
        タグ変更・シナリオ開始など専用台帳を持たないイベントはそのまま出す。

        status: 出せるソースだけ状態を返す。状態を持たない行は NULL。
        source: 元の台帳を指す {kind,id} に、遷移先で必要な親ID(form_id等)と
        外部URL(注文詳細・投稿画像)だけを添える。行き先が無い種類は NULL のまま。
      */
      const result = await c.env.DB.prepare(
        `WITH group_a AS (
             SELECT ml.id,
                    CASE WHEN ml.direction = 'incoming' THEN 'message_received' ELSE 'message_sent' END AS event_type,
                    CASE WHEN ml.direction = 'incoming' THEN 'メッセージを受信しました' ELSE 'メッセージを送信しました' END AS summary,
                    NULL AS status,
                    'message' AS source_kind, ml.id AS source_id,
                    NULL AS source_parent_id, NULL AS source_url,
                    ml.created_at AS occurred_at,
                    COALESCE(ml.line_account_id, f.line_account_id) AS line_account_id
               FROM messages_log ml JOIN friends f ON f.id = ml.friend_id
              WHERE ml.friend_id = ? AND (ml.delivery_type IS NULL OR ml.delivery_type != 'test')
             UNION ALL
             SELECT fs.id, 'form_submitted', '回答フォームへ回答しました', NULL,
                    'form_submission', fs.id, fs.form_id, NULL, fs.created_at, f.line_account_id
               FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
              WHERE fs.friend_id = ?
             UNION ALL
             SELECT b.id, 'booking', 'カレンダー予約が更新されました', b.status,
                    'booking', b.id, NULL, NULL, COALESCE(b.updated_at, b.created_at), b.line_account_id
               FROM bookings b WHERE b.friend_id = ?
             UNION ALL
             SELECT cb.id, 'calendar_booking', '外部カレンダー予約が更新されました', cb.status,
                    'calendar_booking', cb.id, NULL, NULL, COALESCE(cb.updated_at, cb.created_at), f.line_account_id
               FROM calendar_bookings cb JOIN friends f ON f.id = cb.friend_id
              WHERE cb.friend_id = ?
           ),
           group_b AS (
             SELECT eb.id, 'event_booking', 'イベント予約が更新されました', eb.status,
                    'event_booking', eb.id, eb.event_id, NULL, COALESCE(eb.updated_at, eb.requested_at), eb.line_account_id
               FROM event_bookings eb WHERE eb.friend_id = ?
             UNION ALL
             SELECT fr.id, 'reminder', 'リマインダが更新されました', fr.status,
                    'friend_reminder', fr.id, fr.reminder_id, NULL, COALESCE(fr.updated_at, fr.created_at), f.line_account_id
               FROM friend_reminders fr JOIN friends f ON f.id = fr.friend_id
              WHERE fr.friend_id = ?
             UNION ALL
             SELECT ie.id, ie.event_type, ie.summary, NULL,
                    'identity_event', ie.id, NULL, NULL, ie.occurred_at, f.line_account_id
               FROM identity_events ie JOIN friends f ON f.user_id = ie.user_id
              WHERE f.id = ? AND ie.tenant_id = COALESCE(
                (SELECT la2.tenant_id FROM line_accounts la2 WHERE la2.id = f.line_account_id),
                '00000000-0000-4000-8000-000000000001'
              )
             UNION ALL
             SELECT ae.id, ae.event_type, '共通イベントを記録しました', NULL,
                    ae.source_kind, ae.source_id, NULL, NULL, ae.occurred_at, ae.line_account_id
               FROM analytics_events ae
              WHERE ae.friend_id = ?
                AND ae.event_type NOT IN (
                  'message_received', 'message_sent', 'postback_received',
                  'form_submitted', 'booking_confirmed', 'booking_cancelled',
                  'ec.order.confirmed', 'ec.order.payment_received',
                  'ec.order.bank_transfer_reminder', 'ec.order.shipped',
                  'ec.order.cancelled', 'ec.order.refunded'
                )
           ),
           group_c AS (
             SELECT o.id, 'ec_order', '注文 ' || o.order_number || ' を記録しました',
                    o.normalized_status,
                    'ec_order', o.id, NULL, o.detail_url, o.ordered_at, o.line_account_id
               FROM ec_orders o WHERE o.friend_id = ?
             UNION ALL
             SELECT p.id, 'photo_submitted', '写真を投稿しました', p.status,
                    'nen_photo_submission', p.id, NULL, p.image_url, p.created_at, f.line_account_id
               FROM nen_photo_submissions p JOIN friends f ON f.id = p.friend_id
              WHERE p.friend_id = ?
           )
         SELECT timeline.id, timeline.event_type, timeline.summary, timeline.status,
                timeline.source_kind, timeline.source_id,
                timeline.source_parent_id, timeline.source_url,
                timeline.occurred_at,
                timeline.line_account_id, la.name AS line_account_name
           FROM (
             SELECT * FROM group_a
             UNION ALL
             SELECT * FROM group_b
             UNION ALL
             SELECT * FROM group_c
           ) timeline
           LEFT JOIN line_accounts la ON la.id = timeline.line_account_id
          ORDER BY timeline.occurred_at DESC, timeline.id DESC
          LIMIT ? OFFSET ?`,
      ).bind(
        friendId, friendId, friendId, friendId, friendId, friendId, friendId, friendId,
        friendId, friendId,
        limitRaw + 1, offsetRaw,
      ).all<{
        id: string;
        event_type: string;
        summary: string;
        status: string | null;
        source_kind: string;
        source_id: string;
        source_parent_id: string | null;
        source_url: string | null;
        occurred_at: string;
        line_account_id: string | null;
        line_account_name: string | null;
      }>();
      const hasNextPage = result.results.length > limitRaw;
      const items = result.results.slice(0, limitRaw).map((row) => ({
        id: row.id,
        type: row.event_type,
        summary: row.summary,
        status: row.status,
        source: {
          kind: row.source_kind,
          id: row.source_id,
          parentId: row.source_parent_id,
          url: row.source_url,
        },
        occurredAt: row.occurred_at,
        lineAccount: row.line_account_id
          ? { id: row.line_account_id, name: row.line_account_name ?? null }
          : null,
      }));
      return c.json({
        success: true,
        data: {
          items,
          limit: limitRaw,
          nextCursor: hasNextPage ? String(offsetRaw + limitRaw) : null,
        },
      });
    } catch (error) {
      console.error('GET /api/friends/:id/timeline error:', error);
      return c.json({ success: false, error: '友だちの履歴を読み込めませんでした' }, 500);
    }
  },
);

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
    // アカウントは予約の範囲キーにも使うので先に解く（N-028/N-029）。
    const friendAccountId =
      ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;

    // この経路は従来 {{var.*}} を展開せず生のまま送っていた。消えた共通情報は
    // 空文字にせず止め、解決できるものは送信時点の値へ置き換える。
    // 予約・追跡より先に行うので、拒否時はDBへ何も書かない。
    const { expandSendCommonVars, CommonVarResolutionFailedError } = await import('../services/interpolation-context.js');
    let resolvedContent = body.content;
    try {
      resolvedContent = await expandSendCommonVars(
        db, body.content,
        { kind: 'friend_direct', id: friend.id },
        { lineAccountId: friendAccountId },
      );
    } catch (error) {
      if (error instanceof CommonVarResolutionFailedError) {
        return c.json({
          success: false,
          error: `共通情報を解決できません: ${error.failures.map((f) => `{{var.${f.varKey}}}`).join(', ')}`,
          code: 'UNRESOLVED_TEMPLATE_VARIABLES',
          data: { variables: error.failures.map((f) => `var.${f.varKey}`) },
        }, 422);
      }
      throw error;
    }

    const payloadHash = await hashOutboundPayload(
      JSON.stringify({
        friendId: friend.id,
        messageType,
        content: resolvedContent,
        altText: body.altText,
        trackLinks: body.trackLinks !== false,
      }),
    );
    const reservation = await reserveOutboundSend(db, {
      key: idempotencyKey,
      channel: 'line',
      resourceId: friend.id,
      payloadHash,
      lineAccountId: friendAccountId,
      // in_progress はLINE受理後の応答喪失を含み得るため、自動再送しない。
      retryInProgress: false,
      now: new Date().toISOString(),
    });
    if (reservation.kind === 'conflict') {
      return c.json({ success: false, error: '同じ送信キーを別の内容には使用できません' }, 409);
    }
    if (reservation.kind === 'in_progress') {
      return c.json({
        success: false,
        error: '同じメッセージを送信中か、送信結果を確認中です',
        code: 'OUTBOUND_SEND_IN_PROGRESS',
      }, 409);
    }
    if (reservation.kind === 'failed') {
      return c.json({
        success: false,
        error: reservation.retryable ? '再送できる時刻までお待ちください' : 'この送信は自動再送できません',
        code: reservation.code,
        data: { retryable: reservation.retryable, nextRetryAt: reservation.nextRetryAt },
      }, 409);
    }
    if (reservation.kind === 'unknown') {
      return c.json({
        success: false,
        error: 'LINEへの送達結果を確認できないため、自動再送を停止しました',
        code: reservation.code,
        data: { retryable: false, nextRetryAt: null },
      }, 409);
    }
    if (reservation.kind === 'replay') {
      return c.json({ success: true, data: { messageId: reservation.responseId, replayed: true } });
    }

    // LINE 側にも同じキーを渡す。DB保存前に通信が切れて再実行されても、
    // LINE API が同一リクエストを二重配信しない。
    const outboundLeaseToken = reservation.leaseToken;
    const { LineClient } = await import('@line-crm/line-sdk');
    let lineClient: InstanceType<typeof LineClient>;
    let tracked: { messageType: string; content: string };
    try {
      // Resolve access token from friend's account (multi-account support)
      let accountToken: string | null = null;
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
      lineClient = new LineClient(accessToken);

      // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
      // trackLinks=false で明示的に短縮 OFF (URL をそのまま送る)
      const sendWorkerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
      tracked = { messageType, content: resolvedContent };
      if (body.trackLinks !== false) {
        const { autoTrackContent } = await import('../services/auto-track.js');
        tracked = await autoTrackContent(
          db, messageType, resolvedContent,
          sendWorkerUrl,
          { lineAccountId: friendAccountId },
        );
      }
      // 1:1 送信なので /t リンクに f=<friendId> を焼き込み、LIFF 識別ホップなしで
      // クリック帰属できるようにする（既存 /t リンクにも効くので trackLinks に関わらず実施）
      const { appendFriendToTrackedLinks } = await import('../services/auto-track.js');
      tracked = {
        ...tracked,
        content: await appendFriendToTrackedLinks(db, tracked.content, sendWorkerUrl, friend.id),
      };
    } catch (prepareError) {
      // LINEへ届く前の失敗なので、再送しても二重送信にならない失敗として残す。
      const failedAt = new Date().toISOString();
      await failOutboundSend(db, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: 'failed',
        code: 'OUTBOUND_PREPARATION_FAILED',
        retryable: true,
        nextRetryAt: null,
        now: failedAt,
      });
      console.error('POST /api/friends/:id/messages prepare failed:', prepareError);
      return c.json({
        success: false,
        error: '送信の準備に失敗しました',
        code: 'OUTBOUND_PREPARATION_FAILED',
        data: { retryable: true, nextRetryAt: null },
      }, 500);
    }

    const message = buildMessage(tracked.messageType, tracked.content, body.altText);
    try {
      await lineClient.pushMessage(friend.line_user_id, [message], idempotencyKey);
    } catch (sendError) {
      const failedAt = new Date().toISOString();
      const failure = classifyLineOutboundFailure(sendError, failedAt);
      await failOutboundSend(db, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: failure.status,
        code: failure.code,
        retryable: failure.retryable,
        nextRetryAt: failure.nextRetryAt,
        now: failedAt,
      });
      return c.json({
        success: false,
        error: failure.status === 'unknown'
          ? 'LINEへの送達結果を確認できないため、自動再送を停止しました'
          : 'LINEへ送信できませんでした',
        code: failure.code,
        data: { retryable: failure.retryable, nextRetryAt: failure.nextRetryAt },
      }, failure.httpStatus);
    }

    // Log outgoing message
    const logId = idempotencyKey;
    const sentAt = jstNow();
    try {
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
          leaseToken: outboundLeaseToken,
        }),
      ]);
    } catch {
      // pushは受理済みだが記録を確定できなかった。自動再送は二重送信になり得るので止める。
      const failedAt = new Date().toISOString();
      await failOutboundSend(db, {
        key: idempotencyKey,
        leaseToken: outboundLeaseToken,
        status: 'unknown',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        retryable: false,
        nextRetryAt: null,
        now: failedAt,
      });
      return c.json({
        success: false,
        error: 'LINEには受理された可能性がありますが、送信履歴を確定できませんでした',
        code: 'OUTBOUND_CONFIRMATION_FAILED',
        data: { retryable: false, nextRetryAt: null },
      }, 503);
    }

    return c.json({ success: true, data: { messageId: logId } });
  } catch (err) {
    console.error('POST /api/friends/:id/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friends };
