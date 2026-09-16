/** 金額（円）。画面の数字はすべてこの形。 */
export function yen(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

/**
 * ランクの印。Pencil 37-1 の4段（レギュラー＝緑の淡色／シルバー＝灰／ゴールド＝金／プラチナ＝黒地に白）。
 * ランクが増えたときは、上から2つを黒・金、いちばん下を緑、間を灰にする。
 */
export function rankTone(rankKey: string | null, rankOrder: string[]): 'top' | 'second' | 'middle' | 'base' | 'unknown' {
  const index = rankKey ? rankOrder.indexOf(rankKey) : -1
  if (index < 0) return 'unknown'
  if (rankOrder.length > 1 && index === rankOrder.length - 1) return 'top'
  if (rankOrder.length > 2 && index === rankOrder.length - 2) return 'second'
  if (index === 0) return 'base'
  return 'middle'
}

export function RankChip({ rankKey, name, rankOrder = ['regular', 'silver', 'gold', 'platinum'] }: { rankKey: string | null; name: string; rankOrder?: string[] }) {
  const tone = rankTone(rankKey, rankOrder)
  return (
    <span
      className={
        tone === 'top'
          ? 'inline-flex h-5.5 items-center rounded-pill bg-ink px-2 text-nano font-bold text-on-accent'
          : tone === 'second'
            ? 'inline-flex h-5.5 items-center rounded-pill bg-status-warn-soft px-2 text-nano font-bold text-status-warn-deep'
            : tone === 'base'
              ? 'inline-flex h-5.5 items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep'
              : tone === 'middle'
                ? 'inline-flex h-5.5 items-center rounded-pill bg-shell px-2 text-nano font-bold text-ink-secondary'
                : 'inline-flex h-5.5 items-center rounded-pill bg-shell px-2 text-nano font-bold text-ink-faint'
      }
    >
      {name}
    </span>
  )
}
