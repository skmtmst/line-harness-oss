import type { FormSubmission } from '../form-submission-types.js';
import { type FormSubmissionPeriod, submissionPeriodSql } from '../form-submission-period.js';
import { sqlIdSet } from '../id-queries.js';
import { type FormSubmissionAnalytics, type FormDateFieldAnalytics, type FormRatingFieldAnalytics } from './types.js';


/** 回答一覧のKPI。ページ内ではなく、選択中アカウントの全回答をD1で集計する。 */
export async function getFormSubmissionAnalytics(
  db: D1Database,
  formId: string,
  lineAccountId: string,
  dateFields: Array<{ key: string; label: string }>,
  ratingFields: Array<{ key: string; label: string }> = [],
  period: FormSubmissionPeriod = {},
): Promise<FormSubmissionAnalytics> {
  const submissionsPeriod = submissionPeriodSql('fs.created_at', period), opensPeriod = submissionPeriodSql('fo.opened_at', period);
  const [submissionSummary, openSummary] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS submitted,
              COALESCE(SUM(CASE WHEN fs.destination_write_status = 'pending' THEN 1 ELSE 0 END), 0) AS write_pending,
              COALESCE(SUM(CASE WHEN fs.destination_write_status = 'succeeded' THEN 1 ELSE 0 END), 0) AS write_succeeded,
              COALESCE(SUM(CASE WHEN fs.destination_write_status = 'partial' THEN 1 ELSE 0 END), 0) AS write_partial,
              COALESCE(SUM(CASE WHEN fs.destination_write_status = 'failed' THEN 1 ELSE 0 END), 0) AS write_failed,
              COALESCE(SUM(CASE WHEN fs.destination_write_status = 'not_requested' THEN 1 ELSE 0 END), 0) AS write_not_requested,
              COALESCE(SUM(CASE WHEN fs.destination_write_status = 'unknown' THEN 1 ELSE 0 END), 0) AS write_unknown
         FROM form_submissions fs
         JOIN friends f ON f.id = fs.friend_id
        WHERE fs.form_id = ? AND f.line_account_id = ? AND fs.is_test = 0${submissionsPeriod.sql}`,
    ).bind(formId, lineAccountId, ...submissionsPeriod.bindings).first<{
      submitted: number;
      write_pending: number;
      write_succeeded: number;
      write_partial: number;
      write_failed: number;
      write_not_requested: number;
      write_unknown: number;
    }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT fo.friend_id) AS started_unique
         FROM form_opens fo
         JOIN friends f ON f.id = fo.friend_id
        WHERE fo.form_id = ? AND f.line_account_id = ? AND fo.is_test = 0${opensPeriod.sql}`,
    ).bind(formId, lineAccountId, ...opensPeriod.bindings).first<{ started_unique: number }>(),
  ]);

  const submitted = Number(submissionSummary?.submitted ?? 0);
  const startedUnique = Number(openSummary?.started_unique ?? 0);
  const normalizedDateFields = [...new Map(
    dateFields.filter((field) => field.key).map((field) => [field.key, field]),
  ).values()];
  const dateFieldResults: FormDateFieldAnalytics[] = [];
  for (const field of normalizedDateFields) {
    const row = await db.prepare(
      `SELECT COUNT(*) AS answered,
              COUNT(DISTINCT fs.friend_id) AS unique_friends,
              MIN(CAST(answer.value AS TEXT)) AS min_date,
              MAX(CAST(answer.value AS TEXT)) AS max_date
         FROM form_submissions fs
         JOIN friends f ON f.id = fs.friend_id
         JOIN json_each(CASE WHEN json_valid(fs.data) THEN fs.data ELSE '{}' END) answer
        WHERE fs.form_id = ?
          AND f.line_account_id = ?
          AND fs.is_test = 0${submissionsPeriod.sql}
          AND answer.key = ?
          AND answer.value IS NOT NULL
          AND TRIM(CAST(answer.value AS TEXT)) <> ''`,
    ).bind(formId, lineAccountId, ...submissionsPeriod.bindings, field.key).first<{
      answered: number;
      unique_friends: number;
      min_date: string | null;
      max_date: string | null;
    }>();
    dateFieldResults.push({
      key: field.key,
      label: field.label,
      answered: Number(row?.answered ?? 0),
      uniqueFriends: Number(row?.unique_friends ?? 0),
      minDate: row?.min_date ?? null,
      maxDate: row?.max_date ?? null,
    });
  }

  let dateAnsweredUniqueFriends = 0;
  if (normalizedDateFields.length > 0) {
    const placeholders = sqlIdSet(normalizedDateFields.map(field => field.key)).sql;
    const row = await db.prepare(
      `SELECT COUNT(DISTINCT fs.friend_id) AS unique_friends
         FROM form_submissions fs
         JOIN friends f ON f.id = fs.friend_id
         JOIN json_each(CASE WHEN json_valid(fs.data) THEN fs.data ELSE '{}' END) answer
        WHERE fs.form_id = ?
          AND f.line_account_id = ?
          AND fs.is_test = 0${submissionsPeriod.sql}
          AND answer.key IN (${placeholders})
          AND answer.value IS NOT NULL
          AND TRIM(CAST(answer.value AS TEXT)) <> ''`,
    ).bind(formId, lineAccountId, ...submissionsPeriod.bindings, ...sqlIdSet(normalizedDateFields.map(field => field.key)).binds)
      .first<{ unique_friends: number }>();
    dateAnsweredUniqueFriends = Number(row?.unique_friends ?? 0);
  }

  const normalizedRatingFields = [...new Map(
    ratingFields.filter((field) => field.key).map((field) => [field.key, field]),
  ).values()];
  const ratingFieldResults: FormRatingFieldAnalytics[] = [];
  for (const field of normalizedRatingFields) {
    // 受け入れ・保存・平均の型を一致させる。整数1〜5とちょうどの "1"〜"5" だけ。
    // 真偽値（SQLiteで1に化ける）・小数・"3.0"・"3e0" は数えない。
    // 不正な旧値は0へ混ぜず、未回答として数えない。未回答の平均はnull。
    const row = await db.prepare(
      `SELECT COUNT(*) AS answered,
              AVG(CAST(answer.value AS REAL)) AS average
         FROM form_submissions fs
         JOIN friends f ON f.id = fs.friend_id
         JOIN json_each(CASE WHEN json_valid(fs.data) THEN fs.data ELSE '{}' END) answer
        WHERE fs.form_id = ?
          AND f.line_account_id = ?
          AND fs.is_test = 0${submissionsPeriod.sql}
          AND answer.key = ?
          AND answer.type IN ('integer', 'text')
          AND TRIM(CAST(answer.value AS TEXT)) IN ('1', '2', '3', '4', '5')`,
    ).bind(formId, lineAccountId, ...submissionsPeriod.bindings, field.key).first<{
      answered: number;
      average: number | null;
    }>();
    const answered = Number(row?.answered ?? 0);
    const average = row?.average === null || row?.average === undefined
      ? null
      : Math.round(Number(row.average) * 10) / 10;
    ratingFieldResults.push({
      key: field.key,
      label: field.label,
      answered,
      average: answered === 0 ? null : average,
    });
  }

  return {
    startedUnique,
    submitted,
    completionRate: startedUnique === 0 ? null : Math.round((submitted / startedUnique) * 1000) / 10,
    destinationWrites: {
      pending: Number(submissionSummary?.write_pending ?? 0),
      succeeded: Number(submissionSummary?.write_succeeded ?? 0),
      partial: Number(submissionSummary?.write_partial ?? 0),
      failed: Number(submissionSummary?.write_failed ?? 0),
      not_requested: Number(submissionSummary?.write_not_requested ?? 0),
      unknown: Number(submissionSummary?.write_unknown ?? 0),
    },
    dateAnsweredUniqueFriends,
    dateFields: dateFieldResults,
    ratingFields: ratingFieldResults,
  };
}

// ── 送信時の制限判定 ─────────────────────────────────────────────────────────

/** この友だちが、このフォームに何回答えたか。「1人1回」の判定に使う。 */
export async function countFormSubmissionsByFriend(
  db: D1Database,
  formId: string,
  friendId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM form_submissions WHERE form_id = ? AND friend_id = ? AND is_test = 0`,
    )
    .bind(formId, friendId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * 冪等キーの再送照合用に、回答を id で直接読む。
 * キーは回答行の id そのものなので、同時送信の負けた側もここで勝ち行を読む。
 */
export async function getFormSubmissionById(
  db: D1Database,
  id: string,
): Promise<FormSubmission | null> {
  return db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>();
}
