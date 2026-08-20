import { jstNow } from './utils.js';

export interface MessageTemplate {
  id: string;
  name: string;
  message_type: 'text' | 'flex';
  message_content: string;
  created_at: string;
  updated_at: string;
}

export async function listMessageTemplates(db: D1Database): Promise<MessageTemplate[]> {
  const result = await db
    .prepare('SELECT * FROM message_templates ORDER BY name ASC')
    .all<MessageTemplate>();
  return result.results;
}

export async function getMessageTemplateById(
  db: D1Database,
  id: string,
): Promise<MessageTemplate | null> {
  return db
    .prepare('SELECT * FROM message_templates WHERE id = ?')
    .bind(id)
    .first<MessageTemplate>();
}

export interface CreateMessageTemplateInput {
  name: string;
  messageType: 'text' | 'flex';
  messageContent: string;
}

export async function createMessageTemplate(
  db: D1Database,
  input: CreateMessageTemplateInput,
): Promise<MessageTemplate> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      'INSERT INTO message_templates (id, name, message_type, message_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(id, input.name, input.messageType, input.messageContent, now, now)
    .first<MessageTemplate>();
  return result!;
}

export interface UpdateMessageTemplateInput {
  name?: string;
  messageType?: 'text' | 'flex';
  messageContent?: string;
}

export async function updateMessageTemplate(
  db: D1Database,
  id: string,
  input: UpdateMessageTemplateInput,
): Promise<MessageTemplate | null> {
  const existing = await getMessageTemplateById(db, id);
  if (!existing) return null;

  const now = jstNow();
  const name = input.name ?? existing.name;
  const messageType = input.messageType ?? existing.message_type;
  const messageContent = input.messageContent ?? existing.message_content;

  const result = await db
    .prepare(
      'UPDATE message_templates SET name = ?, message_type = ?, message_content = ?, updated_at = ? WHERE id = ? RETURNING *',
    )
    .bind(name, messageType, messageContent, now, id)
    .first<MessageTemplate>();
  return result;
}

export async function deleteMessageTemplate(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM message_templates WHERE id = ?')
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

// =============================================================================
// カルーセルの選択肢（162）
// =============================================================================

export async function recordCarouselTap(
  db: D1Database,
  input: {
    templateId: string;
    columnIndex: number;
    actionIndex: number;
    actionLabel?: string | null;
    friendId?: string | null;
    lineAccountId?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO carousel_taps
         (id, template_id, column_index, action_index, action_label,
          friend_id, line_account_id, tapped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.templateId,
      input.columnIndex,
      input.actionIndex,
      input.actionLabel ?? null,
      input.friendId ?? null,
      input.lineAccountId ?? null,
      jstNow(),
    )
    .run();
}

/**
 * この人が、このカルーセルの選択肢を一度でも押したか。
 * 「カルーセル全体で1回のみ」の判定に使う。どの選択肢でも1回は1回と数える。
 */
export async function hasCarouselTap(
  db: D1Database,
  templateId: string,
  friendId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM carousel_taps
        WHERE template_id = ? AND friend_id = ? LIMIT 1`,
    )
    .bind(templateId, friendId)
    .first<{ hit: number }>();
  return row != null;
}

export interface CarouselTapCount {
  columnIndex: number;
  actionIndex: number;
  label: string | null;
  taps: number;
}

/** 選択肢ごとに押された回数。どのパネルが効いているかを見るため。 */
export async function getCarouselTapCounts(
  db: D1Database,
  templateId: string,
): Promise<CarouselTapCount[]> {
  const rows = await db
    .prepare(
      `SELECT column_index, action_index, MAX(action_label) AS label, COUNT(*) AS taps
         FROM carousel_taps
        WHERE template_id = ?
        GROUP BY column_index, action_index
        ORDER BY column_index, action_index`,
    )
    .bind(templateId)
    .all<{ column_index: number; action_index: number; label: string | null; taps: number }>();
  return (rows.results ?? []).map((r) => ({
    columnIndex: r.column_index,
    actionIndex: r.action_index,
    label: r.label,
    taps: r.taps,
  }));
}
