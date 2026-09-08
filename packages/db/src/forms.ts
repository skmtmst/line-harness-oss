import { boundedListLimit, jstNow } from './utils.js';
// =============================================================================
// Forms — Survey / questionnaire system (L社 回答フォーム equivalent)
// =============================================================================

export interface Form {
  id: string;
  name: string;
  description: string | null;
  fields: string; // JSON string of FormField[]（layout から作り直す互換用）
  /** 回答フォームの中身。FormLayout の JSON。NULL なら fields だけのフォーム */
  layout: string | null;
  on_submit_tag_id: string | null;
  on_submit_scenario_id: string | null;
  on_submit_message_type: 'text' | 'flex' | null;
  on_submit_message_content: string | null; // supports template variables: {{name}}, {{auth_url:CHANNEL_ID}}, etc.
  on_submit_webhook_url: string | null;
  on_submit_webhook_headers: string | null;
  on_submit_webhook_fail_message: string | null;
  save_to_metadata: number;
  is_active: number;
  status: 'active' | 'archived';
  archived_at: string | null;
  revision: number;
  submit_count: number;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  friend_id: string | null;
  data: string; // JSON string
  destination_write_status: FormDestinationWriteStatus;
  destination_write_attempted: number | null;
  destination_write_succeeded: number | null;
  destination_write_failed: number | null;
  destination_write_completed_at: string | null;
  created_at: string;
}

export type FormDestinationWriteStatus =
  | 'pending'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'not_requested'
  | 'unknown';

export interface FriendFormSubmission extends FormSubmission {
  form_name: string;
  form_fields: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getForms(db: D1Database): Promise<Form[]> {
  const result = await db
    .prepare(`SELECT * FROM forms WHERE status = 'active' ORDER BY created_at DESC`)
    .all<Form>();
  return result.results;
}

export interface FormUsedByAccount {
  id: string;
  name: string;
  country: string | null;
  displayOrder: number;
  count: number;
}

export interface FormWithStats extends Form {
  last_submitted_at: string | null;
  used_by_accounts: FormUsedByAccount[];
  account_scope_review_required: boolean;
}

export interface FormAccountScope {
  lineAccountIds?: string[];
  includeUnassigned?: boolean;
}

export async function getFormsWithStats(
  db: D1Database,
  scope: FormAccountScope = {},
): Promise<FormWithStats[]> {
  const accountIds = [...new Set(scope.lineAccountIds ?? [])].filter(Boolean);
  let scopeClause = `WHERE f.status = 'active'`;
  if (scope.lineAccountIds !== undefined && accountIds.length === 0) {
    scopeClause = scope.includeUnassigned
      ? `WHERE f.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM form_accounts visible WHERE visible.form_id = f.id)`
      : 'WHERE 0';
  } else if (scope.lineAccountIds !== undefined) {
    scopeClause = `WHERE f.status = 'active' AND (
           EXISTS (
             SELECT 1 FROM form_accounts visible
             WHERE visible.form_id = f.id
               AND visible.line_account_id IN (${accountIds.map(() => '?').join(', ')})
           )
           ${scope.includeUnassigned
             ? `OR NOT EXISTS (SELECT 1 FROM form_accounts pending WHERE pending.form_id = f.id)`
             : ''}
         )`;
  }
  // Single query: forms + last submission + per-account submission counts.
  // json_group_array returns '[]' (not NULL) when subquery yields no rows.
  const result = await db
    .prepare(
      `SELECT
         f.*,
         (SELECT MAX(created_at) FROM form_submissions WHERE form_id = f.id) AS last_submitted_at,
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
              WHERE fs.form_id = f.id AND fr.line_account_id IS NOT NULL
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
    .bind(...accountIds)
    .all<Form & {
      last_submitted_at: string | null;
      account_scope_review_required: number;
      used_by_accounts_json: string | null;
    }>();

  return result.results.map((row) => {
    const { used_by_accounts_json, ...rest } = row;
    let parsed: FormUsedByAccount[] = [];
    if (used_by_accounts_json) {
      try {
        const arr = JSON.parse(used_by_accounts_json) as FormUsedByAccount[];
        parsed = arr.sort((a, b) => a.displayOrder - b.displayOrder);
      } catch {
        parsed = [];
      }
    }
    return {
      ...rest,
      account_scope_review_required: Boolean(rest.account_scope_review_required),
      used_by_accounts: parsed.map((account) => ({ ...account, count: account.count ?? 0 })),
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
  options: { includeArchived?: boolean } = {},
): Promise<Form | null> {
  return db
    .prepare(`SELECT * FROM forms WHERE id = ?${options.includeArchived ? '' : " AND status = 'active'"}`)
    .bind(id)
    .first<Form>();
}

export type FormDeleteReference = {
  kind: 'webinar' | 'rich_menu';
  name: string | null;
  href: string | null;
  state: 'available' | 'unavailable';
};

export type FormDeleteImpact = {
  form: {
    id: string;
    name: string;
    isActive: boolean;
    status: 'active' | 'archived';
  };
  submissionCount: number;
  openCount: number;
  references: FormDeleteReference[];
  referenceCount: number;
  answerUrl: string | null;
  revision: number;
  checkedAt: string;
  canDelete: boolean;
  canArchive: boolean;
  recommendedAction: 'delete' | 'archive' | 'none';
  blockers: Array<'published' | 'has_submissions' | 'has_opens' | 'in_use' | 'already_archived'>;
};

type FormImpactRow = Pick<Form, 'id' | 'name' | 'is_active' | 'status' | 'revision'>;
type FormImpactReferenceRow = {
  kind: FormDeleteReference['kind'];
  name: string | null;
  href: string | null;
};

/**
 * 削除・保管の直前に読む影響。回答と利用先を**同じ時点の版**に結びつける。
 * 名前を引けない参照も落とさず unavailable として返し、削除を止める。
 */
export async function getFormDeleteImpact(
  db: D1Database,
  id: string,
  lineAccountId: string,
  checkedAt: string = jstNow(),
): Promise<FormDeleteImpact | null> {
  const results = await db.batch([
    db.prepare(
      `SELECT f.id, f.name, f.is_active, f.status, f.revision
         FROM forms f
         JOIN form_accounts fa ON fa.form_id = f.id
        WHERE f.id = ? AND fa.line_account_id = ?`,
    ).bind(id, lineAccountId),
    db.prepare(`SELECT COUNT(*) AS total FROM form_submissions WHERE form_id = ?`).bind(id),
    db.prepare(`SELECT COUNT(*) AS total FROM form_opens WHERE form_id = ?`).bind(id),
    db.prepare(
      `SELECT 'webinar' AS kind,
              w.title AS name,
              CASE WHEN w.id IS NULL THEN NULL ELSE '/webinars/edit?id=' || w.id END AS href
         FROM webinar_ctas c
         LEFT JOIN webinars w ON w.id = c.webinar_id
        WHERE c.form_id = ?
        ORDER BY w.title, c.id`,
    ).bind(id),
    db.prepare(
      `SELECT 'rich_menu' AS kind,
              CASE
                WHEN g.id IS NULL THEN NULL
                WHEN p.name IS NULL OR p.name = '' THEN g.name
                ELSE g.name || '・' || p.name
              END AS name,
              CASE WHEN g.id IS NULL THEN NULL ELSE '/rich-menus/edit?id=' || g.id END AS href
         FROM rich_menu_areas a
         LEFT JOIN rich_menu_pages p ON p.id = a.page_id
         LEFT JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE a.form_id = ?
        ORDER BY g.name, p.order_index, a.id`,
    ).bind(id),
    db.prepare(`SELECT liff_id FROM line_accounts WHERE id = ?`).bind(lineAccountId),
  ]);

  const row = results[0]?.results?.[0] as FormImpactRow | undefined;
  if (!row) return null;
  const submissionCount = Number((results[1]?.results?.[0] as { total?: number } | undefined)?.total ?? 0);
  const openCount = Number((results[2]?.results?.[0] as { total?: number } | undefined)?.total ?? 0);
  const referenceRows = [
    ...(results[3]?.results ?? []),
    ...(results[4]?.results ?? []),
  ] as FormImpactReferenceRow[];
  const references = referenceRows.map((reference): FormDeleteReference => ({
    ...reference,
    state: reference.name && reference.href ? 'available' : 'unavailable',
  }));
  const blockers: FormDeleteImpact['blockers'] = [];
  if (row.status === 'archived') blockers.push('already_archived');
  if (Boolean(row.is_active)) blockers.push('published');
  if (submissionCount > 0) blockers.push('has_submissions');
  if (openCount > 0) blockers.push('has_opens');
  if (references.length > 0) blockers.push('in_use');
  const canDelete = blockers.length === 0;
  const canArchive = row.status === 'active';
  const liffId = (results[5]?.results?.[0] as { liff_id?: string | null } | undefined)?.liff_id ?? null;

  return {
    form: {
      id: row.id,
      name: row.name,
      isActive: Boolean(row.is_active),
      status: row.status,
    },
    submissionCount,
    openCount,
    references,
    referenceCount: references.length,
    answerUrl: liffId
      ? `https://liff.line.me/${liffId}/?page=form&id=${encodeURIComponent(row.id)}`
      : null,
    revision: row.revision,
    checkedAt,
    canDelete,
    canArchive,
    recommendedAction: canDelete ? 'delete' : canArchive ? 'archive' : 'none',
    blockers,
  };
}

/** 公開を止め、回答と利用先を残したまま一覧から保管へ移す。 */
export async function archiveFormAtRevision(
  db: D1Database,
  id: string,
  expectedRevision: number,
): Promise<Form | null> {
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE forms
        SET status = 'archived', is_active = 0, archived_at = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND status = 'active' AND revision = ?`,
  ).bind(now, now, id, expectedRevision).run();
  if ((result.meta?.changes ?? 0) !== 1) return null;
  return getFormById(db, id, { includeArchived: true });
}

/** 回答・利用先が無く、非公開で、確認した版のままのときだけ物理削除する。 */
export async function deleteFormAtRevision(
  db: D1Database,
  id: string,
  expectedRevision: number,
): Promise<boolean> {
  const result = await db.prepare(
    `DELETE FROM forms
      WHERE id = ?
        AND status = 'active'
        AND is_active = 0
        AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM form_submissions WHERE form_id = forms.id)
        AND NOT EXISTS (SELECT 1 FROM form_opens WHERE form_id = forms.id)
        AND NOT EXISTS (SELECT 1 FROM webinar_ctas WHERE form_id = forms.id)
        AND NOT EXISTS (SELECT 1 FROM rich_menu_areas WHERE form_id = forms.id)`,
  ).bind(id, expectedRevision).run();
  return (result.meta?.changes ?? 0) === 1;
}

export interface CreateFormInput {
  name: string;
  description?: string | null;
  fields: string; // JSON string
  layout?: string | null;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
  /** 新規作成画面から作る空レコードは公開しない。未指定は既存互換で公開中。 */
  isActive?: boolean;
  /** 明示したLINE公式アカウントだけで利用する。 */
  lineAccountIds?: string[];
}

export async function createForm(db: D1Database, input: CreateFormInput): Promise<Form> {
  const id = crypto.randomUUID();
  const now = jstNow();

  try {
    await db
      .prepare(
        `INSERT INTO forms
         (id, name, description, fields, layout, on_submit_tag_id, on_submit_scenario_id,
          on_submit_message_type, on_submit_message_content,
          on_submit_webhook_url, on_submit_webhook_headers, on_submit_webhook_fail_message,
          save_to_metadata, is_active, submit_count,
          og_title, og_description, og_image_url,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.description ?? null,
        input.fields,
        input.layout ?? null,
        input.onSubmitTagId ?? null,
        input.onSubmitScenarioId ?? null,
        input.onSubmitMessageType ?? null,
        input.onSubmitMessageContent ?? null,
        input.onSubmitWebhookUrl ?? null,
        input.onSubmitWebhookHeaders ?? null,
        input.onSubmitWebhookFailMessage ?? null,
        input.saveToMetadata !== false ? 1 : 0,
        input.isActive === false ? 0 : 1,
        input.ogTitle ?? null,
        input.ogDescription ?? null,
        input.ogImageUrl ?? null,
        now,
        now,
      )
      .run();

    await attachFormAccounts(db, id, input.lineAccountIds ?? []);
  } catch (error) {
    // 所属だけ保存に失敗したフォームを残さない。管理画面から見えない孤立行になるため。
    await db.prepare(`DELETE FROM forms WHERE id = ?`).bind(id).run().catch(() => undefined);
    throw error;
  }

  return (await getFormById(db, id))!;
}

export interface UpdateFormInput {
  name?: string;
  description?: string | null;
  fields?: string;
  layout?: string | null;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
  isActive?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
}

export async function updateForm(
  db: D1Database,
  id: string,
  input: UpdateFormInput,
): Promise<Form | null> {
  const existing = await getFormById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE forms
       SET name = ?,
           description = ?,
           fields = ?,
           layout = ?,
           on_submit_tag_id = ?,
           on_submit_scenario_id = ?,
           on_submit_message_type = ?,
           on_submit_message_content = ?,
           on_submit_webhook_url = ?,
           on_submit_webhook_headers = ?,
           on_submit_webhook_fail_message = ?,
           save_to_metadata = ?,
           is_active = ?,
           og_title = ?,
           og_description = ?,
           og_image_url = ?,
           updated_at = ?,
           revision = revision + 1
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      'description' in input ? (input.description ?? null) : existing.description,
      input.fields ?? existing.fields,
      'layout' in input ? (input.layout ?? null) : existing.layout,
      'onSubmitTagId' in input ? (input.onSubmitTagId ?? null) : existing.on_submit_tag_id,
      'onSubmitScenarioId' in input
        ? (input.onSubmitScenarioId ?? null)
        : existing.on_submit_scenario_id,
      'onSubmitMessageType' in input
        ? (input.onSubmitMessageType ?? null)
        : existing.on_submit_message_type,
      'onSubmitMessageContent' in input
        ? (input.onSubmitMessageContent ?? null)
        : existing.on_submit_message_content,
      'onSubmitWebhookUrl' in input
        ? (input.onSubmitWebhookUrl ?? null)
        : existing.on_submit_webhook_url,
      'onSubmitWebhookHeaders' in input
        ? (input.onSubmitWebhookHeaders ?? null)
        : existing.on_submit_webhook_headers,
      'onSubmitWebhookFailMessage' in input
        ? (input.onSubmitWebhookFailMessage ?? null)
        : existing.on_submit_webhook_fail_message,
      'saveToMetadata' in input
        ? (input.saveToMetadata !== false ? 1 : 0)
        : existing.save_to_metadata,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      'ogTitle' in input ? (input.ogTitle ?? null) : existing.og_title,
      'ogDescription' in input ? (input.ogDescription ?? null) : existing.og_description,
      'ogImageUrl' in input ? (input.ogImageUrl ?? null) : existing.og_image_url,
      now,
      id,
    )
    .run();

  return getFormById(db, id);
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function getFormSubmissions(
  db: D1Database,
  formId: string,
): Promise<FormSubmission[]> {
  const result = await db
    .prepare(
      `SELECT fs.*, f.display_name as friend_name FROM form_submissions fs
       LEFT JOIN friends f ON f.id = fs.friend_id
       WHERE fs.form_id = ? ORDER BY fs.created_at DESC LIMIT ?`,
    )
    .bind(formId, 200)
    .all<FormSubmission & { friend_name: string | null }>();
  return result.results;
}

export interface FormSubmissionPage {
  items: Array<FormSubmission & { friend_name: string | null }>;
  total: number;
  page: number;
  limit: number;
}

/** 管理画面向け回答一覧。全件をブラウザへ渡さず、D1側でページ分けする。 */
export async function getFormSubmissionsPage(
  db: D1Database,
  formId: string,
  options: { page?: number; limit?: number; lineAccountId?: string } = {},
): Promise<FormSubmissionPage> {
  const requestedPage = options.page;
  const page = Number.isSafeInteger(requestedPage) && (requestedPage ?? 0) >= 1
    ? requestedPage!
    : 1;
  const limit = boundedListLimit(options.limit, 20);
  const offset = (page - 1) * limit;
  const accountClause = options.lineAccountId ? ' AND f.line_account_id = ?' : '';
  const accountBindings = options.lineAccountId ? [options.lineAccountId] : [];
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM form_submissions fs
         LEFT JOIN friends f ON f.id = fs.friend_id
        WHERE fs.form_id = ?${accountClause}`,
    )
    .bind(formId, ...accountBindings)
    .first<{ total: number }>();
  const result = await db
    .prepare(
      `SELECT fs.*, f.display_name as friend_name FROM form_submissions fs
       LEFT JOIN friends f ON f.id = fs.friend_id
       WHERE fs.form_id = ?${accountClause}
       ORDER BY fs.created_at DESC, fs.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(formId, ...accountBindings, limit, offset)
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
      `SELECT fs.*, f.name AS form_name, f.fields AS form_fields
       FROM form_submissions fs
       JOIN forms f ON f.id = fs.form_id
       WHERE fs.friend_id = ?
       ORDER BY fs.created_at DESC
       LIMIT ?`,
    )
    .bind(friendId, safeLimit)
    .all<FriendFormSubmission>();
  return result.results;
}

export interface CreateFormSubmissionInput {
  formId: string;
  friendId?: string | null;
  data: string; // JSON string
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

  await db
    .prepare(
      `INSERT INTO form_submissions
         (id, form_id, friend_id, data, destination_write_status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(id, input.formId, input.friendId ?? null, input.data, now)
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
          SET submit_count = (SELECT COUNT(*) FROM form_submissions WHERE form_id = ?),
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

export interface FormDestinationWriteResult {
  attempted: number;
  succeeded: number;
  failed: number;
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

export interface FormDateFieldAnalytics {
  key: string;
  label: string;
  answered: number;
  uniqueFriends: number;
  minDate: string | null;
  maxDate: string | null;
}

export interface FormSubmissionAnalytics {
  startedUnique: number;
  submitted: number;
  completionRate: number | null;
  destinationWrites: Record<FormDestinationWriteStatus, number>;
  dateAnsweredUniqueFriends: number;
  dateFields: FormDateFieldAnalytics[];
}

/** 回答一覧のKPI。ページ内ではなく、選択中アカウントの全回答をD1で集計する。 */
export async function getFormSubmissionAnalytics(
  db: D1Database,
  formId: string,
  lineAccountId: string,
  dateFields: Array<{ key: string; label: string }>,
): Promise<FormSubmissionAnalytics> {
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
        WHERE fs.form_id = ? AND f.line_account_id = ?`,
    ).bind(formId, lineAccountId).first<{
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
        WHERE fo.form_id = ? AND f.line_account_id = ?`,
    ).bind(formId, lineAccountId).first<{ started_unique: number }>(),
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
          AND answer.key = ?
          AND answer.value IS NOT NULL
          AND TRIM(CAST(answer.value AS TEXT)) <> ''`,
    ).bind(formId, lineAccountId, field.key).first<{
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
    const placeholders = normalizedDateFields.map(() => '?').join(', ');
    const row = await db.prepare(
      `SELECT COUNT(DISTINCT fs.friend_id) AS unique_friends
         FROM form_submissions fs
         JOIN friends f ON f.id = fs.friend_id
         JOIN json_each(CASE WHEN json_valid(fs.data) THEN fs.data ELSE '{}' END) answer
        WHERE fs.form_id = ?
          AND f.line_account_id = ?
          AND answer.key IN (${placeholders})
          AND answer.value IS NOT NULL
          AND TRIM(CAST(answer.value AS TEXT)) <> ''`,
    ).bind(formId, lineAccountId, ...normalizedDateFields.map((field) => field.key))
      .first<{ unique_friends: number }>();
    dateAnsweredUniqueFriends = Number(row?.unique_friends ?? 0);
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
      `SELECT COUNT(*) AS n FROM form_submissions WHERE form_id = ? AND friend_id = ?`,
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

// ── 送信の冪等予約 ─────────────────────────────────────────────────────────
// Webhook・LINE通知などの外部副作用より前に予約行を確保し、同時送信の
// 片方だけが処理を進める。scope は(テナント・LINEアカウント・フォーム・
// 友だち・キー)。途中失敗は failed に残し、同じキーで再開する。

export type FormSubmitClaimStatus = 'in_progress' | 'failed' | 'completed';

export interface FormSubmitClaim {
  tenant_id: string;
  line_account_id: string;
  form_id: string;
  friend_id: string;
  idempotency_key: string;
  request_hash: string;
  status: FormSubmitClaimStatus;
  /** 終わった工程の名前の JSON 配列 */
  steps: string;
  /** Webhook の結果の JSON。未実行は NULL */
  webhook: string | null;
  /** 確保済みの回答行の id。回答の保存前は NULL */
  submission_id: string | null;
  /** 処理中の所有者(試行ごとの UUID)。横取りの判定に使う */
  owner: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface FormSubmitClaimScope {
  tenantId: string;
  lineAccountId: string;
  formId: string;
  friendId: string;
  key: string;
}

function claimBindings(scope: FormSubmitClaimScope): string[] {
  return [scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key];
}

const CLAIM_SCOPE_WHERE =
  `tenant_id = ? AND line_account_id = ? AND form_id = ? AND friend_id = ? AND idempotency_key = ?`;

/** 予約行を読む。なければ NULL。 */
export async function getFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
): Promise<FormSubmitClaim | null> {
  return db
    .prepare(`SELECT * FROM form_submit_claims WHERE ${CLAIM_SCOPE_WHERE}`)
    .bind(...claimBindings(scope))
    .first<FormSubmitClaim>();
}

export interface CreateFormSubmitClaimInput extends FormSubmitClaimScope {
  requestHash: string;
  /**
   * 確保する回答行の id。予約時に採番して予約行へ書き込み、回答の保存と
   * 再開時の読み返しを同じ id で行う(二重保存を防ぐ)。
   */
  submissionId: string;
  owner: string;
  expiresAt: string;
}

/**
 * 予約行を原子的に確保する。同時送信の片方だけが true で返る。
 *
 * すでに同じ scope・キーの行があるときは作らず、残っている行を返す。
 * (主キーが同時実行を 1 行にまとめる)
 */
export async function createFormSubmitClaim(
  db: D1Database,
  input: CreateFormSubmitClaimInput,
): Promise<{ claimed: boolean; claim: FormSubmitClaim }> {
  const now = jstNow();
  try {
    await db
      .prepare(
        `INSERT INTO form_submit_claims
           (tenant_id, line_account_id, form_id, friend_id, idempotency_key,
            request_hash, status, steps, webhook, submission_id,
            owner, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'in_progress', '[]', NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.tenantId,
        input.lineAccountId,
        input.formId,
        input.friendId,
        input.key,
        input.requestHash,
        input.submissionId,
        input.owner,
        now,
        now,
        input.expiresAt,
      )
      .run();
  } catch {
    const existing = await getFormSubmitClaim(db, input);
    if (!existing) throw new Error('form_submit_claim_conflict_without_row');
    return { claimed: false, claim: existing };
  }
  return {
    claimed: true,
    claim: (await getFormSubmitClaim(db, input))!,
  };
}

/**
 * 止まった予約の横取り。failed は即時、in_progress は古いものだけ所有者を
 * 書き換える。書き換えられた試行だけが true で返り、処理を再開する。
 * (friend_scenarios の楽観ロックと同じ流儀)
 */
export async function takeoverFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  staleBefore: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET owner = ?, status = 'in_progress', updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE}
          AND (status = 'failed' OR (status = 'in_progress' AND updated_at < ?))`,
    )
    .bind(owner, jstNow(), ...claimBindings(scope), staleBefore)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** 工程の記録を読む。壊れていれば空として扱う。 */
export function readFormSubmitClaimSteps(claim: Pick<FormSubmitClaim, 'steps'>): string[] {
  try {
    const parsed: unknown = JSON.parse(claim.steps || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 終わった工程を 1 件足す。所有者が変わっていたら足さず false を返す。
 * (横取りされた試行は副作用を重ねない)
 */
export async function appendFormSubmitClaimStep(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  step: string,
): Promise<boolean> {
  const claim = await getFormSubmitClaim(db, scope);
  if (!claim || claim.owner !== owner) return false;
  const steps = readFormSubmitClaimSteps(claim);
  if (!steps.includes(step)) steps.push(step);
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET steps = ?, updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ?`,
    )
    .bind(JSON.stringify(steps), jstNow(), ...claimBindings(scope), owner)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Webhook の結果を残し、工程にも記録する。 */
export async function saveFormSubmitClaimWebhook(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  webhook: unknown,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET webhook = ?, updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ?`,
    )
    .bind(JSON.stringify(webhook), jstNow(), ...claimBindings(scope), owner)
    .run();
  if ((result.meta.changes ?? 0) === 0) return false;
  return appendFormSubmitClaimStep(db, scope, owner, 'webhook');
}

/** 予約を完了にする。保存済みの回答を返すようになる。 */
export async function completeFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET status = 'completed', updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ?`,
    )
    .bind(jstNow(), ...claimBindings(scope), owner)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 予約を失敗に残す。回答は消さず、同じキーでの再送が未完の工程を補完する。
 * (第一引数が不要でも、所有者以外の試行が状態を変えないよう owner を見る)
 */
export async function failFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET status = 'failed', updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ?`,
    )
    .bind(jstNow(), ...claimBindings(scope), owner)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** 前回の回答。オプションの「前回の回答を復元する」で使う。 */
export async function getLatestFormSubmission(
  db: D1Database,
  formId: string,
  friendId: string,
): Promise<FormSubmission | null> {
  return db
    .prepare(
      `SELECT * FROM form_submissions
       WHERE form_id = ? AND friend_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(formId, friendId)
    .first<FormSubmission>();
}

/**
 * 選択肢ごとの、これまでの選ばれた数。定員の判定に使う。
 *
 * 回答は JSON なので SQL では数えられない。ここで読んで数える。
 * 定員は「先着の枠取り」に使うもので、何万件も溜まった頃には枠は
 * とっくに埋まっている。読む件数に上限を置いて、重くならないようにする。
 */
export async function countChoiceUsage(
  db: D1Database,
  formId: string,
  blockName: string,
  limit = 5000,
): Promise<Map<string, number>> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 20000));
  const result = await db
    .prepare(
      `SELECT data FROM form_submissions
       WHERE form_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(formId, safeLimit)
    .all<{ data: string }>();

  const counts = new Map<string, number>();
  for (const row of result.results) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.data || '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    const value = parsed[blockName];
    const labels = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}
