import { hasTemplateDraft,type TemplateRow } from '@line-crm/db';

import { parseQuestion } from '../features/scenarios/scenario-question/index.js';
/** 347: 公開版の固定情報。編集・保存では変わらない。 */
export function publishedInfoOf(t: TemplateRow) {
  return {
    messageType: t.message_type,
    messageContent: t.message_content,
    messageBubbles: t.message_bubbles_json ? JSON.parse(t.message_bubbles_json) : null,
    question: parseQuestion(t.question_json),
    questionStatus: t.question_status,
  };
}

export function versionInfoOf(t: TemplateRow) {
  return {
    hasDraft: hasTemplateDraft(t),
    publishedVersion: Number(t.published_version ?? 0),
    publishedAt: t.published_at ?? null,
    draftRevision: Number(t.draft_revision ?? 0),
    published: publishedInfoOf(t),
  };
}
