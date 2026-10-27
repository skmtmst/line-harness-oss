import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import IconRow from './icon-row'
import styles from './activity-item.module.css'

/**
 * 動きの行（Pencil ★V8 `x4FeKG`・`EsjP2`）。
 *
 * 「いつ・何が起きたか」を縦に並べる履歴の1行。左に丸い印と、
 * 次の行へ繋がる縦線。題・補足・時刻の3つで構成し、3つとも行の上下の真ん中に置く。
 * 最後の行は `last` で縦線を消す。
 */
export default function ActivityItem({
  icon: Icon,
  title,
  note,
  time,
  last = false,
}: {
  icon: LucideIcon
  /** 起きたこと（例「配信が完了しました」） */
  title: React.ReactNode
  /** 題の下の補足（任意） */
  note?: React.ReactNode
  /** 右端の時刻表示 */
  time: React.ReactNode
  /** 最後の行なら true（縦線を描かない） */
  last?: boolean
}) {
  // 印・題と補足・時刻を行の上下の真ん中にそろえる（共通の行 IconRow。縦線もそこが引く）。
  return <IconRow iconShape="round" icon={<Icon size={16} />} title={title} sub={note} end={time} connect={!last} />
}

/** V8 x4FeKG. Also usable without a timeline row. */

export function ActivityMarker({ icon: Icon }: { icon: LucideIcon }) {
  return <span className={styles.marker} aria-hidden="true"><Icon size={16} /></span>
}

/** 履歴の小さな時刻。カードの中でも同じ文字と行の値を使う。 */
export function ActivityTime({ children, lineHeight }: { children: ReactNode; lineHeight?: string }) {
  return <span className={styles.microTime} style={lineHeight ? { '--activity-time-line-height': lineHeight } as CSSProperties : undefined}>{children}</span>
}
