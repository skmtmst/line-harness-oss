'use client'

import { useEffect, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import styles from './delete-button.module.css'

/**
 * 削除ボタン（Pencil ★V8 `prbOC`／確認中 `zopvP`。手本は rareui deletebutton）。
 *
 * 48px のゴミ箱タイル → 押すと右へ確認の帯が開き、✓（消す・赤）と
 * ×（やめる）が出る。Esc でもやめられる。大きな確認ダイアログを出す
 * ほどでもない場面での2段階操作。
 *
 * 消す処理そのものは呼び出し側（`onConfirm`）が持つ。この部品は
 * 押し間違いを防ぐ1段だけを足す。
 */
export default function DeleteButton({
  onConfirm,
  label = '削除',
  confirmLabel = '削除',
  cancelLabel = 'やめる',
  disabled = false,
}: {
  /** ✓ を押したとき。実際の削除・結果表示は呼び出し側が持つ。 */
  onConfirm: () => void
  /** 閉じたタイルの読み上げ名（「◯◯を削除」などを渡す）。 */
  label?: string
  /** 確認側 ✓ の読み上げ名。 */
  confirmLabel?: string
  /** 確認側 × の読み上げ名。 */
  cancelLabel?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <span className={styles.root} data-open={open || undefined}>
      <button
        type="button"
        className={styles.tile}
        aria-label={label}
        disabled={disabled}
        tabIndex={open ? -1 : 0}
        aria-hidden={open}
        onClick={() => setOpen(true)}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
      <span
        className={styles.confirm}
        role="group"
        aria-label={label}
        aria-hidden={!open}
      >
        <button
          type="button"
          className={styles.yes}
          aria-label={confirmLabel}
          tabIndex={open ? 0 : -1}
          onClick={() => {
            setOpen(false)
            onConfirm()
          }}
        >
          <Check size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.no}
          aria-label={cancelLabel}
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </span>
    </span>
  )
}
