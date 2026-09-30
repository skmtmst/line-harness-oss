'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import styles from './toast.module.css'

/** 知らせの種類。白地に印の色で分ける（緑=うまくいった、赤=できなかった）。 */
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
  /** 4秒で消える。「元に戻す」付きは5秒。0以下で消さない（長押しの確認待ちなど）。 */
  duration?: number
  actionLabel?: string
  onAction?: () => void
}

const DEFAULT_DURATION = 4000
/*
 * ★V7 sTJsh §4:「元に戻す」は5秒。乗せている間は時間を止める。
 * ⌘Z でも戻せる（ToastHost が受け持つ）。
 */
const UNDO_DURATION = 5000
const MAX_ITEMS = 3

let nextId = 1
let items: ToastItem[] = []
const listeners = new Set<() => void>()

/*
 * 各知らせの残り時間。マウスを乗せている間は止める。
 * `timer` が止まっている間は `remaining` だけが残る。
 */
type Countdown = { remaining: number; deadline: number; timer: ReturnType<typeof setTimeout> | null }
const countdowns = new Map<number, Countdown>()

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

function scheduleDismiss(id: number, ms: number): void {
  const entry: Countdown = { remaining: ms, deadline: Date.now() + ms, timer: null }
  entry.timer = setTimeout(() => dismissToast(id), ms)
  countdowns.set(id, entry)
}

export function dismissToast(id: number): void {
  const entry = countdowns.get(id)
  if (entry?.timer) clearTimeout(entry.timer)
  countdowns.delete(id)
  const before = items.length
  items = items.filter((item) => item.id !== id)
  if (items.length !== before) emit()
}

/** 乗せている間は消えるまでの時間を止める（★V7 sTJsh §4）。 */
function pauseToast(id: number): void {
  const entry = countdowns.get(id)
  if (!entry || entry.timer === null) return
  clearTimeout(entry.timer)
  entry.timer = null
  entry.remaining = Math.max(0, entry.deadline - Date.now())
}

function resumeToast(id: number): void {
  const entry = countdowns.get(id)
  if (!entry || entry.timer !== null) return
  entry.deadline = Date.now() + entry.remaining
  entry.timer = setTimeout(() => dismissToast(id), entry.remaining)
}

/**
 * 保存の知らせを右下に出す。「保存しました」「削除しました」など、
 * 画面の中に文で出していた知らせはここへ送る。4秒で消える。
 * 「元に戻す」を付けた知らせは5秒残る。
 *
 * 返す関数を呼ぶとすぐに消せる。取り消せる操作は
 * `actionLabel: '元に戻す'` と `onAction` を渡す。
 */
export function notifyToast(message: string, options?: NotifyToastOptions): () => void {
  const id = nextId
  nextId += 1
  /*
   * 「元に戻す」付きの知らせは5秒（★V7 sTJsh §4）。押す間が要るので
   * 通常の4秒より長い。duration を明示したらそちらが勝つ。
   */
  const duration = options?.duration ?? (options?.actionLabel ? UNDO_DURATION : DEFAULT_DURATION)
  const next = [
    ...items,
    {
      id,
      message,
      tone: options?.tone ?? 'success',
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    },
  ]
  // 表示数を超えて押し出された知らせの残り時間タイマーも止める
  for (const dropped of next.slice(0, Math.max(0, next.length - MAX_ITEMS))) {
    const entry = countdowns.get(dropped.id)
    if (entry?.timer) clearTimeout(entry.timer)
    countdowns.delete(dropped.id)
  }
  items = next.slice(-MAX_ITEMS)
  emit()
  if (duration > 0) scheduleDismiss(id, duration)
  return () => dismissToast(id)
}

/** テスト用。溜まった知らせを全部消す。 */
export function clearToastsForTest(): void {
  for (const id of countdowns.keys()) {
    const entry = countdowns.get(id)
    if (entry?.timer) clearTimeout(entry.timer)
  }
  countdowns.clear()
  items = []
  emit()
}

/** 直前の「元に戻す」を実行する（⌘Z）。戻せる知らせが無いとき何もしない。 */
export function undoLatestToast(): boolean {
  const target = [...items].reverse().find((item) => item.actionLabel && item.onAction)
  if (!target) return false
  target.onAction?.()
  dismissToast(target.id)
  return true
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
    <div
      className={styles.toast}
      role="status"
      aria-live="polite"
      onPointerEnter={item.id !== undefined ? () => pauseToast(item.id as number) : undefined}
      onPointerLeave={item.id !== undefined ? () => resumeToast(item.id as number) : undefined}
    >
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

/** 入力欄の中では ⌘Z は文字の取り消しに使うので、知らせの取り消しはしない。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 右下の置き場所。外枠（`app/layout.tsx`）に1つだけ置く。
 * 画面側は置かない。`notifyToast` で送られた分だけ出す。
 * ⌘Z で直前の「元に戻す」を実行する（★V7 sTJsh §4）。
 */
export default function ToastHost() {
  const live = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'z' || (!event.metaKey && !event.ctrlKey) || event.shiftKey) return
      if (isEditableTarget(event.target)) return
      if (undoLatestToast()) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  if (live.length === 0) return null
  return (
    <div className={styles.host} aria-live="polite">
      {live.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  )
}
