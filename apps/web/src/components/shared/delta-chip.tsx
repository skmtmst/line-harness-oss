import { Children, isValidElement, type ReactNode } from 'react'
import { TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import styles from './delta-chip.module.css'

function textOf(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : ''
  }).join('')
}

/** 差の札の文字が 0（「+0」「−0」「0.0%」など）なら、札を出さない。 */
export function isZeroDelta(children: ReactNode): boolean {
  const normalized = textOf(children)
    .replace(/[−ー–—]/gu, '-')
    .replace(/[+±]/gu, '')
    .replace(/[,\s]/gu, '')
    .replace(/(%|pt|ポイント|件|人|分|円)$/iu, '')
  return normalized !== '' && Number(normalized) === 0
}

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
  if (tone !== 'attention' && isZeroDelta(children)) return null
  const Icon = tone === 'attention' ? TriangleAlert : (direction ?? tone) === 'up' ? TrendingUp : TrendingDown
  return (
    <span className={[styles.root, styles[tone]].join(' ')}>
      <Icon size={12} aria-hidden="true" className={tone === 'attention' ? styles.attentionIcon : undefined} />
      <span>{children}</span>
    </span>
  )
}
