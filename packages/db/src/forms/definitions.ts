import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { jstNow } from '../utils.js';
import { type FormDeleteImpact, type FormImpactRow, type FormImpactReferenceRow, type FormDeleteReference, type Form, type CreateFormInput, type FormLatestEdit, type UpdateFormInput, type UpdateFormResult } from './types.js';
import { getFormById, attachFormAccounts } from './reads.js';
import { publishFormVersion } from './versions.js';


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
      `SELECT f.id, f.name, f.is_active, f.status, f.revision, f.content_revision,
              f.current_published_version_id
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
  if (row.current_published_version_id) blockers.push('published');
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
    contentRevision: row.content_revision,
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

/**
 * 保管の取り消し（B 元に戻す）。保管中の行だけ現行へ戻す。
 * 戻した直後は受付停止のまま（is_active = 0）。戻した瞬間に回答を
 * 受け付けると、保管中に変わった利用先へ古い項目で送る恐れがあるため。
 * 公開は画面の公開操作で行う。
 */
export async function unarchiveFormAtRevision(
  db: D1Database,
  id: string,
  expectedRevision: number,
): Promise<Form | null> {
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE forms
        SET status = 'active', is_active = 0, archived_at = NULL, updated_at = ?, revision = revision + 1
      WHERE id = ? AND status = 'archived' AND revision = ?`,
  ).bind(now, id, expectedRevision).run();
  if ((result.meta?.changes ?? 0) !== 1) return null;
  return getFormById(db, id);
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
        AND current_published_version_id IS NULL
        AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM form_submissions WHERE form_id = forms.id)
        AND NOT EXISTS (SELECT 1 FROM form_opens WHERE form_id = forms.id)
        AND NOT EXISTS (SELECT 1 FROM webinar_ctas WHERE form_id = forms.id)
        AND NOT EXISTS (SELECT 1 FROM rich_menu_areas WHERE form_id = forms.id)`,
  ).bind(id, expectedRevision).run();
  // D1 counts cascaded rows too; the primary-key predicate limits the parent to one.
  return (result.meta?.changes ?? 0) > 0;
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
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
        input.ogTitle ?? null,
        input.ogDescription ?? null,
        input.ogImageUrl ?? null,
        now,
        now,
      )
      .run();

    await attachFormAccounts(db, id, input.lineAccountIds ?? []);
    if (input.isActive !== false) {
      const published = await publishFormVersion(db, id, 1);
      if (published.kind !== 'published') throw new Error('initial form version publish failed');
    }
  } catch (error) {
    // 所属だけ保存に失敗したフォームを残さない。管理画面から見えない孤立行になるため。
    await db.prepare(`DELETE FROM forms WHERE id = ?`).bind(id).run().catch(() => undefined);
    throw error;
  }

  return (await getFormById(db, id))!;
}
/** 同じ編集版の監査だけを使う。公開者や最新の別の版を保存者に代用しない。 */
export async function getFormLatestEdit(db:D1Database,id:string,contentRevision:number):Promise<FormLatestEdit|null> {
 const row=await db.prepare(`SELECT actor_principal_id staffId,json_extract(after_json,'$.staffName') staffName,created_at savedAt FROM audit_events WHERE source_kind='form_draft_save' AND source_id=? AND target_id=? AND action='form.draft_saved' AND result='success' AND json_extract(after_json,'$.contentRevision')=? LIMIT 1`).bind(JSON.stringify([id,contentRevision]),id,contentRevision).first<FormLatestEdit>();
 return row??null;
}
export async function updateForm(
  db: D1Database,
  id: string,
  input: UpdateFormInput,
  expectedContentRevision: number,
  actorId?:string,
): Promise<UpdateFormResult> {
  const existing = await getFormById(db, id);
  if (!existing) return { kind: 'not_found' };

  const now = jstNow();

  const update = db
    .prepare(
      `UPDATE forms
       SET folder_id = CASE WHEN ? THEN ? ELSE folder_id END,
           name = ?,
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
           revision = revision + 1,
           content_revision = content_revision + 1
       WHERE id = ? AND content_revision = ?`,
    )
    .bind(
      'folderId' in input ? 1 : 0,
      input.folderId ?? null,
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
      'isActive' in input
        ? (input.isActive && existing.current_published_version_id ? 1 : 0)
        : existing.is_active,
      'ogTitle' in input ? (input.ogTitle ?? null) : existing.og_title,
      'ogDescription' in input ? (input.ogDescription ?? null) : existing.og_description,
      'ogImageUrl' in input ? (input.ogImageUrl ?? null) : existing.og_image_url,
      now,
      id,
      expectedContentRevision,
    );

  const result=actorId?(await db.batch([update,db.prepare(`INSERT INTO audit_events(id,source_kind,source_id,tenant_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json,created_at)
    SELECT ?,'form_draft_save',?,COALESCE(s.tenant_id,'${DEFAULT_TENANT_ID}'),'business',s.id,s.role,'form.draft_saved','form',?,'success',json_object('contentRevision',?,'staffName',s.name),? FROM staff_members s WHERE s.id=? AND s.is_active=1 AND changes()=1`)
    .bind(crypto.randomUUID(),JSON.stringify([id,expectedContentRevision+1]),id,expectedContentRevision+1,now,actorId)]))[0]:await update.run();

  if ((result.meta?.changes ?? 0) !== 1) {
    const latest = await getFormById(db, id);
    // 版が合わなかったのか、そのあいだに消えたのかを分ける。
    return latest ? { kind: 'conflict', form: latest } : { kind: 'not_found' };
  }

  const updated = await getFormById(db, id);
  return updated ? { kind: 'updated', form: updated } : { kind: 'not_found' };
}

/**
 * フォームのフォルダ所属だけを変える（R25）。
 *
 * 編集保存（`updateForm`）とは別の細い口。所属は版管理の対象外のため、
 * 編集の版（`content_revision`）の確認も加算もしない。版を動かすと、
 * 編集中の人の保存が 409 になったり、削除影響の確認（`revision`）が
 * 無効になったりする。`updated_at` だけは進める（一覧の「更新」順に反映）。
 *
 * 見つからなければ `false` を返す（確認と削除のあいだに消えたとき用）。
 */
export async function setFormFolder(
  db: D1Database,
  id: string,
  folderId: string | null,
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE forms SET folder_id = ?, updated_at = ? WHERE id = ?`)
    .bind(folderId, jstNow(), id)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}
