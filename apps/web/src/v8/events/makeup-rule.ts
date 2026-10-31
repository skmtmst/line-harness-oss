import type { EventMakeupRule } from '@/lib/api'

/** 読み出せない値を「オフ」と決めつけず、保存操作を止める。 */
export function readMakeupRule(value: string | null | undefined): EventMakeupRule | null {
  try {
    if (!value) return null
    const r = JSON.parse(value) as EventMakeupRule
    if (!r || typeof r.enabled !== 'boolean'
      || !Number.isInteger(r.cutoffHours) || r.cutoffHours < 0 || r.cutoffHours > 168
      || !Number.isInteger(r.validDays) || r.validDays < 1 || r.validDays > 366
      || !Number.isInteger(r.monthlyCap) || r.monthlyCap < 1 || r.monthlyCap > 52
      || !['same_kind', 'list'].includes(r.target) || !Array.isArray(r.targetIds)
      || r.targetIds.length > 100 || r.targetIds.some(id => typeof id !== 'string')
      || (r.target === 'list' && !r.targetIds.length)) return null
    return r
  } catch { return null }
}

export function makeupRuleSummary(rule: EventMakeupRule): string {
  return `${rule.enabled ? '使う' : '使わない'}・開始の ${rule.cutoffHours} 時間前まで・元の回から ${rule.validDays} 日間・月 ${rule.monthlyCap} 回まで・${rule.target === 'same_kind' ? '同じクラス' : `指定の ${rule.targetIds.length} クラス`}`
}
