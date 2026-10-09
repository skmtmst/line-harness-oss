import { tapExtrasError, type TapExtras } from './tap-extras.js';
import { emptyLayout, type FormAction, type FormInputBlock, type FormLayout } from './form-layout.js';

export interface ResearchAnswerAction {
  actionType: 'tag' | 'friend_field' | 'support_mark' | 'scenario' | 'common_var' | 'send_message' | 'send_template' | 'reminder' | 'event_booking' | 'notify_staff';
  config: Record<string, unknown>;
  onFailure: 'stop' | 'continue';
}
export interface ResearchGate {
  assetId: string;
  version: number;
  startsAt: string | null;
  endsAt: string | null;
  targetTagId: string | null;
}

/** 公開したリサーチを、既存の回答フォームの入力と後処理へ写す。 */
export function researchFormLayout(assetId: string, version: number, name: string, payload: Record<string, unknown>): FormLayout {
  const questions = payload.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 10) throw new Error('質問は1〜10問で設定してください');
  const layout = emptyLayout();
  layout.options.pageTitle = name;
  layout.options.thanksText = 'ご回答ありがとうございました';
  layout.options.researchGate = {
    assetId, version,
    startsAt: typeof payload.startsAt === 'string' && payload.startsAt ? researchDate(payload.startsAt) : null,
    endsAt: typeof payload.endsAt === 'string' && payload.endsAt ? researchDate(payload.endsAt) : null,
    targetTagId: typeof payload.targetTagId === 'string' && payload.targetTagId ? payload.targetTagId : null,
  };
  if (layout.options.researchGate.startsAt && layout.options.researchGate.endsAt && Date.parse(layout.options.researchGate.startsAt) >= Date.parse(layout.options.researchGate.endsAt)) throw new Error('受付の終了は開始より後に設定してください');
  if (layout.options.researchGate.endsAt) layout.options.deadline = { enabled: true, endsAt: layout.options.researchGate.endsAt };
  layout.sections[0].blocks = questions.map((raw, index): FormInputBlock => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('質問の内容を確認してください');
    const q = raw as Record<string, unknown>;
    const format = q.format;
    if (typeof q.text !== 'string' || !q.text.trim() || !['single','multiple','free'].includes(String(format)) || typeof q.required !== 'boolean') throw new Error('質問文・答え方・必須の指定を確認してください');
    const choices = format === 'free' ? undefined : q.choices;
    if (format !== 'free' && (!Array.isArray(choices) || choices.length < 1 || choices.length > 13 || choices.some(c => typeof c !== 'string' || !c.trim()))) throw new Error('選択肢は1〜13件で設定してください');
    if (q.choiceTapExtras !== undefined && (!Array.isArray(q.choiceTapExtras) || q.choiceTapExtras.length !== (Array.isArray(choices) ? choices.length : 0) || q.choiceTapExtras.some(extra => tapExtrasError(extra)))) throw new Error('選択肢の追加処理を確認してください');
    const extras = q.choiceTapExtras as TapExtras[] | undefined;
    return { id: `question-${index + 1}`, kind: 'input', name: `question_${index + 1}`, label: q.text,
      type: format === 'single' ? 'radio' : format === 'multiple' ? 'checkbox' : 'textarea', required: q.required,
      ...(Array.isArray(choices) ? { choices: choices.map((label, i) => ({ id: `choice-${i + 1}`, label: String(label), ...(extras?.[i] ? { tapExtras: extras[i] } : {}) })) } : {}) };
  });
  if (payload.answerActions !== undefined && !Array.isArray(payload.answerActions)) throw new Error('回答後に行うことを確認してください');
  layout.options.afterActions = (payload.answerActions as unknown[] ?? []).map((raw): FormAction => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('回答後に行うことを確認してください');
    const action = raw as Record<string, unknown>;
    if (!['tag','friend_field','support_mark','scenario','common_var','send_message','send_template','reminder','event_booking','notify_staff'].includes(String(action.actionType)) || !action.config || typeof action.config !== 'object' || Array.isArray(action.config) || (action.onFailure !== undefined && !['stop','continue'].includes(String(action.onFailure)))) throw new Error('回答後に行うことを確認してください');
    if (action.actionType === 'event_booking') {
      const c=action.config as Record<string,unknown>;
      if(typeof c.eventId!=='string' || !c.eventId || (c.op!==undefined && c.op!=='register' && c.op!=='cancel') || (c.slotId!=null && (typeof c.slotId!=='string' || !c.slotId))) throw new Error('イベントに行うことの設定を確認してください');
    }
    return { kind: 'research_action', actionType: action.actionType as ResearchAnswerAction['actionType'], config: action.config as Record<string, unknown>, onFailure: action.onFailure === 'stop' ? 'stop' : 'continue' };
  });
  return layout;
}

function researchDate(value: string): string {
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}${value.length === 10 ? 'T00:00:00' : ''}+09:00`;
  if (!Number.isFinite(Date.parse(withZone))) throw new Error('回答できる期間を確認してください');
  return withZone;
}
