/**
 * 応答したときに行うこと1つぶんが、実行できる形かどうか。
 *
 * 実行の直前の判定は Worker の `isScenarioActionComplete`
 *（`apps/worker/src/services/scenario-actions.ts`）が持つ。
 * **ここは画面に「何が足りないか」を出すための同じ判定**で、埋まって
 * いないときに足りない中身を言葉で返す。埋まっていれば null。
 *
 * 判定を2か所で変えないよう、種別ごとの条件は Worker と1対1にする。
 * 条件を変えたら両方を直し、両方の試験を回す。
 */

import type { ScenarioActionType } from '@/lib/api'

/**
 * 足りない中身。null なら実行できる。
 *
 * 言葉は運用者の画面に出る。「対象未選択」のような作った側の言い方や
 * ID・列名は出さず、何を選ぶ欄かをそのまま書く。
 */
export function actionIncompleteReason(
  actionType: ScenarioActionType | string,
  config: unknown,
): string | null {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return '設定が読み取れません'
  }
  const c = config as Record<string, unknown>
  switch (actionType) {
    case 'tag': {
      const picked =
        (Array.isArray(c.tagIds) && c.tagIds.length > 0) ||
        (typeof c.folderId === 'string' && c.folderId !== '')
      if ((c.op === 'add' || c.op === 'remove') && picked) return null
      return 'タグが選ばれていません'
    }
    case 'friend_field': {
      if (
        typeof c.fieldId === 'string' &&
        c.fieldId !== '' &&
        ['set', 'add', 'sub', 'clear'].includes(String(c.op))
      ) {
        return null
      }
      return '友だち情報の項目が選ばれていません'
    }
    case 'support_mark': {
      // null は「対応マークを外す」という意味のある指定。
      if (c.markId === null || (typeof c.markId === 'string' && c.markId !== '')) return null
      return '対応マークが選ばれていません'
    }
    case 'scenario': {
      if (c.op === 'resume_previous' || c.op === 'stop') return null
      if (c.op === 'start' && typeof c.scenarioId === 'string' && c.scenarioId !== '') return null
      return 'シナリオが選ばれていません'
    }
    case 'common_var': {
      if (typeof c.varKey === 'string' && c.varKey !== '' && (c.op === 'add' || c.op === 'sub')) {
        return null
      }
      return '共通情報の項目が選ばれていません'
    }
    case 'send_message': {
      if (typeof c.content === 'string' && c.content.trim() !== '') return null
      return '本文が空です'
    }
    case 'send_template': {
      if (typeof c.templateId === 'string' && c.templateId !== '') return null
      return 'テンプレートが選ばれていません'
    }
    case 'reminder': {
      if (typeof c.reminderId === 'string' && c.reminderId !== '') return null
      return 'リマインダが選ばれていません'
    }
    case 'event_booking': {
      if (typeof c.eventId === 'string' && c.eventId !== '') return null
      return 'イベントが選ばれていません'
    }
    default:
      return 'この処理の種類を確認できません'
  }
}

/** 実行できる形かどうかだけが要るとき。 */
export function isInlineActionComplete(
  actionType: ScenarioActionType | string,
  config: unknown,
): boolean {
  return actionIncompleteReason(actionType, config) === null
}
