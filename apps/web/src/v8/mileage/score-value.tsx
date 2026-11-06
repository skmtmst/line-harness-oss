import type { ReactNode } from 'react'

/** 点数の増減の意味色。数と単位・未取得の文言は呼び出す場所で保つ。 */
export default function ScoreValue({ change, negativeTone = 'warning', children }: {
  change: number | null
  negativeTone?: 'warning' | 'danger'
  children: ReactNode
}) {
  const direction = change === null || !Number.isFinite(change) || change === 0 ? 'zero' : change > 0 ? 'positive' : 'negative'
  const tone = direction === 'positive' ? 'success' : direction === 'negative' ? negativeTone : 'neutral'
  return <span data-score-delta={direction} data-tone={tone} className={tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : undefined}>{children}</span>
}
