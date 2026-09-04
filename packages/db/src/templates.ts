import { jstNow } from './utils.js';
// テンプレート管理クエリヘルパー

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  message_type: string;
  message_content: string;
  /** テンプレートの置き場（099 で追加）。未分類は null。 */
  folder_id: string | null;
  /** 162: カルーセルの選択肢を押したときの動き。{ パネル番号: { 選択肢番号: [...] } } */
  carousel_actions_json: string | null;
  /** 162: 選択肢の押せる回数。'none'（制限なし）／'once'（全体で1回） */
  carousel_tap_limit_mode: string;
  /** 162: 制限を超えたときに返すテキスト。空なら何も返さない。 */
  carousel_tap_limit_text: string | null;
  /** 質問テンプレート。scenario_steps.question_json と同じ形。 */
  question_json: string | null;
  question_status: 'draft' | 'published';
  created_at: string;
  updated_at: string;
  line_account_id: string | null;
}

export async function getTemplates(db: D1Database, category?: string): Promise<TemplateRow[]> {
  if (category) {
    const result = await db.prepare(`SELECT * FROM templates WHERE category = ? ORDER BY created_at DESC`)
      .bind(category).all<TemplateRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM templates ORDER BY created_at DESC`).all<TemplateRow>();
  return result.results;
}

export async function getTemplateById(db: D1Database, id: string): Promise<TemplateRow | null> {
  return db.prepare(`SELECT * FROM templates WHERE id = ?`).bind(id).first<TemplateRow>();
}

export interface CarouselOptions {
  /** 162: 選択肢を押したときの動き。{ パネル番号: { 選択肢番号: [...] } } */
  carouselActions?: unknown | null;
  /** 162: 'none'（制限なし）／'once'（カルーセル全体で1回） */
  carouselTapLimitMode?: 'none' | 'once';
  /** 162: 制限を超えたときに返すテキスト。 */
  carouselTapLimitText?: string | null;
}

export interface QuestionOptions {
  /** JSON文字列。null は通常テンプレート。 */
  questionJson?: string | null;
  questionStatus?: 'draft' | 'published';
}

export async function createTemplate(
  db: D1Database,
  input: {
    name: string;
    category?: string;
    messageType: string;
    messageContent: string;
    lineAccountId?: string | null;
    /** 置き場。省略・null は「未分類」。 */
    folderId?: string | null;
  } & CarouselOptions & QuestionOptions,
): Promise<TemplateRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO templates
         (id, name, category, message_type, message_content,
          carousel_actions_json, carousel_tap_limit_mode, carousel_tap_limit_text,
          question_json, question_status, created_at, updated_at, line_account_id,
          folder_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.category ?? 'general',
      input.messageType,
      input.messageContent,
      input.carouselActions ? JSON.stringify(input.carouselActions) : null,
      input.carouselTapLimitMode ?? 'none',
      input.carouselTapLimitText ?? null,
      input.questionJson ?? null,
      input.questionStatus ?? 'published',
      now,
      now,
      input.lineAccountId ?? null,
      input.folderId ?? null,
    )
    .run();
  return (await getTemplateById(db, id))!;
}

export async function updateTemplate(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string;
    category: string;
    messageType: string;
    messageContent: string;
    /** 置き場。`null` を渡すと未分類へ戻す。 */
    folderId: string | null;
  }> &
    CarouselOptions & QuestionOptions,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.messageType !== undefined) { sets.push('message_type = ?'); values.push(updates.messageType); }
  if (updates.messageContent !== undefined) { sets.push('message_content = ?'); values.push(updates.messageContent); }
  if (updates.carouselActions !== undefined) {
    sets.push('carousel_actions_json = ?');
    values.push(updates.carouselActions ? JSON.stringify(updates.carouselActions) : null);
  }
  if (updates.carouselTapLimitMode !== undefined) {
    sets.push('carousel_tap_limit_mode = ?');
    values.push(updates.carouselTapLimitMode);
  }
  if (updates.carouselTapLimitText !== undefined) {
    sets.push('carousel_tap_limit_text = ?');
    values.push(updates.carouselTapLimitText);
  }
  if (updates.questionJson !== undefined) {
    sets.push('question_json = ?');
    values.push(updates.questionJson);
  }
  if (updates.questionStatus !== undefined) {
    sets.push('question_status = ?');
    values.push(updates.questionStatus);
  }
  /*
    置き場。**`null` は「値が来なかった」ではなく「未分類へ戻す」。**
    だから `undefined` と `null` を分けて見る。
  */
  if (updates.folderId !== undefined) {
    sets.push('folder_id = ?');
    values.push(updates.folderId);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteTemplate(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM templates WHERE id = ?`).bind(id).run();
}

export interface TemplateUsage {
  autoReplies: Array<{
    id: string;
    keyword: string;
    matchType: 'exact' | 'contains';
    lineAccountId: string | null;
  }>;
  automations: Array<{
    id: string;
    name: string;
    eventType: string;
  }>;
  scenarioSteps: Array<{
    scenarioId: string;
    scenarioName: string;
    stepId: string;
    stepOrder: number;
  }>;
  reminderSteps: Array<{
    reminderId: string;
    reminderName: string;
    stepId: string;
  }>;
  richMenuAreas: Array<{
    groupId: string;
    groupName: string;
    pageName: string;
    areaId: string;
    label: string | null;
  }>;
  trackedLinks: Array<{
    id: string;
    name: string;
  }>;
}

/**
 * Template の参照箇所を返す。
 * 現行の templates.id を参照する運用中の設定をすべて返す。
 * messages_log.template_id_at_send は送信済み履歴なので、削除を止める参照には含めない。
 *   automations は数十件規模なので LIKE で十分高速。
 */
export async function getTemplateUsage(db: D1Database, templateId: string): Promise<TemplateUsage> {
  const arRes = await db
    .prepare(
      `SELECT id, keyword, match_type, line_account_id
       FROM auto_replies WHERE template_id = ? ORDER BY created_at DESC`,
    )
    .bind(templateId)
    .all<{ id: string; keyword: string; match_type: 'exact' | 'contains'; line_account_id: string | null }>();

  // automations の actions JSON を全件取って JS 側で template_id をマッチさせる。
  // SQL LIKE で "%\"template_id\":\"<id>\"%" を投げると D1 SQLite の
  // "pattern too complex" 上限に当たるので JS 処理にしている。
  const autRes = await db
    .prepare(`SELECT id, name, event_type, actions FROM automations ORDER BY created_at DESC`)
    .all<{ id: string; name: string; event_type: string; actions: string }>();
  const matchedAutomations: Array<{ id: string; name: string; event_type: string }> = [];
  for (const r of autRes.results ?? []) {
    try {
      const actions = JSON.parse(r.actions) as Array<{ params?: { template_id?: string } }>;
      if (actions.some((a) => a.params?.template_id === templateId)) {
        matchedAutomations.push({ id: r.id, name: r.name, event_type: r.event_type });
      }
    } catch {
      // ignore malformed
    }
  }

  const scenarioRes = await db
    .prepare(
      `SELECT ss.id AS step_id, ss.step_order, ss.scenario_id, s.name AS scenario_name
       FROM scenario_steps ss
       JOIN scenarios s ON s.id = ss.scenario_id
       WHERE ss.template_id = ?
       ORDER BY s.name, ss.step_order`,
    )
    .bind(templateId)
    .all<{ step_id: string; step_order: number; scenario_id: string; scenario_name: string }>();

  const reminderRes = await db
    .prepare(
      `SELECT rs.id AS step_id, r.id AS reminder_id, r.name AS reminder_name
       FROM reminder_steps rs
       JOIN reminders r ON r.id = rs.reminder_id
       WHERE rs.template_id = ?
       ORDER BY r.name, rs.offset_minutes`,
    )
    .bind(templateId)
    .all<{ step_id: string; reminder_id: string; reminder_name: string }>();

  const richMenuRes = await db
    .prepare(
      `SELECT a.id AS area_id, a.label, p.name AS page_name,
              g.id AS group_id, g.name AS group_name
       FROM rich_menu_areas a
       JOIN rich_menu_pages p ON p.id = a.page_id
       JOIN rich_menu_groups g ON g.id = p.group_id
       WHERE a.template_id = ?
       ORDER BY g.name, p.order_index, a.id`,
    )
    .bind(templateId)
    .all<{
      area_id: string;
      label: string | null;
      page_name: string;
      group_id: string;
      group_name: string;
    }>();

  const trackedLinkRes = await db
    .prepare(`SELECT id, name FROM tracked_links WHERE template_id = ? ORDER BY name`)
    .bind(templateId)
    .all<{ id: string; name: string }>();

  return {
    autoReplies: (arRes.results ?? []).map((r) => ({
      id: r.id,
      keyword: r.keyword,
      matchType: r.match_type,
      lineAccountId: r.line_account_id,
    })),
    automations: matchedAutomations.map((r) => ({
      id: r.id,
      name: r.name,
      eventType: r.event_type,
    })),
    scenarioSteps: (scenarioRes.results ?? []).map((r) => ({
      scenarioId: r.scenario_id,
      scenarioName: r.scenario_name,
      stepId: r.step_id,
      stepOrder: r.step_order,
    })),
    reminderSteps: (reminderRes.results ?? []).map((r) => ({
      reminderId: r.reminder_id,
      reminderName: r.reminder_name,
      stepId: r.step_id,
    })),
    richMenuAreas: (richMenuRes.results ?? []).map((r) => ({
      groupId: r.group_id,
      groupName: r.group_name,
      pageName: r.page_name,
      areaId: r.area_id,
      label: r.label,
    })),
    trackedLinks: (trackedLinkRes.results ?? []).map((r) => ({ id: r.id, name: r.name })),
  };
}

export interface TemplateRowWithUsage extends TemplateRow {
  usage_count: number;
}

export interface TemplateListScope {
  accountIds: string[];
  includeUnassigned: boolean;
}

/**
 * 一覧画面用に template + 使用数を返す。
 * - auto_replies は indexed lookup (1 SQL)
 * - automations は actions JSON 全件取って JS で template_id を抽出 (LIKE が
 *   D1 SQLite の "pattern too complex" 上限に当たるので避ける)
 */
export async function getTemplatesWithUsageCount(
  db: D1Database,
  category?: string,
  scope?: TemplateListScope,
): Promise<TemplateRowWithUsage[]> {
  // 1. templates 本体
  const filters: string[] = [];
  const values: unknown[] = [];
  if (category) {
    filters.push('category = ?');
    values.push(category);
  }
  if (scope) {
    if (scope.accountIds.length > 0) {
      filters.push(
        `(line_account_id IN (${scope.accountIds.map(() => '?').join(',')})${scope.includeUnassigned ? ' OR line_account_id IS NULL' : ''})`,
      );
      values.push(...scope.accountIds);
    } else {
      filters.push(scope.includeUnassigned ? 'line_account_id IS NULL' : '1 = 0');
    }
  }
  const tplSql = `SELECT * FROM templates${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY created_at DESC`;
  const tplStmt = values.length > 0 ? db.prepare(tplSql).bind(...values) : db.prepare(tplSql);
  const templates = await tplStmt.all<TemplateRow>();

  // 2. 列で参照している設定は1回の問い合わせでまとめて数える。
  const relationalRes = await db.prepare(
    `SELECT template_id, SUM(cnt) AS cnt
     FROM (
       SELECT template_id, COUNT(*) AS cnt FROM auto_replies WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM scenario_steps WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM reminder_steps WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM rich_menu_areas WHERE template_id IS NOT NULL GROUP BY template_id
       UNION ALL
       SELECT template_id, COUNT(*) AS cnt FROM tracked_links WHERE template_id IS NOT NULL GROUP BY template_id
     ) references_by_kind
     GROUP BY template_id`,
  ).all<{ template_id: string; cnt: number }>();
  const relationalCount = new Map<string, number>();
  for (const r of relationalRes.results ?? []) relationalCount.set(r.template_id, r.cnt);

  // 3. automations の actions JSON を取って template_id を抽出
  const autRes = await db
    .prepare(`SELECT actions FROM automations`)
    .all<{ actions: string }>();
  const automationCount = new Map<string, number>();
  for (const r of autRes.results ?? []) {
    try {
      const actions = JSON.parse(r.actions) as Array<{ params?: { template_id?: string } }>;
      for (const a of actions) {
        const tid = a.params?.template_id;
        if (tid) automationCount.set(tid, (automationCount.get(tid) ?? 0) + 1);
      }
    } catch {
      // ignore malformed JSON rows
    }
  }

  return (templates.results ?? []).map((t) => ({
    ...t,
    usage_count: (relationalCount.get(t.id) ?? 0) + (automationCount.get(t.id) ?? 0),
  }));
}
