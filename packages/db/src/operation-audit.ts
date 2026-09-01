/**
 * 操作の記録。
 *
 * 対応マークも保存した検索も、いまの値しか持っていない。設計は
 * 「過去7日で対応済にした人数」「今月の呼び出し回数」のように期間で切って見せる。
 *
 * 個別に履歴表を足すより、汎用の記録を1つ持つほうがよい（110）。
 * `login_audit`（103）と同じ形。
 */

/** 何に対する操作か。 */
export type AuditTargetKind = 'support_mark' | 'saved_search' | 'tag' | 'friend_field';

/** 何をしたか。 */
export type AuditAction = 'changed' | 'used' | 'created' | 'deleted' | 'archived';

export interface RecordOperationInput {
  targetKind: AuditTargetKind;
  targetId?: string | null;
  action: AuditAction;
  /** 誰が。自動なら null。 */
  actorId?: string | null;
  /** 対象の友だち。友だちに紐づかない操作なら null。 */
  friendId?: string | null;
  /** 変更前後の値など。 */
  detail?: Record<string, unknown> | null;
}

/**
 * 1件記録する。
 *
 * 失敗しても呼び出し側の処理は続ける。記録が1件飛ぶことと、
 * 対応マークの変更そのものが失敗することでは、後者の方がはるかに重い。
 */
export async function recordOperation(
  db: D1Database,
  input: RecordOperationInput,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO operation_audit
           (id, target_kind, target_id, action, actor_id, friend_id, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.targetKind,
        input.targetId ?? null,
        input.action,
        input.actorId ?? null,
        input.friendId ?? null,
        input.detail ? JSON.stringify(input.detail) : null,
      )
      .run();
  } catch (err) {
    console.error('recordOperation error:', err);
  }
}

/**
 * 期間内の操作の件数。
 *
 * `since` は JST の日付（YYYY-MM-DD）。設計の「過去7日」「今月」を出すのに使う。
 */
export async function countOperations(
  db: D1Database,
  targetKind: AuditTargetKind,
  action: AuditAction,
  since: string,
): Promise<number> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM operation_audit
          WHERE target_kind = ? AND action = ? AND substr(created_at, 1, 10) >= ?`,
      )
      .bind(targetKind, action, since)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    // 110 がまだ当たっていない環境。0 を返す。
    return 0;
  }
}
