/**
 * 回答フォーム（レイアウト版）の、受け付け判定と送信後の処理。
 *
 * `routes/forms.ts` の送信処理はもともと長い。ここに切り出したのは
 * 次の2つで、どちらも layout を持つフォームだけに効く。
 *
 *   1. 受け付けてよいかの判定（回答期限・1人1回・総数・選択肢の定員）
 *   2. 回答を配る処理（登録先・選択肢ごとの動作・日付リマインダ・回答後の動作）
 *
 * 送信そのものを止めてよいのは 1 だけ。2 は失敗しても回答は保存済みに
 * するので、投げずに握って記録する。タグが1つ付かなかったせいで
 * 「送信できませんでした」と出すのは、利用者にとって嘘になる。
 */

import {
  collectInputs,
  hasChoices,
  validateAnswers,
  type FormAction,
  type FormChoice,
  type FormInputBlock,
  type FormLayout,
} from '@line-crm/shared';
import {
  countChoiceUsage,
  countFormSubmissionsByFriend,
  enrollFriendInReminder,
  enrollFriendInScenario,
  getFriendFieldById,
  getMessageTemplateById,
  jstNow,
  removeTagFromFriend,
  setFriendFieldValue,
} from '@line-crm/db';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';

/** 回答1件。キーは入力ブロックの name。 */
export type FormAnswers = Record<string, unknown>;

export interface FormGateInput {
  db: D1Database;
  formId: string;
  layout: FormLayout;
  friendId: string;
  /** forms.submit_count。総数制限の判定に使う */
  submitCount: number;
  answers: FormAnswers;
  /** 判定の基準時刻。テストから固定できるようにしてある */
  now?: Date;
}

/**
 * 受け付けてよいかを見る。断る理由があれば、利用者に見せる文言を返す。
 *
 * 並びは「安いものから」。日付の比較 → 数の比較 → DBを読む判定、の順に
 * 置いて、断るとわかっている回答でDBを余計に読まないようにしている。
 */
export async function checkFormGates(input: FormGateInput): Promise<string | null> {
  const { db, formId, layout, friendId, submitCount, answers } = input;
  const options = layout.options ?? {};
  const now = input.now ?? new Date();

  // 回答期限
  if (options.deadline?.enabled && options.deadline.endsAt) {
    const endsAt = parseJstDateTime(options.deadline.endsAt);
    if (endsAt && now.getTime() > endsAt.getTime()) {
      return options.deadline.message || 'このフォームの回答期限は終了しました';
    }
  }

  // 全体の受付上限
  if (options.totalLimit?.enabled && typeof options.totalLimit.max === 'number') {
    if (submitCount >= options.totalLimit.max) {
      return options.totalLimit.message || 'このフォームは受付を終了しました';
    }
  }

  // 入力そのものの検証（必須・入力制限・選択数）
  const invalid = validateAnswers(layout, answers);
  if (invalid) return invalid;

  // 1人1回
  if (options.oncePerFriend?.enabled) {
    const already = await countFormSubmissionsByFriend(db, formId, friendId);
    if (already > 0) {
      return options.oncePerFriend.message || 'このフォームは、お一人さま1回までです';
    }
  }

  // 選択肢の定員
  const full = await findFullChoice(db, formId, layout, answers);
  if (full) return `「${full}」は定員に達しました`;

  return null;
}

/**
 * 期限の文字列を、日本時間として読む。
 *
 * 管理画面の日時入力は `2026-08-31T23:59` の形で、時差を持たない。これを
 * そのまま `new Date()` に渡すと、動いている場所の時差で解釈される。
 * Workers は UTC で動くので、日本時間のつもりで入れた期限が9時間ずれて、
 * 締め切ったはずのフォームが翌朝まで開いたままになる。
 *
 * 時差が書いてある文字列（`Z` や `+09:00`）は、そのまま信じる。
 */
function parseJstDateTime(value: string): Date | null {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const normalized = hasZone ? value : `${value.length === 16 ? value : value.slice(0, 16)}:00+09:00`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 定員が埋まっている選択肢が選ばれていれば、そのラベルを返す。 */
async function findFullChoice(
  db: D1Database,
  formId: string,
  layout: FormLayout,
  answers: FormAnswers,
): Promise<string | null> {
  for (const block of collectInputs(layout)) {
    if (!hasChoices(block)) continue;
    const limited = (block.choices ?? []).filter(
      (c) => c.capacity?.enabled && typeof c.capacity.limit === 'number',
    );
    if (limited.length === 0) continue;

    const selected = toLabels(answers[block.name]);
    const target = limited.filter((c) => selected.includes(c.label));
    if (target.length === 0) continue;

    const usage = await countChoiceUsage(db, formId, block.name);
    for (const choice of target) {
      const used = usage.get(choice.label) ?? 0;
      if (used >= (choice.capacity?.limit ?? 0)) return choice.label;
    }
  }
  return null;
}

function toLabels(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** 回答を1つの文字列にする。情報欄も本名も、入るのは文字列1本なので。 */
function toText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

// ---------------------------------------------------------------------------
// 送信後の処理
// ---------------------------------------------------------------------------

/** メッセージを送る手段。route 側から渡す。テストでは差し替える。 */
export type PushText = (text: string) => Promise<void>;

export interface FormEffectInput {
  db: D1Database;
  layout: FormLayout;
  friendId: string;
  answers: FormAnswers;
  /** タグ付与に伴うシナリオの即時配信で使う */
  push?: { defaultAccessToken: string; workerUrl?: string };
  /** テキスト送信・テンプレート送信で使う。無ければその動作は飛ばす */
  pushText?: PushText;
}

/**
 * 回答を配る。
 *
 * 途中で失敗しても後ろを続ける。1つの動作の失敗が、他の動作を巻き込んで
 * 全部落とすのが一番困る（タグは付いたのにシナリオが動かない、が
 * 分からなくなる）。
 */
export async function applyFormLayoutEffects(input: FormEffectInput): Promise<void> {
  const { db, layout, friendId, answers } = input;

  for (const block of collectInputs(layout)) {
    const value = answers[block.name];
    if (value === undefined) continue;

    await runSafely('destinations', () => writeDestinations(db, block, value, friendId));

    if (hasChoices(block)) {
      await runSafely('choices', () => runChoiceEffects(input, block, value));
    }

    if (block.type === 'date' && block.reminder?.reminderId) {
      await runSafely('reminder', () =>
        enrollFriendInReminder(db, {
          friendId,
          reminderId: block.reminder!.reminderId,
          targetDate: toText(value),
        }).then(() => undefined),
      );
    }
  }

  for (const action of layout.options?.afterActions ?? []) {
    await runSafely('afterAction', () => runFormAction(input, action));
  }
}

async function runSafely(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(`form effect (${label}) failed:`, err);
  }
}

/**
 * 回答の登録先へ書く。
 *
 * ECが正の情報欄には書かない。フォームの回答で上書きしても、次のEC同期で
 * 戻り、入れたはずの値が消えたように見えるため。
 */
async function writeDestinations(
  db: D1Database,
  block: FormInputBlock,
  value: unknown,
  friendId: string,
): Promise<void> {
  const dest = block.destinations;
  if (!dest) return;
  const text = toText(value);

  for (const fieldId of dest.friendFieldIds ?? []) {
    const target = await getFriendFieldById(db, fieldId);
    if (!target || target.ec_is_master === 1) continue;
    await setFriendFieldValue(db, {
      friendId,
      fieldId,
      value: text === '' ? null : text,
      updatedBy: 'form',
    });
  }

  const columns: string[] = [];
  const values: string[] = [];
  if (dest.realName) {
    columns.push('real_name = ?');
    values.push(text);
  }
  if (dest.displayName) {
    columns.push('system_display_name = ?');
    values.push(text);
  }
  if (dest.note) {
    columns.push('private_memo = ?');
    values.push(text);
  }
  if (columns.length === 0 || text === '') return;

  await db
    .prepare(`UPDATE friends SET ${columns.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...values, jstNow(), friendId)
    .run();
}

/** 選ばれた選択肢の動作を実行する。 */
async function runChoiceEffects(
  input: FormEffectInput,
  block: FormInputBlock,
  value: unknown,
): Promise<void> {
  const selected = toLabels(value);
  if (selected.length === 0) return;

  const chosen = (block.choices ?? []).filter((c) => selected.includes(c.label));
  for (const choice of chosen) {
    switch (block.choiceMode) {
      case 'tag':
        await applyChoiceTag(input, choice);
        break;
      case 'friendField':
        await applyChoiceFriendField(input, block, choice);
        break;
      case 'action':
        for (const action of choice.actions ?? []) {
          await runSafely('choiceAction', () => runFormAction(input, action));
        }
        break;
      default:
        // 動作を決めていない選択肢は、回答として残すだけ
        break;
    }
  }
}

async function applyChoiceTag(input: FormEffectInput, choice: FormChoice): Promise<void> {
  if (!choice.tagId) return;
  await attachTagAndFireSideEffects(
    input.db,
    input.friendId,
    choice.tagId,
    input.push
      ? { defaultAccessToken: input.push.defaultAccessToken, workerUrl: input.push.workerUrl }
      : undefined,
  );
}

async function applyChoiceFriendField(
  input: FormEffectInput,
  block: FormInputBlock,
  choice: FormChoice,
): Promise<void> {
  const fieldId = block.choiceFriendFieldId;
  if (!fieldId) return;
  const target = await getFriendFieldById(input.db, fieldId);
  if (!target || target.ec_is_master === 1) return;
  // 値を書いていない選択肢は、ラベルをそのまま入れる
  const value = choice.value && choice.value !== '' ? choice.value : choice.label;
  await setFriendFieldValue(input.db, {
    friendId: input.friendId,
    fieldId,
    value,
    updatedBy: 'form',
  });
}

/** 1つの動作を実行する。 */
export async function runFormAction(
  input: FormEffectInput,
  action: FormAction,
): Promise<void> {
  const { db, friendId } = input;

  switch (action.kind) {
    case 'send_text':
      if (input.pushText && action.text) await input.pushText(action.text);
      return;

    case 'send_template': {
      if (!input.pushText || !action.templateId) return;
      const template = await getMessageTemplateById(db, action.templateId);
      if (!template) return;
      // テキストのテンプレートだけを送る。Flex は組み立てと差し込みが
      // 配信側の仕組みに乗っているので、そちらを通さずに送らない。
      if (template.message_type !== 'text') {
        console.warn('form action: skipped non-text template', action.templateId);
        return;
      }
      if (template.message_content) await input.pushText(template.message_content);
      return;
    }

    case 'tag':
      for (const tagId of action.tagIds ?? []) {
        if (action.op === 'remove') {
          await removeTagFromFriend(db, friendId, tagId);
        } else {
          await attachTagAndFireSideEffects(
            db,
            friendId,
            tagId,
            input.push
              ? { defaultAccessToken: input.push.defaultAccessToken, workerUrl: input.push.workerUrl }
              : undefined,
          );
        }
      }
      return;

    case 'friend_field': {
      if (!action.fieldId) return;
      const target = await getFriendFieldById(db, action.fieldId);
      if (!target || target.ec_is_master === 1) return;
      await setFriendFieldValue(db, {
        friendId,
        fieldId: action.fieldId,
        value: action.value ?? '',
        updatedBy: 'form',
      });
      return;
    }

    case 'scenario':
      if (!action.scenarioId) return;
      if (action.op === 'stop') {
        // 止め方はシナリオ側の動作と同じにそろえる（'paused'）。ここだけ
        // 別の値を書くと、再開の導線から外れて戻せなくなる。
        await db
          .prepare(
            `UPDATE friend_scenarios SET status = 'paused', updated_at = ?
             WHERE friend_id = ? AND scenario_id = ? AND status IN ('active','delivering')`,
          )
          .bind(jstNow(), friendId, action.scenarioId)
          .run();
        return;
      }
      await enrollFriendInScenario(db, friendId, action.scenarioId);
      return;

    case 'reminder':
      if (!action.reminderId) return;
      await enrollFriendInReminder(db, {
        friendId,
        reminderId: action.reminderId,
        // 起点の日付を持たない動作なので、今日から動かす
        targetDate: jstNow().slice(0, 10),
      });
      return;

    default:
      return;
  }
}
