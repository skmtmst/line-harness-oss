import { sqlIdSet } from '../id-queries.js';
import { jstDateString, toJstString } from '../utils.js';
import { type Form, type FormAccountScope, type FormWithStats, type FormUsedByAccount } from './types.js';


/**
 * 回答の後処理がこの長さ以上動きが無ければ「途中で止まった」とみなす。
 * 一覧の「後処理の未完」の札・絞り込みと、予約の横取り判定で同じ目安を
 * 使うためここに置く(worker 側は二重に定義しない)。
 */
export const FORM_SUBMIT_CLAIM_STALE_MS = 60 * 1000;

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getForms(db: D1Database): Promise<Form[]> {
  const result = await db
    .prepare(`SELECT * FROM forms WHERE status = 'active' ORDER BY created_at DESC`)
    .all<Form>();
  return result.results;
}

export async function getFormsWithStats(
  db: D1Database,
  scope: FormAccountScope = {},
): Promise<FormWithStats[]> {
  const accountIds = [...new Set(scope.lineAccountIds ?? [])].filter(Boolean);
  const statusClause = scope.status === 'archived' ? "f.status = 'archived'" : "f.status = 'active'";
  let scopeClause = `WHERE ${statusClause}`;
  if (scope.lineAccountIds !== undefined && accountIds.length === 0) {
    scopeClause = scope.includeUnassigned
      ? `WHERE ${statusClause}
           AND NOT EXISTS (SELECT 1 FROM form_accounts visible WHERE visible.form_id = f.id)`
      : 'WHERE 0';
  } else if (scope.lineAccountIds !== undefined) {
    scopeClause = `WHERE ${statusClause} AND (
           EXISTS (
             SELECT 1 FROM form_accounts visible
             WHERE visible.form_id = f.id
               AND visible.line_account_id IN (${sqlIdSet(accountIds).sql})
           )
           ${scope.includeUnassigned
             ? `OR NOT EXISTS (SELECT 1 FROM form_accounts pending WHERE pending.form_id = f.id)`
             : ''}
         )`;
  }
  const folderBinds: string[] = [];
  if (scope.unfiledOnly) {
    scopeClause += ` AND f.folder_id IS NULL`;
  } else if (scope.folderId !== undefined) {
    scopeClause += ` AND f.folder_id = ?`;
    folderBinds.push(scope.folderId);
  }
  // Single query: forms + last submission + per-account submission counts.
  // json_group_array returns '[]' (not NULL) when subquery yields no rows.
  // P：試し（is_test=1）は最後の回答・利用先の数・今月の数のどこにも入れない。
  // 今月は日本時間の1日から。DBの時刻はJST文字列なので頭7文字（YYYY-MM）で切る。
  const monthPrefix = jstDateString().slice(0, 7);
  // 後処理の未完の目安と同じ「止まった」とみなす基準時刻(JST 文字列比較)。
  const staleBefore = toJstString(new Date(Date.now() - FORM_SUBMIT_CLAIM_STALE_MS));
  const result = await db
    .prepare(
      `SELECT
         f.*,
         (SELECT MAX(created_at) FROM form_submissions WHERE form_id = f.id AND is_test = 0) AS last_submitted_at,
         (SELECT COUNT(*) FROM form_submissions
           WHERE form_id = f.id AND is_test = 0
             AND substr(created_at, 1, 7) = ?) AS monthly_submit_count,
         (SELECT COUNT(DISTINCT friend_id) FROM form_opens
           WHERE form_id = f.id AND is_test = 0 AND friend_id IS NOT NULL
             AND substr(opened_at, 1, 7) = ?) AS monthly_open_count,
         (SELECT COUNT(*) FROM form_submit_claims c
           WHERE c.form_id = f.id AND c.submission_id IS NOT NULL
             AND (c.status = 'failed'
               OR (c.status = 'in_progress' AND c.updated_at < ?))) AS pending_post_action_count,
         NOT EXISTS (
           SELECT 1 FROM form_accounts assigned WHERE assigned.form_id = f.id
         ) AS account_scope_review_required,
         (SELECT json_group_array(
                   json_object(
                     'id', la.id,
                     'name', la.name,
                     'country', la.country,
                     'displayOrder', la.display_order,
                     'count', sub.cnt
                   )
                 )
            FROM form_accounts assigned
            JOIN line_accounts la ON la.id = assigned.line_account_id
            LEFT JOIN (
              SELECT fr.line_account_id, COUNT(*) AS cnt
              FROM form_submissions fs
              JOIN friends fr ON fr.id = fs.friend_id
              WHERE fs.form_id = f.id AND fs.is_test = 0 AND fr.line_account_id IS NOT NULL
              GROUP BY fr.line_account_id
            ) sub ON sub.line_account_id = assigned.line_account_id
            WHERE assigned.form_id = f.id) AS used_by_accounts_json
       FROM forms f
       ${scopeClause}
       ORDER BY
         CASE WHEN last_submitted_at IS NULL THEN 1 ELSE 0 END,
         last_submitted_at DESC,
         f.created_at DESC`,
    )
    .bind(monthPrefix, monthPrefix, staleBefore, ...(accountIds.length ? sqlIdSet(accountIds).binds : []), ...folderBinds)
    .all<Form & {
      last_submitted_at: string | null;
      account_scope_review_required: number;
      used_by_accounts_json: string | null;
      monthly_submit_count: number;
      monthly_open_count: number;
      pending_post_action_count: number;
    }>();

  return result.results.map((row) => {
    const {
      used_by_accounts_json,
      monthly_submit_count,
      monthly_open_count,
      pending_post_action_count,
      ...rest
    } = row;
    let parsed: FormUsedByAccount[] = [];
    if (used_by_accounts_json) {
      try {
        const arr = JSON.parse(used_by_accounts_json) as FormUsedByAccount[];
        parsed = arr.sort((a, b) => a.displayOrder - b.displayOrder);
      } catch {
        parsed = [];
      }
    }
    const monthlySubmits = Number(monthly_submit_count ?? 0);
    const monthlyOpens = Number(monthly_open_count ?? 0);
    return {
      ...rest,
      account_scope_review_required: Boolean(rest.account_scope_review_required),
      used_by_accounts: parsed.map((account) => ({ ...account, count: account.count ?? 0 })),
      monthly_submit_count: monthlySubmits,
      monthly_open_count: monthlyOpens,
      // 開いた人が 0 のときは null（「—」と出す。0% とは言わない）。
      monthly_completion_rate: monthlyOpens === 0
        ? null
        : Math.round((monthlySubmits / monthlyOpens) * 1000) / 10,
      pending_post_action_count: Number(pending_post_action_count ?? 0),
    };
  });
}

export async function getFormAccountIds(db: D1Database, formId: string): Promise<string[]> {
  const result = await db
    .prepare(`SELECT line_account_id FROM form_accounts WHERE form_id = ? ORDER BY line_account_id`)
    .bind(formId)
    .all<{ line_account_id: string }>();
  return result.results.map((row) => row.line_account_id);
}

export async function formBelongsToLineAccount(
  db: D1Database,
  formId: string,
  lineAccountId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS found FROM form_accounts WHERE form_id = ? AND line_account_id = ?`)
    .bind(formId, lineAccountId)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export async function attachFormAccounts(
  db: D1Database,
  formId: string,
  lineAccountIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(lineAccountIds)].filter(Boolean);
  if (uniqueIds.length === 0) return;
  await db.batch(uniqueIds.map((accountId) => db
    .prepare(`INSERT OR IGNORE INTO form_accounts (form_id, line_account_id) VALUES (?, ?)`)
    .bind(formId, accountId)));
}

export async function getFormById(
  db: D1Database,
  id: string,
  options: { includeArchived?: boolean; published?: boolean } = {},
): Promise<Form | null> {
  if (options.published) {
    return db
      .prepare(
        `SELECT f.id,
                v.name, v.description, v.fields, v.layout,
                v.on_submit_tag_id, v.on_submit_scenario_id,
                v.on_submit_message_type, v.on_submit_message_content,
                v.on_submit_webhook_url, v.on_submit_webhook_headers,
                v.on_submit_webhook_fail_message, v.save_to_metadata,
                f.is_active, f.status, f.archived_at, f.revision,
                f.content_revision, f.current_published_version_id,
                v.source_content_revision AS published_content_revision,
                f.submit_count, v.og_title, v.og_description, v.og_image_url,
                f.created_at, v.published_at AS updated_at
           FROM forms f
           JOIN form_versions v
             ON v.id = f.current_published_version_id AND v.form_id = f.id
          WHERE f.id = ? AND f.status = 'active'`,
      )
      .bind(id)
      .first<Form>();
  }
  return db
    .prepare(
      `SELECT f.*,
              (SELECT source_content_revision FROM form_versions v
                WHERE v.id = f.current_published_version_id AND v.form_id = f.id)
                AS published_content_revision
         FROM forms f
        WHERE f.id = ?${options.includeArchived ? '' : " AND f.status = 'active'"}`,
    )
    .bind(id)
    .first<Form>();
}
