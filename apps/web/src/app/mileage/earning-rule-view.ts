import type { MileageRule } from '@/lib/api'
import { csvCell } from '@/app/affiliates/offer-list-view'

/**
 * たまる決めごとの見せ方（設計 `N46cQ`）。
 *
 * 絞り込みと並び替えは、読み込んだ決めごとから数えられる。サーバに
 * 並び順を覚える口は無いので、覚えさせる操作は作らない。
 */

/** 上限の決めごとを持っているか。絞り込みの札に使う。 */
export function hasRuleLimit(rule: MileageRule): boolean {
  const c = rule.conditions
  return Boolean(
    c.dailyCapActions
      || c.uniquePerSubject
      || c.uniquePerSubjectPerDay
      || c.uniquePerReferredFriend
      || c.uniquePerReferredFriendPerSubject,
  )
}

/** 1件あたりの上限を、運用者の言葉にする。 */
export function ruleLimitLabel(rule: MileageRule): string {
  if (rule.conditions.uniquePerReferredFriendPerSubject) return '紹介された人・対象ごとに1回'
  if (rule.conditions.uniquePerReferredFriend) return '紹介された人1人につき1回'
  if (rule.conditions.uniquePerSubject) return '対象ごとに1回'
  if (rule.conditions.uniquePerSubjectPerDay && rule.conditions.dailyCapActions) {
    return `同じリンクは1日1回・1日${rule.conditions.dailyCapActions}件まで`
  }
  if (rule.conditions.dailyCapActions) return `1日${rule.conditions.dailyCapActions}回まで`
  return '行動ごとに付与'
}

export type RuleFilter = 'active' | 'stopped' | 'capped' | 'uncapped'

export const RULE_FILTERS: Array<{
  key: RuleFilter
  label: string
  match: (rule: MileageRule) => boolean
}> = [
  { key: 'active', label: '動いている', match: (r) => r.isActive },
  { key: 'stopped', label: '止めている', match: (r) => !r.isActive },
  { key: 'capped', label: '上限あり', match: (r) => hasRuleLimit(r) },
  { key: 'uncapped', label: '上限なし', match: (r) => !hasRuleLimit(r) },
]

export type RuleSort = 'newest' | 'name' | 'amount'

export const RULE_SORTS: Array<{ value: RuleSort; label: string }> = [
  { value: 'newest', label: '新しい順' },
  { value: 'name', label: '決めごとの名前順' },
  { value: 'amount', label: 'マイルが多い順' },
]

/** 絞り込み → 並び替え。札は同じ考えのものを足し合わせる（OR）。 */
export function selectRules(
  rules: MileageRule[],
  { filters, sort }: { filters: RuleFilter[]; sort: RuleSort },
): MileageRule[] {
  let list = rules
  if (filters.length > 0) {
    const picked = RULE_FILTERS.filter((f) => filters.includes(f.key))
    list = list.filter((rule) => picked.some((f) => f.match(rule)))
  }
  const sorted = [...list]
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  else if (sort === 'amount') sorted.sort((a, b) => b.amount - a.amount)
  else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return sorted
}

export const RULE_CSV_HEADER = ['決めごと', '対象の行動', '付与マイル', '上限', '状態', '作成日']

/** 画面に出ている決めごとをそのまま書き出す。サーバに書き出しの口は無い。 */
export function earningRulesCsv(
  rules: MileageRule[],
  names: { event: (eventType: string) => string; date: (iso: string) => string },
): string {
  const lines = [RULE_CSV_HEADER.join(',')]
  for (const rule of rules) {
    lines.push([
      csvCell(rule.name),
      csvCell(names.event(rule.eventType)),
      csvCell(rule.amount),
      csvCell(ruleLimitLabel(rule)),
      csvCell(rule.isActive ? '動いています' : '止めています'),
      csvCell(names.date(rule.createdAt)),
    ].join(','))
  }
  return lines.join('\r\n')
}
