import { collectInputs, type FormAvailability, type FormLayout, type FormInputBlock, type FormChoice } from '@line-crm/shared';
import { countFormSubmissionsByFriend } from '@line-crm/db';
import { parseJstDateTime } from './form-layout-effects.js';

/** 保存済み回答と確保中の枠を同じ回答IDで数える（試し回答は除く）。 */
async function choiceUsage(db: D1Database, formId: string, block: FormInputBlock, choice: FormChoice): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT s.id AS id FROM form_submissions s, json_each(CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END) field,
      json_each(CASE WHEN field.type = 'array' THEN field.value ELSE json_array(field.value) END) answer
    WHERE s.form_id = ? AND s.is_test = 0 AND field.key = ? AND (answer.value = ? OR
      (? = 1 AND answer.type = 'text' AND answer.value <> ''
       AND answer.value NOT IN (SELECT value FROM json_each(?))))
    UNION SELECT submission_id AS id FROM form_capacity_claims WHERE form_id = ? AND slot_key = ?
  )`).bind(formId, block.name, choice.label, choice.isOther ? 1 : 0, JSON.stringify((block.choices ?? []).map(c => c.label)), formId, `choice:${block.name}:${choice.label}`).first<{ n: number }>();
  return Number(row?.n ?? 0);
}
export async function formAvailability(input: {
  db: D1Database; formId: string; layout: FormLayout; active: boolean;
  submitCount: number; friendId: string | null; isTest?: boolean; now?: Date;
}): Promise<FormAvailability> {
  const { db, formId, layout, friendId } = input;
  const options = layout.options ?? {};
  const deadline = options.deadline?.enabled && options.deadline.endsAt ? parseJstDateTime(options.deadline.endsAt) : null;
  const result: FormAvailability = {
    accepting: true, reason: null, deadlineAt: deadline?.toISOString() ?? null,
    oncePerFriend: !input.isTest && !!options.oncePerFriend?.enabled,
    totalRemaining: null, choices: {},
  };
  if (!input.isTest && options.totalLimit?.enabled && typeof options.totalLimit.max === 'number') {
    const claimed = await db.prepare(`SELECT COUNT(*) AS n FROM (
      SELECT id FROM form_submissions WHERE form_id = ? AND is_test = 0
      UNION SELECT submission_id AS id FROM form_capacity_claims WHERE form_id = ? AND slot_key = ?
    )`).bind(formId, formId, '__total__').first<{ n: number }>();
    result.totalRemaining = Math.max(0, options.totalLimit.max - Math.max(input.submitCount, Number(claimed?.n ?? 0)));
  }
  if (!input.isTest) {
    for (const block of collectInputs(layout)) {
      for (const choice of block.choices ?? []) {
        if (!choice.capacity?.enabled || typeof choice.capacity.limit !== 'number') continue;
        const remaining = Math.max(0, choice.capacity.limit - await choiceUsage(db, formId, block, choice));
        result.choices[block.name] ??= {};
        result.choices[block.name][choice.id] = { remaining, full: remaining === 0 };
      }
    }
  }
  if (!input.active && !input.isTest) result.reason = 'このフォームは、いま回答を受け付けていません。';
  else if (deadline && (input.now ?? new Date()).getTime() > deadline.getTime()) result.reason = options.deadline?.message || 'このフォームの回答期限は終了しました';
  else if (result.totalRemaining === 0) result.reason = options.totalLimit?.message || 'このフォームは受付を終了しました';
  else if (result.oncePerFriend) {
    if (!friendId) result.reason = 'LINEで開いて、回答済みか確認してください';
    else if (await countFormSubmissionsByFriend(db, formId, friendId) > 0) result.reason = options.oncePerFriend?.message || 'このフォームは、お一人さま1回までです';
  }
  result.accepting = result.reason === null;
  return result;
}
