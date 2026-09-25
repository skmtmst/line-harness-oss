import { useId, useState, type ReactNode } from 'react'
import styles from './help-tip.module.css'

/**
 * 見出し・ラベル横の「？」。言葉の意味・定義・分母・計算・単位の補足だけ入れる。
 *
 * 失敗・警告・必須・直し方は入れない（本文・帯・印に書く）。
 * 開閉はボタンのみ。Tab で辿り着き、Enter・Space で開く。
 */
export default function HelpTip({
  label,
  children,
}: {
  /** 「何の補足か」。ボタンの読み上げ名になる（例：「検査の状態の意味」）。 */
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <span className={styles.root}>
      <button
        type="button"
        className={styles.button}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? bodyId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">？</span>
      </button>
      {open ? (
        <span role="note" id={bodyId} className={styles.body}>
          {children}
        </span>
      ) : null}
    </span>
  )
}
