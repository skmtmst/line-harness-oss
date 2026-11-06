import { jstNow } from '../utils.js';
import { type RichMenuAreaTapTarget, type RichMenuAreaIntent } from './types.js';
import { parseRichMenuTagIds } from './area-writes.js';



export async function getRichMenuAreaTapTarget(
  db: D1Database,
  areaId: string,
): Promise<RichMenuAreaTapTarget | null> {
  const row = await db
    .prepare(
      `SELECT a.id            AS area_id,
              a.page_id       AS page_id,
              a.intent        AS intent,
              a.label         AS label,
              a.tag_ids       AS tag_ids,
              a.score_change  AS score_change,
              a.template_id   AS template_id,
              a.form_id       AS form_id,
              a.action_data   AS action_data,
              p.group_id      AS group_id,
              g.account_id    AS account_id
         FROM rich_menu_areas a
         JOIN rich_menu_pages p  ON p.id = a.page_id
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE a.id = ?`,
    )
    .bind(areaId)
    .first<{
      area_id: string;
      page_id: string;
      intent: RichMenuAreaIntent | null;
      label: string | null;
      tag_ids: string | null;
      score_change: number | null;
      template_id: string | null;
      form_id: string | null;
      action_data: string;
      group_id: string;
      account_id: string;
    }>();
  if (!row) return null;
  let scenarioId: string | null = null;
  try {
    const data = JSON.parse(row.action_data) as Record<string, unknown>;
    if (typeof data.scenarioId === 'string' && data.scenarioId) scenarioId = data.scenarioId;
  } catch { /* Invalid legacy action data has no executable scenario. */ }
  return {
    areaId: row.area_id,
    pageId: row.page_id,
    groupId: row.group_id,
    accountId: row.account_id,
    intent: row.intent,
    label: row.label,
    tagIds: parseRichMenuTagIds(row.tag_ids),
    scoreChange: row.score_change,
    templateId: row.template_id,
    formId: row.form_id,
    scenarioId,
  };
}

// =============================================================================
// 押された回数（148）
// =============================================================================

export async function recordRichMenuAreaTap(
  db: D1Database,
  input: {
    areaId: string;
    pageId: string;
    groupId: string;
    areaLabel?: string | null;
    friendId?: string | null;
    lineAccountId?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rich_menu_area_taps
         (id, area_id, page_id, group_id, area_label, friend_id, line_account_id, tapped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.areaId,
      input.pageId,
      input.groupId,
      input.areaLabel ?? null,
      input.friendId ?? null,
      input.lineAccountId ?? null,
      jstNow(),
    )
    .run();
}
