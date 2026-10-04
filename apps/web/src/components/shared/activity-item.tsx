import type { LucideIcon } from 'lucide-react'
import styles from './activity-item.module.css'

/**
 * 動きの行（Pencil ★V8 `x4FeKG`・`EsjP2`）。
 *
 * 「いつ・何が起きたか」を縦に並べる履歴の1行。左に丸い印と、
 * 次の行へ繋がる縦線。題・補足・時刻の3つで構成する。
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
  return (
    <div className={styles.row}>
      <div className={styles.rail} aria-hidden="true">
        <span className={styles.marker}>
          <Icon size={12} />
        </span>
        {!last && <span className={styles.line} />}
      </div>
      <div className={styles.body}>
        <span className={styles.title}>{title}</span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
      <span className={styles.time}>{time}</span>
    </div>
  )
}

/** V8 x4FeKG. Also usable without a timeline row. */

export function ActivityMarker({ icon: Icon }: { icon: LucideIcon }) {
  return <span className={styles.marker} aria-hidden="true"><Icon size={12} /></span>
}
