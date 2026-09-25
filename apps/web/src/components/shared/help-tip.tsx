'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'

/*
 * 見出し・ラベル横の「？」（V6共通 2-1b）。
 * 定義・分母・計算のしかた・単位・いつ時点の数か・言葉の意味だけを入れる。
 * 失敗・警告・操作の結果・必須の印・入力の直し方・数字そのものは入れない
 * （帯や欄の下の文で見せる）。
 */

// 1つ開くと他は閉じる。開いている欄の閉じる関数を1つだけ持つ。
let closeCurrent: (() => void) | null = null

export default function HelpTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const popupId = useId()
  const boxRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const previous = closeCurrent
    if (previous) previous()
    closeCurrent = close
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      if (closeCurrent === close) closeCurrent = null
    }
  }, [open ])

  return (
    <span ref={boxRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? popupId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="text-ink-faint hover:text-ink-secondary inline-flex h-6 w-6 items-center justify-center rounded-full"
      >
        <CircleHelp size={14} aria-hidden />
      </button>
      {open ? (
        <span
          id={popupId}
          role="note"
          className="text-ink-secondary bg-canvas border-hairline absolute top-7 left-0 z-30 w-max max-w-75 rounded-card border p-3 text-xs leading-relaxed shadow-md"
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}
