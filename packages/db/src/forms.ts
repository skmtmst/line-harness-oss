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
  created_at: string;
}

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
  options: { page?: number; limit?: number } = {},
): Promise<FormSubmissionPage> {
  const requestedPage = options.page;
  const page = Number.isSafeInteger(requestedPage) && (requestedPage ?? 0) >= 1
    ? requestedPage!
    : 1;
  const limit = boundedListLimit(options.limit, 20);
  const offset = (page - 1) * limit;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM form_submissions WHERE form_id = ?`)
    .bind(formId)
    .first<{ total: number }>();
  const result = await db
    .prepare(
      `SELECT fs.*, f.display_name as friend_name FROM form_submissions fs
       LEFT JOIN friends f ON f.id = fs.friend_id
       WHERE fs.form_id = ?
       ORDER BY fs.created_at DESC, fs.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(formId, limit, offset)
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

export async function createFormSubmission(
  db: D1Database,
  input: CreateFormSubmissionInput,
): Promise<FormSubmission> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.formId, input.friendId ?? null, input.data, now)
    .run();

  // Increment submit_count
  await db
    .prepare(`UPDATE forms SET submit_count = submit_count + 1, updated_at = ? WHERE id = ?`)
    .bind(now, input.formId)
    .run();

  return (await db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>())!;
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
