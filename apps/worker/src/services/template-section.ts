import { getTemplateSectionRows, type FolderItemCounts, type TemplateListScope, type TemplateSectionRow } from '@line-crm/db';
import { parseQuestion } from '../features/scenarios/scenario-question/index.js';

/** テンプレート一覧のタブのうち、テンプレートの表から出す3つ。 */
export const TEMPLATE_SECTIONS = ['message', 'question', 'rich_video'] as const;
export type TemplateSection = typeof TEMPLATE_SECTIONS[number];

export function isTemplateSection(value: string): value is TemplateSection {
  return (TEMPLATE_SECTIONS as readonly string[]).includes(value);
}

/**
 * 一覧の画面と同じ分け方。リッチビデオは公開版が imagemap で最新の本文に動画があるもの、
 * 質問は公開版の質問があるもの（両方に当たれば両方のタブに出る）、メッセージはどちらでもないもの。
 */
export function inTemplateSection(row: TemplateSectionRow, section: TemplateSection): boolean {
  const richVideo = isRichVideoRow(row), question = parseQuestion(row.question_json) !== null;
  return section === 'rich_video' ? richVideo : section === 'question' ? question : !richVideo && !question;
}

function isRichVideoRow(row: TemplateSectionRow): boolean {
  if (row.message_type !== 'imagemap') return false;
  try { return Boolean(JSON.parse(row.draft_message_content ?? row.message_content)?.video); } catch { return false; }
}

/** フォルダの数を、今のタブの種類だけで数える。 */
export async function getTemplateSectionFolderCounts(db: D1Database, section: TemplateSection, scope: TemplateListScope): Promise<FolderItemCounts> {
  const counts: FolderItemCounts = { byFolderId: {}, unfiled: 0 };
  for (const row of await getTemplateSectionRows(db, scope)) {
    if (!inTemplateSection(row, section)) continue;
    if (row.folder_id === null) counts.unfiled += 1;
    else counts.byFolderId[row.folder_id] = (counts.byFolderId[row.folder_id] ?? 0) + 1;
  }
  return counts;
}
