import { formatYen } from './display'

export interface Agg {
  id: string
  name: string
  sub: string | null
  conversions: number
  revenue: number
  reward: number
  missingReward: boolean
  prevReward: number | null
}

export function rewardText(row: Agg): string {
  if (row.conversions === 0 || row.missingReward) return '—'
  if (row.reward === 0) return '計測のみ'
  const base = formatYen(row.reward)
  if (false || row.prevReward == null) return base
  if (row.prevReward === 0) return `${base}（初めて）`
  const diff = row.reward - row.prevReward
  if (diff === 0) return `${base}（±¥0）`
  return `${base}（${diff > 0 ? '+' : '−'}${formatYen(Math.abs(diff))}）`
}
