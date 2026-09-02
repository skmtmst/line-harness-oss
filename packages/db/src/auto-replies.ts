import { jstNow } from './utils.js';
// =============================================================================
// Auto-Replies — Keyword-triggered automatic responses (L社 自動応答 equivalent)
// =============================================================================

export interface AutoReply {
  id: string;
  keyword: string;
  match_type: 'exact' | 'contains';
  response_type: string;
  response_content: string;
  template_id: string | null;
  line_account_id: string | null;
  is_active: number;
  /** 返す時間帯（JST の HH:MM）。NULL なら時間帯を問わない */
  active_from: string | null;
  active_until: string | null;
  /** 同じ相手へ自動応答を返してから、この分数は返さない。NULL なら抑制しない */
  cooldown_minutes: number | null;
  /** 担当者が対応中のトークでは返さない（1）か、返す（0）か */
  skip_when_operator_active: number;
  /** 評価順。小さいほど先に見る。同じ値なら created_at 順 */
  priority: number;
  /** 対象にするメッセージ種別のJSON配列。NULL なら全部 */
  message_kinds_json: string | null;
  /** 友だちの条件（saved_searches と同じ形）。NULL なら絞らない */
  friend_conditions_json: string | null;
  /** 所属フォルダ */
  folder_id: string | null;
  display_order: number;
  /** 151: 応答したときに順に実行することの並び（シナリオのアクションと同じ形）。 */
  actions_json: string | null;
  /** 151: 応答する曜日（0=日 … 6=土）。時間帯は active_from / active_until。 */
  response_weekdays_json: string | null;
  /** 151: 'ignore' | 'include' | 'exclude' */
  response_holiday_rule: string | null;
  /** 151: 1人につき1回だけ応答する。cooldown_minutes（N分空ける）とは別。 */
  once_per_friend: number;
  /** 151: キーワードを複数行持つ。NULL なら keyword / match_type を見る。 */
  keywords_json: string | null;
  /** 157: キーワードを問わず、届いたメッセージすべてに応答する。 */
  respond_to_all: number;
  /** 158: 管理用の名前。空なら keyword を代わりに出す。 */
  name: string | null;
  /** 158: キーワードが複数あるとき 'any'（どれか1つ）か 'all'（すべて）か。 */
  keyword_match_mode: string;
  created_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getAutoReplies(
  db: D1Database,
  lineAccountId?: string,
): Promise<AutoReply[]> {
  if (lineAccountId) {
    const result = await db
      .prepare(
        // 上から順に評価して最初に当てはまった1件だけが動く。画面の並び順と
        // 評価順を一致させるため、一覧もこの順で返す。
        `SELECT * FROM auto_replies WHERE (line_account_id IS NULL OR line_account_id = ?)
          ORDER BY priority ASC, created_at ASC`,
      )
      .bind(lineAccountId)
      .all<AutoReply>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM auto_replies ORDER BY priority ASC, created_at ASC`)
    .all<AutoReply>();
  return result.results;
}

export async function getAutoReplyById(
  db: D1Database,
  id: string,
): Promise<AutoReply | null> {
  return db
    .prepare(`SELECT * FROM auto_replies WHERE id = ?`)
    .bind(id)
    .first<AutoReply>();
}

/** 空の配列は保存しない。「設定あり・中身なし」と「未設定」を分けないため。 */
function jsonOrNull(value: unknown[] | null | undefined): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}

export interface CreateAutoReplyInput {
  keyword: string;
  matchType?: 'exact' | 'contains';
  responseType?: string;
  responseContent: string;
  templateId?: string | null;
  lineAccountId?: string | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
  cooldownMinutes?: number | null;
  skipWhenOperatorActive?: boolean;
  priority?: number;
  messageKinds?: string[] | null;
  /** 151: 応答したときに順に実行すること。 */
  actions?: unknown[] | null;
  /** 151: 応答する曜日（0=日 … 6=土）。 */
  responseWeekdays?: number[] | null;
  /** 151: 'ignore' | 'include' | 'exclude' */
  responseHolidayRule?: string | null;
  /** 151: 1人につき1回だけ応答する。 */
  oncePerFriend?: boolean;
  /** 151: キーワードの複数行。 */
  keywords?: unknown[] | null;
  /** 友だちの絞り込み（一斉配信・シナリオと同じ形）。 */
  friendConditions?: unknown | null;
  /** 157: キーワードを問わず応答する。 */
  respondToAll?: boolean;
  /** 158: 管理用の名前。 */
  name?: string | null;
  /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
  keywordMatchMode?: 'any' | 'all';
  /** フォルダ。分けていなければ null。 */
  folderId?: string | null;
}

export async function createAutoReply(
  db: D1Database,
  input: CreateAutoReplyInput,
): Promise<AutoReply> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO auto_replies
         (id, keyword, match_type, response_type, response_content,
          template_id, line_account_id, is_active,
          active_from, active_until, cooldown_minutes, skip_when_operator_active,
          priority, message_kinds_json,
          actions_json, response_weekdays_json, response_holiday_rule,
          once_per_friend, keywords_json, friend_conditions_json, respond_to_all, name, keyword_match_mode, folder_id,
          created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.keyword,
      input.matchType ?? 'exact',
      input.responseType ?? 'text',
      input.responseContent,
      input.templateId ?? null,
      input.lineAccountId ?? null,
      input.activeFrom ?? null,
      input.activeUntil ?? null,
      input.cooldownMinutes ?? null,
      input.skipWhenOperatorActive ? 1 : 0,
      input.priority ?? 0,
      input.messageKinds && input.messageKinds.length > 0
        ? JSON.stringify(input.messageKinds)
        : null,
      jsonOrNull(input.actions),
      jsonOrNull(input.responseWeekdays),
      input.responseHolidayRule ?? null,
      input.oncePerFriend ? 1 : 0,
      jsonOrNull(input.keywords),
      input.friendConditions ? JSON.stringify(input.friendConditions) : null,
      input.respondToAll ? 1 : 0,
      input.name ?? null,
      input.keywordMatchMode ?? 'any',
      input.folderId ?? null,
      now,
    )
    .run();

  return (await getAutoReplyById(db, id))!;
}

export interface UpdateAutoReplyInput {
  keyword?: string;
  matchType?: 'exact' | 'contains';
  responseType?: string;
  responseContent?: string;
  templateId?: string | null;
  lineAccountId?: string | null;
  isActive?: boolean;
  activeFrom?: string | null;
  activeUntil?: string | null;
  cooldownMinutes?: number | null;
  skipWhenOperatorActive?: boolean;
  priority?: number;
  messageKinds?: string[] | null;
  /** 151: 応答したときに順に実行すること。 */
  actions?: unknown[] | null;
  /** 151: 応答する曜日（0=日 … 6=土）。 */
  responseWeekdays?: number[] | null;
  /** 151: 'ignore' | 'include' | 'exclude' */
  responseHolidayRule?: string | null;
  /** 151: 1人につき1回だけ応答する。 */
  oncePerFriend?: boolean;
  /** 151: キーワードの複数行。 */
  keywords?: unknown[] | null;
  /** 友だちの絞り込み（一斉配信・シナリオと同じ形）。 */
  friendConditions?: unknown | null;
  /** 157: キーワードを問わず応答する。 */
  respondToAll?: boolean;
  /** 158: 管理用の名前。 */
  name?: string | null;
  /** 158: 'any'（どれか1つ）か 'all'（すべて）。 */
  keywordMatchMode?: 'any' | 'all';
  /** フォルダ。分けていなければ null。 */
  folderId?: string | null;
}

export async function updateAutoReply(
  db: D1Database,
  id: string,
  input: UpdateAutoReplyInput,
): Promise<AutoReply | null> {
  const existing = await getAutoReplyById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE auto_replies
       SET keyword = ?,
           match_type = ?,
           response_type = ?,
           response_content = ?,
           template_id = ?,
           line_account_id = ?,
           is_active = ?,
           active_from = ?,
           active_until = ?,
           cooldown_minutes = ?,
           skip_when_operator_active = ?,
           priority = ?,
           message_kinds_json = ?,
           actions_json = ?,
           response_weekdays_json = ?,
           response_holiday_rule = ?,
           once_per_friend = ?,
           keywords_json = ?,
           friend_conditions_json = ?,
           respond_to_all = ?,
           name = ?,
           keyword_match_mode = ?,
           folder_id = ?,
           created_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.keyword ?? existing.keyword,
      input.matchType ?? existing.match_type,
      input.responseType ?? existing.response_type,
      input.responseContent ?? existing.response_content,
      'templateId' in input ? (input.templateId ?? null) : existing.template_id,
      'lineAccountId' in input ? (input.lineAccountId ?? null) : existing.line_account_id,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      'activeFrom' in input ? (input.activeFrom ?? null) : existing.active_from,
      'activeUntil' in input ? (input.activeUntil ?? null) : existing.active_until,
      'cooldownMinutes' in input ? (input.cooldownMinutes ?? null) : existing.cooldown_minutes,
      'skipWhenOperatorActive' in input
        ? (input.skipWhenOperatorActive ? 1 : 0)
        : existing.skip_when_operator_active,
      'priority' in input ? (input.priority ?? 0) : existing.priority,
      'messageKinds' in input
        ? (input.messageKinds && input.messageKinds.length > 0
            ? JSON.stringify(input.messageKinds)
            : null)
        : existing.message_kinds_json,
      // 配列や条件は「空なら NULL」に寄せる。空配列を保存すると、読む側で
      // 「設定あり・中身なし」と「未設定」を区別する必要が出る。
      'actions' in input ? jsonOrNull(input.actions) : existing.actions_json,
      'responseWeekdays' in input
        ? jsonOrNull(input.responseWeekdays)
        : existing.response_weekdays_json,
      'responseHolidayRule' in input
        ? (input.responseHolidayRule ?? null)
        : existing.response_holiday_rule,
      'oncePerFriend' in input
        ? (input.oncePerFriend ? 1 : 0)
        : existing.once_per_friend,
      'keywords' in input ? jsonOrNull(input.keywords) : existing.keywords_json,
      'friendConditions' in input
        ? (input.friendConditions ? JSON.stringify(input.friendConditions) : null)
        : existing.friend_conditions_json,
      'respondToAll' in input ? (input.respondToAll ? 1 : 0) : existing.respond_to_all,
      'name' in input ? (input.name ?? null) : existing.name,
      'keywordMatchMode' in input
        ? (input.keywordMatchMode ?? 'any')
        : existing.keyword_match_mode,
      'folderId' in input ? (input.folderId ?? null) : existing.folder_id,
      existing.created_at,
      id,
    )
    .run();

  return getAutoReplyById(db, id);
}

export async function deleteAutoReply(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM auto_replies WHERE id = ?`).bind(id).run();
}

// =============================================================================
// 当たった記録（152）
// =============================================================================

export async function recordAutoReplyHit(
  db: D1Database,
  input: {
    autoReplyId: string;
    friendId?: string | null;
    lineAccountId?: string | null;
    matchedKeyword?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auto_reply_hits
         (id, auto_reply_id, friend_id, line_account_id, matched_keyword, hit_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.autoReplyId,
      input.friendId ?? null,
      input.lineAccountId ?? null,
      input.matchedKeyword ?? null,
      jstNow(),
    )
    .run();
}

/**
 * この人に、このルールで一度でも応答したことがあるか。
 * 「1人につき1回だけ応答する」の判定に使う。
 */
export async function hasAutoReplyHitForFriend(
  db: D1Database,
  autoReplyId: string,
  friendId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM auto_reply_hits
        WHERE auto_reply_id = ? AND friend_id = ? LIMIT 1`,
    )
    .bind(autoReplyId, friendId)
    .first<{ hit: number }>();
  return row != null;
}

export interface AutoReplyHitCount {
  autoReplyId: string;
  /** 期間内の回数。 */
  period: number;
  /** 記録が残っている全期間の回数。 */
  total: number;
}

/**
 * ルールごとの当たった回数。一覧に「35回（累計 35）」と出すため。
 *
 * from / to は日本時間の ISO 文字列。to は含まない。
 */
export async function getAutoReplyHitCounts(
  db: D1Database,
  lineAccountId: string | null,
  from: string,
  to: string,
): Promise<AutoReplyHitCount[]> {
  // グローバルのルール（line_account_id が NULL）も一緒に数える。
  // 一覧が両方を並べて出しているので、数だけ片方に寄せると食い違う。
  const rows = await db
    .prepare(
      `SELECT h.auto_reply_id AS auto_reply_id,
              SUM(CASE WHEN h.hit_at >= ? AND h.hit_at < ? THEN 1 ELSE 0 END) AS period,
              COUNT(*) AS total
         FROM auto_reply_hits h
         JOIN auto_replies r ON r.id = h.auto_reply_id
        WHERE r.line_account_id IS NULL OR r.line_account_id = ?
        GROUP BY h.auto_reply_id`,
    )
    .bind(from, to, lineAccountId)
    .all<{ auto_reply_id: string; period: number; total: number }>();
  return (rows.results ?? []).map((r) => ({
    autoReplyId: r.auto_reply_id,
    period: r.period,
    total: r.total,
  }));
}
