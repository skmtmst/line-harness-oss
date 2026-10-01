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
  children,
}: {
  /** up＝良い（緑）・down＝悪い（赤）・attention＝要確認（黄） */
  tone: 'up' | 'down' | 'attention'
  children: React.ReactNode
}) {
  const Icon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : TriangleAlert
  return (
    <span className={[styles.root, styles[tone]].join(' ')}>
      <Icon size={12} aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}
