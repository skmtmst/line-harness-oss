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

/** 全体上限・選択肢定員のうち、原子的に確保すべき1枠。 */
export interface FormCapacitySlot {
  /** `form_capacity_claims.slot_key`。全体は固定値、選択肢は `choice:ブロック名:ラベル`。 */
  key: string;
  limit: number;
  /** 確保できなかったときに利用者へ見せる文言。 */
  message: string;
}

/** 全体上限のキー。他のフォーム内容と衝突しない固定値。 */
export const FORM_TOTAL_LIMIT_SLOT_KEY = '__total__';

/**
 * この回答が原子的に確保すべき枠を列挙する(N-167 / #751)。
 *
 * `checkFormGates` の全体上限・選択肢定員の判定は「数えてから比べる」
 * だけで、同時に来た別の回答との間に隙間がある。ここで列挙した枠を
 * `claimFormCapacitySlot` で1つずつ条件付き INSERT すれば、同時に来ても
 * 定員ぶんしか勝てない。
 *
 * `checkFormGates` と同じ判定条件(enabled・limit の型)を使う。
 * 対象が無ければ空配列を返す(ほとんどの回答はここに来ない)。
 */
export function collectCapacitySlots(layout: FormLayout, answers: FormAnswers): FormCapacitySlot[] {
  const slots: FormCapacitySlot[] = [];
  const options = layout.options ?? {};

  if (options.totalLimit?.enabled && typeof options.totalLimit.max === 'number') {
    slots.push({
      key: FORM_TOTAL_LIMIT_SLOT_KEY,
      limit: options.totalLimit.max,
      message: options.totalLimit.message || 'このフォームは受付を終了しました',
    });
  }

  for (const block of collectInputs(layout)) {
    if (!hasChoices(block)) continue;
    const limited = (block.choices ?? []).filter(
      (c) => c.capacity?.enabled && typeof c.capacity.limit === 'number',
    );
    if (limited.length === 0) continue;

    const selected = toLabels(answers[block.name]);
    for (const choice of limited) {
      if (!selected.includes(choice.label)) continue;
      slots.push({
        key: `choice:${block.name}:${choice.label}`,
        limit: choice.capacity!.limit!,
        message: `「${choice.label}」は定員に達しました`,
      });
    }
  }

  return slots;
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

/**
 * メッセージを送る手段。route 側から渡す。テストでは差し替える。
 * stableSuffix は再開時の再送でも同じ値になる送信の識別子で、LINE の
 * 再送キーに使い分ける(連番にすると再開時にずれて二重送信になる)。
 */
export type PushText = (text: string, stableSuffix: string) => Promise<void>;

export interface FormEffectInput {
  db: D1Database;
  layout: FormLayout;
  friendId: string;
  answers: FormAnswers;
  /** タグ付与に伴うシナリオの即時配信で使う */
  push?: { defaultAccessToken: string; workerUrl?: string };
  /** テキスト送信・テンプレート送信で使う。無ければその動作は飛ばす */
  pushText?: PushText;
  /**
   * 回答送信の再開時に二重登録を避ける接頭辞。例: `form-submit:<answerId>`。
   * 付けるとリマインダ登録に安定した sourceEventId を付けて重複を避ける。
   */
  idempotencyPrefix?: string;
  /**
   * 効果の実行前–完了の掛け金。再開時は終わった効果を飛ばし、終わった
   * 効果だけを記録する(部分失敗の補完)。返さない・投げない hook は
   * 効果を未完のままにしないこと。hook が投げた失敗は握らず、そのまま
   * 呼び出し元へ返す(予約の所有者を失った合図など)。
   */
  skipEffect?: (effectId: string) => boolean;
  onEffectComplete?: (
    effectId: string,
    stats: { attempted: number; succeeded: number; failed: number },
  ) => Promise<void>;
}

export interface FormDestinationWriteStats {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface FormEffectResult {
  destinationWrites: FormDestinationWriteStats;
  /**
   * 失敗して欠落した工程の名前。空ならすべて完了。
   * route は空でないとき工程完了にせず、同じ送信の再送で補完する。
   */
  failedEffects: string[];
}

/**
 * 回答を配る。
 *
 * 途中で失敗しても後ろを続ける。1つの動作の失敗が、他の動作を巻き込んで
 * 全部落とすのが一番困る（タグは付いたのにシナリオが動かない、が
 * 分からなくなる）。失敗した工程の名前は failedEffects に残す。
 */
export async function applyFormLayoutEffects(input: FormEffectInput): Promise<FormEffectResult> {
  const { db, layout, friendId, answers } = input;
  const destinationWrites: FormDestinationWriteStats = { attempted: 0, succeeded: 0, failed: 0 };
  const failedEffects: string[] = [];

  for (const block of collectInputs(layout)) {
    const value = answers[block.name];
    if (value === undefined) continue;

    await runEffectStep(input, failedEffects, destinationWrites, `destinations:${block.id}`, () => writeDestinations(
      db,
      block,
      value,
      friendId,
      destinationWrites,
    ));

    if (hasChoices(block)) {
      await runEffectStep(input, failedEffects, destinationWrites, `choices:${block.id}`, () =>
        runChoiceEffects(input, block, value, destinationWrites, failedEffects));
    }

    if (block.type === 'date' && block.reminder?.reminderId) {
      await runEffectStep(input, failedEffects, destinationWrites, `reminder:${block.id}`, () =>
        enrollFormReminderOnce(input, block.reminder!.reminderId, toText(value)));
    }
  }

  const afterActions = layout.options?.afterActions ?? [];
  for (let index = 0; index < afterActions.length; index += 1) {
    const action = afterActions[index];
    await runEffectStep(input, failedEffects, destinationWrites, `afterAction:${index}`, () =>
      runFormAction(input, action, destinationWrites, index, `afterAction:${index}`));
  }

  return { destinationWrites, failedEffects };
}

/**
 * 効果を1件実行する。再開時は終わった効果を飛ばし、終わった効果の集計
 * だけを hook へ渡す。内側で握られた失敗(選択肢ごとの動作など)も、この
 * 効果の未完として扱い、再送で補完できるようにする。hook の失敗だけは
 * 握らず呼び出し元へ返す。
 */
async function runEffectStep(
  input: FormEffectInput,
  failed: string[],
  stats: FormDestinationWriteStats,
  effectId: string,
  run: () => Promise<unknown>,
): Promise<void> {
  if (input.skipEffect?.(effectId)) return;
  const beforeFailed = stats.failed;
  const beforeInnerFailed = failed.length;
  const before = { attempted: stats.attempted, succeeded: stats.succeeded, failed: stats.failed };
  try {
    await run();
  } catch (err) {
    failed.push(effectId);
    console.error(`form effect (${effectId}) failed:`, err);
    return;
  }
  if (failed.length > beforeInnerFailed || stats.failed > beforeFailed) {
    // 内側の動作が欠けたまま終わった。再開時に補完するため未完に残す。
    if (!failed.includes(effectId)) failed.push(effectId);
    console.error(`form effect (${effectId}) partial failure`);
    return;
  }
  await input.onEffectComplete?.(effectId, {
    attempted: stats.attempted - before.attempted,
    succeeded: stats.succeeded - before.succeeded,
    failed: stats.failed - before.failed,
  });
}

async function runTracked(failed: string[], label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    failed.push(label);
    console.error(`form effect (${label}) failed:`, err);
  }
}

/**
 * リマインダの登録。二重登録を避けるため、接頭辞があるときは安定した
 * 登録元idを付けて既存を確認してから登録する(再開時の再実行に備える)。
 */
async function enrollFormReminderOnce(
  input: FormEffectInput,
  reminderId: string,
  targetDate: string,
  keySuffix?: string,
): Promise<void> {
  const { db, friendId } = input;
  const sourceEventId = input.idempotencyPrefix
    ? `${input.idempotencyPrefix}:${keySuffix ?? `reminder:${reminderId}`}`
    : null;
  if (sourceEventId) {
    const existing = await db
      .prepare(
        `SELECT 1 AS found FROM friend_reminders
         WHERE friend_id = ? AND reminder_id = ? AND source_event_id = ? LIMIT 1`,
      )
      .bind(friendId, reminderId, sourceEventId)
      .first<{ found: number }>();
    if (existing?.found) return;
  }
  await enrollFriendInReminder(db, {
    friendId,
    reminderId,
    targetDate,
    sourceEventId,
  }).then(() => undefined);
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
  stats: FormDestinationWriteStats,
): Promise<void> {
  const dest = block.destinations;
  if (!dest) return;
  const text = toText(value);

  for (const fieldId of dest.friendFieldIds ?? []) {
    // 書けない相手(EC正・削除済み)は数えない。数えると「失敗」になり、
    // 再送しても直らない工程が未完のまま残る。
    const target = await getFriendFieldById(db, fieldId);
    if (!target || target.ec_is_master === 1) continue;
    await trackDestinationWrite(stats, 1, async () => {
      await setFriendFieldValue(db, {
        friendId,
        fieldId,
        value: text === '' ? null : text,
        updatedBy: 'form',
      });
      return true;
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

  await trackDestinationWrite(stats, columns.length, async () => {
    await db
      .prepare(`UPDATE friends SET ${columns.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...values, jstNow(), friendId)
      .run();
    return true;
  });
}

async function trackDestinationWrite(
  stats: FormDestinationWriteStats,
  count: number,
  write: () => Promise<boolean>,
): Promise<void> {
  stats.attempted += count;
  try {
    if (await write()) stats.succeeded += count;
    else stats.failed += count;
  } catch (error) {
    stats.failed += count;
    console.error('form destination write failed:', error);
  }
}

/** 選ばれた選択肢の動作を実行する。 */
async function runChoiceEffects(
  input: FormEffectInput,
  block: FormInputBlock,
  value: unknown,
  stats: FormDestinationWriteStats,
  failed: string[],
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
        await applyChoiceFriendField(input, block, choice, stats);
        break;
      case 'action': {
        const actions = choice.actions ?? [];
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          const action = actions[actionIndex];
          const actionLabel = `choiceAction:${block.id}:${choice.id}:${actionIndex}`;
          await runTracked(failed, actionLabel, () =>
            runFormAction(input, action, stats, undefined, actionLabel));
        }
        break;
      }
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
  stats: FormDestinationWriteStats,
): Promise<void> {
  const fieldId = block.choiceFriendFieldId;
  if (!fieldId) return;
  // 書けない相手は数えない(再送しても直らない未完にしない)。
  const target = await getFriendFieldById(input.db, fieldId);
  if (!target || target.ec_is_master === 1) return;
  await trackDestinationWrite(stats, 1, async () => {
    // 値を書いていない選択肢は、ラベルをそのまま入れる
    const value = choice.value && choice.value !== '' ? choice.value : choice.label;
    await setFriendFieldValue(input.db, {
      friendId: input.friendId,
      fieldId,
      value,
      updatedBy: 'form',
    });
    return true;
  });
}

/**
 * 1つの動作を実行する。pushSuffix は送信の安定した識別子で、再開時の
 * 再送でも同じ値になるものを呼ぶ側が渡す(省略時は動作の種類で代用する)。
 */
export async function runFormAction(
  input: FormEffectInput,
  action: FormAction,
  destinationWrites?: FormDestinationWriteStats,
  actionIndex?: number,
  pushSuffix?: string,
): Promise<void> {
  const { db, friendId } = input;

  switch (action.kind) {
    case 'send_text':
      if (input.pushText && action.text) {
        await input.pushText(action.text, pushSuffix ?? `send_text:${action.text}`);
      }
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
      if (template.message_content) {
        await input.pushText(template.message_content, pushSuffix ?? `send_template:${action.templateId}`);
      }
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
      // 書けない相手は数えない(再送しても直らない未完にしない)。
      const target = await getFriendFieldById(db, action.fieldId);
      if (!target || target.ec_is_master === 1) return;
      const write = async () => {
        await setFriendFieldValue(db, {
          friendId,
          fieldId: action.fieldId!,
          value: action.value ?? '',
          updatedBy: 'form',
        });
        return true;
      };
      if (destinationWrites) await trackDestinationWrite(destinationWrites, 1, write);
      else await write();
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

    case 'reminder': {
      if (!action.reminderId) return;
      const reminderLabel = actionIndex === undefined
        ? `reminder:action:${action.reminderId}`
        : `reminder:afterAction:${actionIndex}`;
      // 起点の日付を持たない動作なので、今日から動かす
      await enrollFormReminderOnce(
        input,
        action.reminderId,
        jstNow().slice(0, 10),
        reminderLabel,
      );
      return;
    }

    default:
      return;
  }
}
