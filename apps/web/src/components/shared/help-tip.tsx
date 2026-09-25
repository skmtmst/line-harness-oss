'use client'

import { CircleHelp } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './help-tip.module.css'

/**
 * 補足の「？」。`docs/v6-common-rules.md` §2-1b（★V7、Pencil `l6oEw`）。
 *
 * 定義・分母・計算のしかた・単位・いつ時点の数か・言葉の意味だけを入れる。
 * 失敗・警告・必須の印・入力の直し方・数字そのものは入れない（帯や欄の下の文で見せる）。
 * 押す・Tab＋Enter で開き、ホバーだけでは開かない。Esc・外を押すと閉じる。
 */
export default function HelpTip({
  label,
  text,
  className,
}: {
  /** 読み上げ名（例：「送る日時の説明」）。吹き出しとは `aria-describedby` でつなぐ。 */
  label: string
  /** 吹き出しの中身。1〜2文。 */
  text: ReactNode
  className?: string
}) {
  const autoId = useId()
  const tipId = `${autoId}-tip`
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open ])

  return (
    <span ref={rootRef} className={[styles.root, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.button}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <CircleHelp aria-hidden="true" />
      </button>
      {open ? (
        <span id={tipId} role="tooltip" className={styles.tip}>
          {text}
        </span>
      ) : null}
    </span>
  )
}
