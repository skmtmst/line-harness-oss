import type { FormSubmission, FormDestinationWriteStatus } from '../form-submission-types.js';
import { type FormSubmissionPeriod, submissionPeriodSql } from '../form-submission-period.js';
import { sqlIdSet } from '../id-queries.js';
import { boundedListLimit, jstNow, MAX_LIST_LIMIT } from '../utils.js';
import { type FormSubmissionPage, type FriendFormSubmission, type CreateFormSubmissionInput, type FormDestinationWriteResult } from './types.js';

export async function getFormSubmissions(
  db: D1Database,
  formId: string,
  limit?: number,
  options: FormSubmissionPeriod & {lineAccountId?: string} = {},
): Promise<FormSubmission[]> {
  const period = submissionPeriodSql('fs.created_at', options);
  const result = await db
    .prepare(
      `SELECT fs.*, f.display_name as friend_name FROM form_submissions fs
       LEFT JOIN friends f ON f.id = fs.friend_id
       WHERE fs.form_id = ? AND fs.is_test = 0${options.lineAccountId ? ' AND f.line_account_id=?' : ''}${period.sql} ORDER BY fs.created_at DESC LIMIT ?`,
    )
    .bind(formId, ...(options.lineAccountId ? [options.lineAccountId] : []), ...period.bindings, boundedListLimit(limit, MAX_LIST_LIMIT))
    .all<FormSubmission & { friend_name: string | null }>();
  return result.results;
}

/**
 * LIKE の特別文字を無効化する。`%` と `_` を含む検索語でも、その文字どおりに探す。
 * N-171: `%` を素通しすると「何にでも一致」になり、別ページの一致行を見落とす。
 */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** 管理画面向け回答一覧。全件をブラウザへ渡さず、D1側でページ分けする。 */
export async function getFormSubmissionsPage(
  db: D1Database,
  formId: string,
  options: FormSubmissionPeriod & { page?: number; limit?: number; lineAccountId?: string; search?: string } = {},
): Promise<FormSubmissionPage> {
  const period = submissionPeriodSql('fs.created_at', options);
  const requestedPage = options.page;
  const page = Number.isSafeInteger(requestedPage) && (requestedPage ?? 0) >= 1
    ? requestedPage!
    : 1;
  const limit = boundedListLimit(options.limit, 20);
  const offset = (page - 1) * limit;
  const accountClause = options.lineAccountId ? ' AND f.line_account_id = ?' : '';
  const accountBindings = options.lineAccountId ? [options.lineAccountId] : [];
  // N-171/N-179: 名前と回答内容をページング前にサーバー側で絞り込む。件数と一覧と
  // CSV が同じ条件になるよう、COUNT と取得で WHERE を共有する。空の検索語は絞らない。
  const needle = options.search?.trim() ?? '';
  const searchClause = needle ? ` AND (f.display_name LIKE ? ESCAPE '\\' OR fs.data LIKE ? ESCAPE '\\')` : '';
  const searchBindings = needle ? [`%${escapeLikeLiteral(needle)}%`, `%${escapeLikeLiteral(needle)}%`] : [];
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM form_submissions fs
         LEFT JOIN friends f ON f.id = fs.friend_id
        WHERE fs.form_id = ? AND fs.is_test = 0${accountClause}${searchClause}${period.sql}`,
    )
    .bind(formId, ...accountBindings, ...searchBindings, ...period.bindings)
    .first<{ total: number }>();
  const result = await db
    .prepare(
      `SELECT fs.*, f.display_name as friend_name FROM form_submissions fs
       LEFT JOIN friends f ON f.id = fs.friend_id
       WHERE fs.form_id = ? AND fs.is_test = 0${accountClause}${searchClause}${period.sql}
       ORDER BY fs.created_at DESC, fs.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(formId, ...accountBindings, ...searchBindings, ...period.bindings, limit, offset)
    .all<FormSubmission & { friend_name: string | null }>();
  return { items: result.results, total: count?.total ?? 0, page, limit };
}

/** 友だち詳細欄で使う、フォーム名・質問定義つきの最新回答履歴。 */
export async function getFormSubmissionsByFriend(
  db: D1Database,
  friendId: string,
  limit = 10,
): Promise<FriendFormSubmission[]> {
  const safeLimit = boundedListLimit(limit, 10);
  const result = await db
    .prepare(
      `SELECT fs.*,
              CASE WHEN fs.form_version_id IS NULL THEN f.name ELSE COALESCE(fv.name, '回答時のフォーム') END AS form_name,
              CASE WHEN fs.form_version_id IS NULL THEN f.fields ELSE COALESCE(fv.fields, '[]') END AS form_fields
       FROM form_submissions fs
       JOIN forms f ON f.id = fs.form_id
       LEFT JOIN form_versions fv ON fv.id = fs.form_version_id AND fv.form_id = fs.form_id
       WHERE fs.friend_id = ? AND fs.is_test = 0
       ORDER BY fs.created_at DESC
       LIMIT ?`,
    )
    .bind(friendId, safeLimit)
    .all<FriendFormSubmission>();
  return result.results;
}

/**
 * 友だちのフォーム回答の総数だけを返す（PERF-13）。
 * 初期応答を軽くするため、本文を読まず件数だけを数える。
 * ※同名で「フォーム×友だち」の回数を数える countFormSubmissionsByFriend が
 * 後段にある（「1人1回」判定用）。こちらは友だちの全フォーム横断。
 */
export async function countFriendFormSubmissions(
  db: D1Database,
  friendId: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS total FROM form_submissions WHERE friend_id = ? AND is_test = 0')
    .bind(friendId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/**
 * フォーム回答履歴を古いものへ遡るカーソル式の取得（PERF-13）。
 *
 * 詳細画面の回答タブは「さらに読み込む」で続きを取る。
 * cursor には前のページ末尾の `created_at|id` をそのまま渡す。
 * 同じ created_at の行が跨がっても id で続きが切れないよう、
 * (created_at, id) の組で見る。
 */
export async function getFormSubmissionsByFriendCursor(
  db: D1Database,
  friendId: string,
  input: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: FriendFormSubmission[]; nextCursor: string | null }> {
  const safeLimit = boundedListLimit(input.limit ?? 10, 10);
  let cursorClause = '';
  const bindings: unknown[] = [friendId];
  if (input.cursor) {
    const sep = input.cursor.lastIndexOf('|');
    const cursorCreatedAt = sep > 0 ? input.cursor.slice(0, sep) : input.cursor;
    const cursorId = sep > 0 ? input.cursor.slice(sep + 1) : '';
    cursorClause = ' AND (fs.created_at < ? OR (fs.created_at = ? AND fs.id < ?))';
    bindings.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  }
  const result = await db
    .prepare(
      `SELECT fs.*,
              CASE WHEN fs.form_version_id IS NULL THEN f.name ELSE COALESCE(fv.name, '回答時のフォーム') END AS form_name,
              CASE WHEN fs.form_version_id IS NULL THEN f.fields ELSE COALESCE(fv.fields, '[]') END AS form_fields
       FROM form_submissions fs
       JOIN forms f ON f.id = fs.form_id
       LEFT JOIN form_versions fv ON fv.id = fs.form_version_id AND fv.form_id = fs.form_id
       WHERE fs.friend_id = ? AND fs.is_test = 0${cursorClause}
       ORDER BY fs.created_at DESC, fs.id DESC
       LIMIT ?`,
    )
    .bind(...bindings, safeLimit + 1)
    .all<FriendFormSubmission>();
  const items = result.results.slice(0, safeLimit);
  const hasMore = result.results.length > safeLimit;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
  };
}

/**
 * 回答行の INSERT だけを行う。件数更新は別工程にする。
 *
 * 冪等化した送信では、INSERT 後に件数更新が失敗しても同じキーで再開
 * できるよう、工程ごとに記録する。id を渡すとその値で保存する。
 */
export async function insertFormSubmissionRecord(
  db: D1Database,
  input: CreateFormSubmissionInput & { id?: string },
): Promise<FormSubmission> {
  const id = input.id ?? crypto.randomUUID();
  const now = jstNow();
  const fileIds = [...new Set(input.fileIds ?? [])];
  if (fileIds.length) {
    const placeholders = sqlIdSet(fileIds).sql;
    // D1 batch is a transaction: two concurrent answers cannot claim one upload.
    const results = await db.batch([
      db.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, form_version_id, is_test, data, destination_write_status, created_at)
        SELECT ?, ?, ?, ?, ?, ?, 'pending', ?
        WHERE (SELECT COUNT(*) FROM form_submission_files f JOIN media_file_scans s ON s.id = f.scan_id
          WHERE f.id IN (${placeholders}) AND f.friend_id = ? AND f.form_id = ? AND f.submission_id IS NULL
            AND f.deleted_at IS NULL AND (f.expires_at IS NULL OR julianday(f.expires_at) > julianday(?)) AND s.status = 'clean') = ?`)
        .bind(id, input.formId, input.friendId ?? null, input.formVersionId ?? null, input.isTest ? 1 : 0, input.data, now,
          ...sqlIdSet(fileIds).binds, input.friendId ?? null, input.formId, now, fileIds.length),
      db.prepare(`UPDATE form_submission_files SET submission_id = ? WHERE id IN (${placeholders}) AND submission_id IS NULL
        AND EXISTS (SELECT 1 FROM form_submissions WHERE id = ?)`)
        .bind(id, ...(fileIds.length ? sqlIdSet(fileIds).binds : []), id),
      // Only a conclusively absent answer releases capacity. This transaction also
      // excludes a concurrent successful save; transport failures keep the reservation.
      db.prepare(`DELETE FROM form_capacity_claims WHERE form_id = ? AND submission_id = ?
        AND NOT EXISTS (SELECT 1 FROM form_submissions WHERE id = ?)`)
        .bind(input.formId, id, id),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== fileIds.length) throw new Error('document_attachment_conflict');
    return (await db.prepare('SELECT * FROM form_submissions WHERE id = ?').bind(id).first<FormSubmission>())!;
  }

  await db
    .prepare(
      `INSERT INTO form_submissions
         (id, form_id, friend_id, form_version_id, is_test, data, destination_write_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(id, input.formId, input.friendId ?? null, input.formVersionId ?? null, input.isTest ? 1 : 0, input.data, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>())!;
}

/** 回答の受付数を 1 増やす。キーなし送信の従来の組み立て用。 */
export async function incrementFormSubmitCount(
  db: D1Database,
  formId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE forms SET submit_count = submit_count + 1, updated_at = ? WHERE id = ?`)
    .bind(jstNow(), formId)
    .run();
}

/**
 * 受付数を回答行の実数に合わせる。何度実行しても同じ値になるので、
 * 冪等化した送信の再開時に重ねて実行しても数は狂わない。
 */
export async function resyncFormSubmitCount(
  db: D1Database,
  formId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE forms
          SET submit_count = (SELECT COUNT(*) FROM form_submissions WHERE form_id = ? AND is_test = 0),
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(formId, jstNow(), formId)
    .run();
}

export async function createFormSubmission(
  db: D1Database,
  input: CreateFormSubmissionInput,
): Promise<FormSubmission> {
  const record = await insertFormSubmissionRecord(db, input);
  await incrementFormSubmitCount(db, input.formId);
  return record;
}

/**
 * 全体上限・選択肢定員の枠を1つ、原子的に確保する(N-167 / #751)。
 *
 * 「数えてから比べる」のではなく、**条件付き INSERT 1本で決める**。
 * 空きがあるかの判定(`COUNT < limit`)と確保(行を1つ増やす)を同じ文の
 * 中で行うため、2件が同時に来ても両方が「空きあり」と読むことはない。
 * 取れたかどうかは `changes` が 1 か 0 かで分かる。
 *
 * 同じ (formId, slotKey, submissionId) の再開は、既に確保した枠を成功として
 * 返す。確保後に工程の記録が失敗しても、自分の枠で満席判定にならない。
 * 重複時の更新は日時も変えず、枠を二重に消費しない。
 */
export async function claimFormCapacitySlot(
  db: D1Database,
  formId: string,
  slotKey: string,
  submissionId: string,
  limit: number,
  choice?: { fieldName: string; label: string; isOther: boolean; labels: string[] },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO form_capacity_claims (form_id, slot_key, submission_id, created_at)
       SELECT ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM form_capacity_claims
           WHERE form_id = ? AND slot_key = ? AND submission_id = ?
        ) OR (SELECT COUNT(*) FROM (
          SELECT submission_id AS id FROM form_capacity_claims WHERE form_id = ? AND slot_key = ?
          UNION SELECT s.id FROM form_submissions s
           WHERE s.form_id = ? AND s.is_test = 0 AND (
             ? = '__total__' OR EXISTS (
               SELECT 1 FROM json_each(CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END) field,
                 json_each(CASE WHEN field.type='array' THEN field.value ELSE json_array(field.value) END) answer
               WHERE field.key = ? AND (answer.value = ? OR
                 (? = 1 AND answer.type='text' AND answer.value <> ''
                   AND answer.value NOT IN (SELECT value FROM json_each(?))))
             )
           )
        )) < ?
       ON CONFLICT(form_id, slot_key, submission_id)
       DO UPDATE SET created_at = form_capacity_claims.created_at`,
    )
    .bind(formId, slotKey, submissionId, jstNow(), formId, slotKey, submissionId, formId, slotKey,
      formId, slotKey, choice?.fieldName ?? '', choice?.label ?? '', choice?.isOther ? 1 : 0,
      JSON.stringify(choice?.labels ?? []), limit)
    .run();
  if ((result.meta?.changes ?? 0) > 0) return true;
  const owned = await db.prepare(`SELECT 1 AS owned FROM form_capacity_claims
    WHERE form_id=? AND slot_key=? AND submission_id=?`)
    .bind(formId,slotKey,submissionId).first<{ owned: number }>();
  return Boolean(owned);
}

/**
 * 確保に失敗した回答の後始末。確保済みの枠(あれば)を消す。
 *
 * 枠の確保は回答行(form_submissions)の保存より前に行うことがあるため、
 * `form_capacity_claims.submission_id` は外部キーにしていない。取り消しは
 * ここで明示的に行う。
 */
export async function releaseFormCapacityClaims(
  db: D1Database,
  formId: string,
  submissionId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM form_capacity_claims WHERE form_id = ? AND submission_id = ?`)
    .bind(formId, submissionId)
    .run();
}

export async function updateFormSubmissionDestinationWriteResult(
  db: D1Database,
  submissionId: string,
  result: FormDestinationWriteResult,
): Promise<FormDestinationWriteStatus> {
  const attempted = Math.max(0, Math.floor(result.attempted));
  const succeeded = Math.max(0, Math.min(attempted, Math.floor(result.succeeded)));
  const failed = Math.max(0, Math.min(attempted - succeeded, Math.floor(result.failed)));
  const status: FormDestinationWriteStatus = attempted === 0
    ? 'not_requested'
    : failed === 0 && succeeded === attempted
      ? 'succeeded'
      : succeeded === 0
        ? 'failed'
        : 'partial';
  await db
    .prepare(
      `UPDATE form_submissions
          SET destination_write_status = ?,
              destination_write_attempted = ?,
              destination_write_succeeded = ?,
              destination_write_failed = ?,
              destination_write_completed_at = ?
        WHERE id = ?`,
    )
    .bind(status, attempted, succeeded, failed, jstNow(), submissionId)
    .run();
  return status;
}
