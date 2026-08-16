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
          priority, message_kinds_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
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
      existing.created_at,
      id,
    )
    .run();

  return getAutoReplyById(db, id);
}

export async function deleteAutoReply(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM auto_replies WHERE id = ?`).bind(id).run();
}
