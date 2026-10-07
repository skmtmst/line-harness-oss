import type { Tag } from '@line-crm/shared'
import type { TagDefinition } from '@/lib/api'
import type { TagEditorValues } from '@/components/friend-fields/tag-editor-v4'

/**
 * タグの編集競合（409）の「違いを比べる」で出す差分。
 *
 * 自分の入力と、相手が保存した最新の版を比べる。
 * 版の履歴APIは無いので、読み直す前に最新を1回取ってその場で比べる
 * （reminders の reminder-conflict-diff と同じ形）。
 */

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 最新の版が連動 ON か（tag-editor-v8 の hasStoredLink と同じ見方）。 */
function incomingLinked(tag: Tag): boolean {
  return Boolean(tag.mileageReward || tag.referralMileageReward || tag.mileageMultiplierBps)
}

/** 変わった所の名前を順に返す。同じなら空。 */
export function describeTagDiff(mine: TagEditorValues, incoming: TagDefinition): string[] {
  const lines: string[] = []
  const tag = incoming.tag
  if (mine.name !== tag.name) {
    lines.push(`タグ名が違います（最新「${tag.name || '（無題）'}」／あなた「${mine.name || '（無題）'}」）`)
  } else if (
    (mine.groupId || '') !== (tag.groupId || '') ||
    mine.isStarred !== tag.isStarred
  ) {
    lines.push('基本設定（フォルダ・一覧への表示）が違います')
  }
  if (mine.linked !== incomingLinked(tag)) {
    lines.push(`タグ連動の ON／OFF が違います（最新は${incomingLinked(tag) ? 'ON' : 'OFF'}）`)
  } else if (mine.linked) {
    if (
      mine.rewardMiles !== (tag.mileageReward ?? 0) ||
      mine.referralRewardMiles !== (tag.referralMileageReward ?? 0)
    ) {
      lines.push('マイルの付与数（本人・紹介者）が違います')
    }
    if ((mine.multiplierBps ?? null) !== (tag.mileageMultiplierBps ?? null)) {
      lines.push('今後のマイル倍率が違います')
    }
    if (
      mine.multiplierPriority !== (tag.mileageMultiplierPriority ?? 0) ||
      mine.reapplyPolicy !== (tag.reapplyPolicy ?? 'first_only')
    ) {
      lines.push('倍率の優先度・付け直しの扱いが違います')
    }
    const incomingActions = incoming.automation?.actions ?? []
    if (!sameJson(mine.actions, incomingActions)) {
      lines.push(
        `連動アクションが違います（最新${incomingActions.length}件／あなた${mine.actions.length}件）`,
      )
    }
  }
  return lines
}
