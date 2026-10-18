import type { ActionDraft } from './action-draft'
import { b244Requirements } from './draft-model'
import { normalizeFriendIds, normalizeWeekdays } from './trigger-helpers'

export interface AutomationInputProblem {
  target: string
  message: string
  actionKey?: number
}

/** 保存にも公開にも同じ検査を使い、画面の入力は変更しない。 */
export function validateAutomationInput({ name, eventType, triggerConfig, conditionUnreadable, actions }: {
  name: string
  eventType: string
  triggerConfig: Record<string, unknown>
  conditionUnreadable: boolean
  actions: ActionDraft[]
}): AutomationInputProblem | null {
    const invalid = (target: string, message: string, actionKey?: number) => {
      return { target, message, actionKey }
    }
    if ((b244Requirements.name.check(name) !== null)) return invalid('v8-rule-name', 'ルール名を入力してください')
    if (eventType === 'tag_change' && !String(triggerConfig.tagId ?? '').trim()) return invalid('v8-trigger-tag', 'きっかけのタグを選んでください')
    /*
     * 古い形で保存された条件を読めなかった下書きは、付け直すまで保存させない。
     * そのまま保存すると、読めなかった条件が黙って消えて全員へ届くルールに
     * 変わってしまう（AUTOMATION-04）。
     */
    if (conditionUnreadable) {
      return invalid('v8-repair-condition', '保存されていた「だれに」の条件を付け直してください（読めない古い形のままでは保存できません）')
    }
    // 時刻・日時のきっかけは対象の友だちが必須（サーバの検証と同じ条件）。
    if (eventType === 'datetime' && !String(triggerConfig.at ?? '').trim()) return invalid('v8-trigger-at', '実行日時を入力してください')
    if ((eventType === 'daily' || eventType === 'weekly') && !String(triggerConfig.time ?? '').trim()) return invalid('v8-trigger-time', '実行時刻を入力してください')
    if (eventType === 'weekly' && normalizeWeekdays(triggerConfig.weekdays).length === 0) return invalid('au-weekday-first', '曜日を1つ以上選んでください')
    if ((eventType === 'datetime' || eventType === 'daily' || eventType === 'weekly')
      && normalizeFriendIds(triggerConfig.friendIds).length === 0) return invalid('au-friend-search', '対象の友だちを選んでください')
    if (actions.length === 0) return invalid('v8-add-action', 'することを1つ以上決めてください')
    for (const row of actions) {
      if (row.type === 'add_tag' && !row.tagId) return invalid(`v8-tag-${row.key}`, '付けるタグを選んでください', row.key)
      if (row.type === 'start_scenario' && !row.scenarioId) return invalid(`v8-scenario-${row.key}`, '始めるシナリオを選んでください', row.key)
      if (row.type === 'common_action' && !row.commonActionId) return invalid(`v8-common-action-${row.key}`, '使う共通アクションを選んでください', row.key)
      if (row.type === 'send_message' && (b244Requirements.row_message.check(row.message) !== null)) return invalid(`v8-message-${row.key}`, '送る文面を入力してください', row.key)
      if (row.type === 'notify_staff'
        && (!String(row.kept?.notificationRuleId ?? '').trim() || !String(row.kept?.message ?? '').trim())) {
        return invalid(`v8-action-${row.key}`, '担当へ知らせる中身が読めません。することを選び直してください', row.key)
      }
    }
    return null
}
