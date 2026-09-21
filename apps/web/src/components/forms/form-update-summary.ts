/**
 * 「この質問は、送信のときに友だちのどの情報を更新するか」を文にする。
 *
 * 更新先の設定はブロックごとの入力欄（回答の登録先・選択肢の動作）に
 * 散らばっている。設定はできるが「保存して公開したら実際に何が起きるか」を
 * 読み取りにくいので、Worker の反映処理（form-layout-effects）と同じ条件を
 * ここで文に起こす。条件まで書かないと「空欄でも上書きされる」と
 * 思い違いをする。
 *
 * ここで作る文は表示専用。実際に何を書き換えるかの決定権は保存側にある。
 */
import {
  collectInputs,
  hasChoices,
  type FormAction,
  type FormInputBlock,
  type FormLayout,
} from '@line-crm/shared'
import type { FormRefs } from './form-refs'

/** 情報欄の名前を引く。消えた項目・EC管理（書き込まない）は区別して返す。 */
function friendFieldLabel(refs: FormRefs, fieldId: string): { name: string; blocked: boolean } {
  const field = refs.friendFields.find((f) => f.id === fieldId)
  if (!field) return { name: '（消えた項目）', blocked: false }
  return { name: field.name, blocked: field.ecIsMaster }
}

function tagName(refs: FormRefs, tagId: string): string {
  return refs.tags.find((t) => t.id === tagId)?.name ?? '（消えたタグ）'
}

/**
 * 質問1つが送信時に更新する情報を、1行ずつの文にする。
 *
 * - 「回答の登録先」は回答があるときだけ更新される（未回答は更新しない）
 * - ECが正の情報欄には書き込まない（保存側が弾く）ので、その旨も添える
 * - 選択肢の動作は「その選択肢を選んだときだけ」という条件つき
 */
export function describeInputUpdates(block: FormInputBlock, refs: FormRefs): string[] {
  const lines: string[] = []

  const dest = block.destinations
  const targets: string[] = []
  for (const fieldId of dest?.friendFieldIds ?? []) {
    const field = friendFieldLabel(refs, fieldId)
    targets.push(field.blocked ? `情報欄「${field.name}」（ECが正のため更新しない）` : `情報欄「${field.name}」`)
  }
  if (dest?.realName) targets.push('本名')
  if (dest?.displayName) targets.push('システム表示名')
  if (dest?.note) targets.push('個別メモ')
  if (targets.length > 0) {
    lines.push(`回答を ${targets.join('・')} に登録（未回答なら更新しない）`)
  }

  if (hasChoices(block)) {
    const choiceCount = (block.choices ?? []).length
    if (block.choiceMode === 'friendField' && block.choiceFriendFieldId) {
      const field = friendFieldLabel(refs, block.choiceFriendFieldId)
      lines.push(
        field.blocked
          ? `選んだ選択肢の値を情報欄「${field.name}」に登録する設定だが、ECが正のため更新されない`
          : `選んだ選択肢の値を情報欄「${field.name}」に登録（選んだものだけ）`,
      )
    }
    if (block.choiceMode === 'tag') {
      const names = (block.choices ?? [])
        .map((choice) => (choice.tagId ? tagName(refs, choice.tagId) : null))
        .filter((name): name is string => name !== null)
      if (names.length > 0) {
        lines.push(`選んだ選択肢に応じてタグを付ける（${[...new Set(names)].join('・')}）`)
      }
    }
    if (block.choiceMode === 'action') {
      const actionCount = (block.choices ?? []).reduce(
        (count, choice) => count + (choice.actions?.length ?? 0),
        0,
      )
      if (actionCount > 0) {
        lines.push(`選んだ選択肢に応じて動作を実行（計${actionCount}件、選んだものだけ）`)
      }
    }
    if (choiceCount > 0 && (block.choices ?? []).some((choice) => choice.jumpToSectionId)) {
      lines.push('選択肢によって進むページが変わる')
    }
  }

  if (block.type === 'date' && block.reminder?.reminderId) {
    const name = refs.reminders.find((r) => r.id === block.reminder?.reminderId)?.name ?? '（消えたリマインダ）'
    lines.push(`入力した日付を起点にリマインダ「${name}」を動かす`)
  }

  return lines
}

/** 回答後の動作・選択肢の動作に共通する、動作1件の説明。 */
export function describeAction(action: FormAction, refs: FormRefs): string {
  switch (action.kind) {
    case 'send_text':
      return 'テキストを送る'
    case 'send_template':
      return `テンプレート「${refs.templates.find((t) => t.id === action.templateId)?.name ?? '（消えたテンプレート）'}」を送る`
    case 'tag': {
      const names = action.tagIds.map((id) => `「${tagName(refs, id)}」`).join('・')
      return action.op === 'remove' ? `タグ${names}を外す` : `タグ${names}を付ける`
    }
    case 'friend_field': {
      const field = friendFieldLabel(refs, action.fieldId)
      return field.blocked
        ? `情報欄「${field.name}」に登録（ECが正のため更新しない）`
        : `情報欄「${field.name}」に「${action.value}」を登録`
    }
    case 'scenario': {
      const name = refs.scenarios.find((s) => s.id === action.scenarioId)?.name ?? '（消えたシナリオ）'
      return action.op === 'stop' ? `シナリオ「${name}」を止める` : `シナリオ「${name}」を始める`
    }
    case 'reminder':
      return `リマインダ「${refs.reminders.find((r) => r.id === action.reminderId)?.name ?? '（消えたリマインダ）'}」に登録`
  }
}

/** 編集中のフォーム全体が送信時に更新する情報の一覧。 */
export interface FormUpdateOverview {
  /** 質問ごとの更新。更新しない質問（飾り・登録先なし）は出さない */
  questions: { blockId: string; label: string; lines: string[] }[]
  /** フォーム全体にかかるもの（回答時タグ・回答後の動作） */
  formWide: string[]
}

export function describeFormUpdates(
  layout: FormLayout,
  refs: FormRefs,
  onSubmitTagId: string,
): FormUpdateOverview {
  const questions: FormUpdateOverview['questions'] = []
  for (const block of collectInputs(layout)) {
    const lines = describeInputUpdates(block, refs)
    if (lines.length === 0) continue
    questions.push({ blockId: block.id, label: block.label || block.name, lines })
  }

  const formWide: string[] = []
  if (onSubmitTagId) {
    formWide.push(`回答した人全員にタグ「${tagName(refs, onSubmitTagId)}」を付ける`)
  }
  for (const action of layout.options?.afterActions ?? []) {
    formWide.push(`送信後に${describeAction(action, refs)}`)
  }

  return { questions, formWide }
}
