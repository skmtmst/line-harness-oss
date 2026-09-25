'use client'

/*
 * 見出し・ラベル横の「？」（★V7、Pencil `l6oEw`、共通ルール 2-1b）。
 *
 * 定義・分母・計算のしかた・単位・いつ時点の数か・言葉の意味だけを入れる。
 * 失敗・警告・操作の結果・必須の印・入力の直し方・数字そのものは入れない
 * （帯や欄の下の文で見せる）。
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import styles from './help-tip.module.css'

const CLOSE_OTHERS_EVENT = 'help-tip-open'

/**
 * 補足の「？」。押す・タップ・Tab＋Enter で開く。ホバーだけでは開かない。
 * Esc や外を押すと閉じ、1つ開くと他は閉じる。
 */
export default function HelpTip({
  label,
  className,
  moreHref,
  moreLabel = 'くわしく',
  children,
}: {
  /** 読み上げ名（例：「今月の完了率の説明」）。吹き出しとは aria-describedby でつなぐ。 */
  label: string
  className?: string
  /** 長い説明がある場所（用語集など）。渡すと吹き出しに「くわしく」が出る。 */
  moreHref?: string
  /** 「くわしく」の代わりの文言。 */
  moreLabel?: string
  /** 1〜2文の補足。 */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // 1つ開くと他は閉じる。開いた側が合図し、違う持ち主だけ閉じる。
  useEffect(() => {
    if (!open) return
    const closeOthers = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== tipId) setOpen(false)
    }
    window.addEventListener(CLOSE_OTHERS_EVENT, closeOthers)
    return () => window.removeEventListener(CLOSE_OTHERS_EVENT, closeOthers)
  }, [open, tipId])

  // Esc や外を押すと閉じる。Escでは押した？へ戻る。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open ])

  const toggle = () => {
    setOpen((current) => {
      if (!current) window.dispatchEvent(new CustomEvent(CLOSE_OTHERS_EVENT, { detail: tipId }))
      return !current
    })
  }

  return (
    <span
      ref={wrapRef}
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={toggle}
        className={styles.button}
      >
        <CircleHelp aria-hidden="true" />
      </button>
      {open ? (
        <span role="note" id={tipId} className={styles.tip}>
          {children}
          {moreHref ? (
            <a href={moreHref} className={styles.more}>
              {moreLabel}
            </a>
          ) : null}
        </span>
      ) : null}
    </span>
  )
}
