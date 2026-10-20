import { jstNow } from '../utils.js';
import { type RichMenuDuplicateRequest, type DuplicateRichMenuGroupOutcome } from './types.js';
import { getRichMenuGroupWithPages, buildRichMenuAliasId, buildAreaInsert } from './reads.js';


export async function getRichMenuDuplicateByKey(
  db: D1Database,
  accountId: string,
  idempotencyKey: string,
): Promise<RichMenuDuplicateRequest | null> {
  return (await db
    .prepare(
      `SELECT * FROM rich_menu_duplicate_requests
        WHERE account_id = ? AND idempotency_key = ?`,
    )
    .bind(accountId, idempotencyKey)
    .first<RichMenuDuplicateRequest>()) ?? null;
}

/**
 * 複製を「台帳への記録」と「内容のコピー」を1つの batch で確定する。
 * 途中で止まっても半分だけ残る形は無い。
 *
 * コピーする: 名前（指定または「○○ のコピー」）、トークバー文言、サイズ、
 *   フォルダ、出し分け条件・優先度・有効フラグ、全ページ（名前・順番・画像参照）、
 *   全ボタン（領域・intent・ラベル・タグ・スコア・参照先）。ページ内の
 *   切替ボタンの行き先は新しいページIDへ張り替える。
 * コピーしない: 公開状態（常に draft）、全員既定フラグ、公開lease、
 *   LINE richMenu ID、公開・予約・複製の各台帳。
 */
export async function duplicateRichMenuGroupAtomic(
  db: D1Database,
  input: {
    requestId: string;
    accountId: string;
    sourceGroupId: string;
    idempotencyKey: string;
    /** 省略時は「<元の名前> のコピー」。 */
    name?: string;
    now?: string;
  },
): Promise<DuplicateRichMenuGroupOutcome> {
  const existing = await getRichMenuDuplicateByKey(db, input.accountId, input.idempotencyKey);
  if (existing) {
    return existing.source_group_id === input.sourceGroupId
      ? { outcome: 'existing', groupId: existing.created_group_id }
      : { outcome: 'conflict' };
  }

  const source = await getRichMenuGroupWithPages(db, input.sourceGroupId);
  if (!source || source.account_id !== input.accountId) {
    throw new Error('source group not found');
  }

  const now = input.now ?? jstNow();
  const newGroupId = crypto.randomUUID();
  const name = input.name?.trim() || `${source.name} のコピー`;

  // 旧ページID → 新ページID。ページ内の切替ボタンの行き先だけを張り替える。
  const pageIdMap = new Map<string, string>();
  const newPages = source.pages.map((page) => {
    const newId = crypto.randomUUID();
    pageIdMap.set(page.id, newId);
    return { source: page, newId };
  });
  const newDefaultPageId = source.default_page_id && pageIdMap.has(source.default_page_id)
    ? pageIdMap.get(source.default_page_id)!
    : (newPages.find((p) => p.source.order_index === 0)?.newId ?? newPages[0]?.newId ?? null);

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db
      .prepare(
        `INSERT INTO rich_menu_groups
           (id, account_id, name, chat_bar_text, size, default_page_id,
            is_default_for_all, status, targeting_condition, targeting_priority,
            targeting_enabled, folder_id, display_order, default_open,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newGroupId,
        input.accountId,
        name,
        source.chat_bar_text,
        source.size,
        newDefaultPageId,
        source.targeting_condition,
        source.targeting_priority,
        source.targeting_enabled,
        source.folder_id,
        source.display_order,
        source.default_open,
        now,
        now,
      ),
  );
  for (const { source: page, newId } of newPages) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO rich_menu_pages
             (id, group_id, order_index, name, alias_id,
              image_r2_key, image_content_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId,
          newGroupId,
          page.order_index,
          page.name,
          buildRichMenuAliasId(newGroupId, page.order_index),
          // 画像は同じ保管物を参照する。複製側を消しても原本の画像を消さない
          // 設計なので、キーの共有でよい。
          page.image_r2_key,
          page.image_content_type,
          now,
          now,
        ),
    );
    for (const area of page.areas) {
      const actionData = { ...(area.actionData ?? {}) } as Record<string, unknown>;
      if (
        area.action_type === 'richmenuswitch'
        && typeof actionData.targetPageId === 'string'
        && pageIdMap.has(actionData.targetPageId)
      ) {
        actionData.targetPageId = pageIdMap.get(actionData.targetPageId)!;
      }
      stmts.push(
        buildAreaInsert(
          db,
          crypto.randomUUID(),
          newId,
          {
            boundsX: area.bounds_x,
            boundsY: area.bounds_y,
            boundsWidth: area.bounds_width,
            boundsHeight: area.bounds_height,
            actionType: area.action_type,
            actionData,
            intent: area.intent,
            label: area.label,
            tagIds: area.tagIds,
            scoreChange: area.score_change,
            templateId: area.template_id,
            formId: area.form_id,
            trackedLinkId: area.tracked_link_id,
          },
          now,
        ),
      );
    }
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO rich_menu_duplicate_requests
           (id, account_id, source_group_id, created_group_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.requestId, input.accountId, input.sourceGroupId, newGroupId, input.idempotencyKey, now),
  );

  try {
    await db.batch(stmts);
  } catch (error) {
    // 同時に来た同じ鍵の片方だけが通る。負けた側は台帳を読み直して
    // 既存の作成物を返す（別groupへの鍵違いなら conflict）。
    const raced = await getRichMenuDuplicateByKey(db, input.accountId, input.idempotencyKey);
    if (raced) {
      return raced.source_group_id === input.sourceGroupId
        ? { outcome: 'existing', groupId: raced.created_group_id }
        : { outcome: 'conflict' };
    }
    throw error;
  }
  return { outcome: 'created', groupId: newGroupId };
}
