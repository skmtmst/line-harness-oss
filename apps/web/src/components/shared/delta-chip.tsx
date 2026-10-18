import { TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import styles from './delta-chip.module.css'

/**
 * 増減の札（Pencil ★V8 `C6DGX`・`OEQxt`・`r9qfM2`）。
 *
 * 前より増えた・減った・要確認、を小さな色付きの札で出す。
 * 数のマス（KPI）の横などに置く。良い＝緑、悪い＝赤、要確認＝黄。
 */
export default function DeltaChip({
  tone,
  direction,
  children,
}: {
  /** up＝良い（緑）・down＝悪い（赤）・attention＝要確認（黄） */
  tone: 'up' | 'down' | 'attention'
  /** 数の増減の向き。色（良い・悪い）とは別。渡さなければ色と同じ向き。ブロック率が下がって良いときは tone=up・direction=down。 */
  direction?: 'up' | 'down'
  children: React.ReactNode
}) {
  const Icon = tone === 'attention' ? TriangleAlert : (direction ?? tone) === 'up' ? TrendingUp : TrendingDown
  return (
    <span className={[styles.root, styles[tone]].join(' ')}>
      <Icon size={12} aria-hidden="true" className={tone === 'attention' ? styles.attentionIcon : undefined} />
      <span>{children}</span>
    </span>
  )
}
