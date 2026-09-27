'use client'

import { useSyncExternalStore } from 'react'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import styles from './toast.module.css'

/** 知らせの種類。色分けはしない（黒地に白字で統一）。印だけ変える。 */
export type ToastTone = 'success' | 'error'

export type ToastItem = {
  id: number
  message: string
  tone: ToastTone
  /** 取り消せる操作の「元に戻す」。1件に1つまで。 */
  actionLabel?: string
  onAction?: () => void
}

export type NotifyToastOptions = {
  tone?: ToastTone
  /** 4秒で消える。0以下で消さない（長押しの確認待ちなど）。 */
  duration?: number
  actionLabel?: string
  onAction?: () => void
}

const DEFAULT_DURATION = 4000
const MAX_ITEMS = 3

let nextId = 1
let items: ToastItem[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function snapshot(): ToastItem[] {
  return items
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function dismissToast(id: number): void {
  const before = items.length
  items = items.filter((item) => item.id !== id)
  if (items.length !== before) emit()
}

/**
 * 保存の知らせを右下に出す。「保存しました」「削除しました」など、
 * 画面の中に文で出していた知らせはここへ送る。4秒で消える。
 *
 * 返す関数を呼ぶとすぐに消せる。取り消せる操作は
 * `actionLabel: '元に戻す'` と `onAction` を渡す。
 */
export function notifyToast(message: string, options?: NotifyToastOptions): () => void {
  const id = nextId
  nextId += 1
  const duration = options?.duration ?? DEFAULT_DURATION
  items = [...items, {
    id,
    message,
    tone: options?.tone ?? 'success',
    actionLabel: options?.actionLabel,
    onAction: options?.onAction,
  }].slice(-MAX_ITEMS)
  emit()
  let timer: ReturnType<typeof setTimeout> | undefined
  if (duration > 0) {
    timer = setTimeout(() => dismissToast(id), duration)
  }
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    dismissToast(id)
  }
}

/** テスト用。溜まった知らせを全部消す。 */
export function clearToastsForTest(): void {
  items = []
  emit()
}

/**
 * 知らせ1件の見た目。置き場所（`ToastHost`）の外で単体に描くとき用
 * （見本・テスト）。ふだんは `notifyToast` を使う。
 */
export function Toast({
  item,
  onDismiss,
}: {
  item: Omit<ToastItem, 'id'> & { id?: number }
  onDismiss?: () => void
}) {
  const Icon = item.tone === 'success' ? CircleCheck : CircleAlert
  const dismiss = onDismiss ?? (item.id !== undefined ? () => dismissToast(item.id as number) : undefined)
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <Icon
        className={[styles.icon, item.tone === 'success' ? styles.iconSuccess : styles.iconError].join(' ')}
        aria-hidden="true"
        size={15}
      />
      <span className={styles.message}>{item.message}</span>
      {item.actionLabel && item.onAction ? (
        <button
          type="button"
          className={styles.undo}
          onClick={() => {
            item.onAction?.()
            dismiss?.()
          }}
        >
          {item.actionLabel}
        </button>
      ) : null}
      {dismiss ? <button type="button" className={styles.close} onClick={dismiss} aria-label="知らせを閉じる"><X aria-hidden="true" size={14} /></button> : null}
    </div>
  )
}

/**
 * 右下の置き場所。外枠（`app/layout.tsx`）に1つだけ置く。
 * 画面側は置かない。`notifyToast` で送られた分だけ出す。
 */
export default function ToastHost() {
  const live = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (live.length === 0) return null
  return (
    <div className={styles.host} aria-live="polite">
      {live.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  )
}
