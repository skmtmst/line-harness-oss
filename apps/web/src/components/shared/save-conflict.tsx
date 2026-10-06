'use client'

import { useCallback, useRef, useState } from 'react'
import { GitCompare, RefreshCw, TriangleAlert } from 'lucide-react'
import Button from './button'
import Dialog from './dialog'
import { formatDateTime } from '@/lib/format'
import styles from './save-conflict.module.css'

/*
 * 保存がぶつかったとき（409）の道（動きの点検 16 番）。
 *
 * ほかの人が先に保存していたら、入力は捨てずに帯を出し、
 * 「違いを比べる」（最新を取って比べるだけ・画面は書き換えない）と
 * 「最新を読み込んで続ける」（自分の直しを捨てて最新から続ける）を選んでもらう。
 * 回答フォームの編集（J1pdB）の作りを共通にしたもの。リマインダの作る・編集（k32cn）でも使う。
 *
 * 使い方：
 *   const conflict = useSaveConflict({ fetchLatest, reload })
 *   保存で 409 が返ったら conflict.mark(updatedAt)
 *   帯：<SaveConflictBand title=… compareBusy={conflict.compareBusy} onCompare={conflict.compare} onReload={conflict.reloadLatest} />
 *   窓：<SaveConflictCompareDialog open={conflict.compareOpen} … lines={conflict.latest ? 違いの行 : null} />
 */

/** 帯の下の文（既定）。 */
export const SAVE_CONFLICT_DESCRIPTION = 'あなたが直した所はまだ保存されていません。このまま保存すると、相手の変更が消えます。'
const FETCH_FAILED = '最新の内容を取れませんでした。もう一度お試しください。'

/**
 * 帯の題。だれが保存したかは返事に無いので「ほかの人」と言う。
 * 時刻が読めないときは時刻を言わない（嘘の時刻を出さない）。
 * 例：saveConflictTitle('2026-10-07T05:02:00Z', 'リマインダ', '予約前日のご案内')
 *   →「ほかの人が 2026/10/07 14:02 にリマインダ「予約前日のご案内」を保存しました」
 */
export function saveConflictTitle(updatedAt: string, kind: string, name: string): string {
  const parsed = updatedAt ? new Date(updatedAt) : null
  const when = parsed && !Number.isNaN(parsed.getTime()) ? formatDateTime(parsed) : ''
  const subject = name.trim() ? `${kind}「${name.trim()}」` : `この${kind}`
  return when ? `ほかの人が ${when} に${subject}を保存しました` : `ほかの人が先に${subject}を保存しました`
}

/** 比べる窓に出す違いの1行。add=最新で増えた、remove=最新で消えた、change=変わった。 */
export type SaveConflictDiffLine = { text: string; kind?: 'add' | 'remove' | 'change' }

export type SaveConflictState<T> = {
  /** ぶつかっているか。updatedAt は相手が保存した時刻（分からなければ空）。 */
  conflict: { updatedAt: string } | null
  /** 保存で 409 が返ったときに呼ぶ。 */
  mark: (updatedAt?: string) => void
  /** 読み直したときなどに帯を消す。 */
  clear: () => void
  /** 「違いを比べる」で取った最新。比べる窓の中身に使う。 */
  latest: T | null
  compareOpen: boolean
  compareBusy: boolean
  compareError: string
  /** 「違いを比べる」。最新を取って窓を開くだけで、画面は書き換えない。 */
  compare: () => Promise<void>
  closeCompare: () => void
  /** 「最新を読み込んで続ける」。窓を閉じ、最新を読み直す。 */
  reloadLatest: () => Promise<void>
}

export function useSaveConflict<T>(options: {
  /** 最新を取る。取れなければ null（窓に「取れませんでした」を出す）。 */
  fetchLatest: () => Promise<T | null>
  /** 最新を読み直して画面に入れる。読み直せたら帯は消す（clear を呼ぶ）。 */
  reload: () => Promise<unknown> | void
}): SaveConflictState<T> {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [conflict, setConflict] = useState<{ updatedAt: string } | null>(null)
  const [latest, setLatest] = useState<T | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  const busyRef = useRef(false)

  const mark = useCallback((updatedAt = '') => setConflict({ updatedAt }), [])
  const closeCompare = useCallback(() => {
    setLatest(null)
    setCompareError('')
  }, [])
  const clear = useCallback(() => {
    setConflict(null)
    setLatest(null)
    setCompareError('')
  }, [])

  const compare = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setCompareBusy(true)
    setCompareError('')
    try {
      const next = await optionsRef.current.fetchLatest()
      if (next === null) setCompareError(FETCH_FAILED)
      else setLatest(next)
    } catch {
      setCompareError(FETCH_FAILED)
    } finally {
      busyRef.current = false
      setCompareBusy(false)
    }
  }, [])

  const reloadLatest = useCallback(async () => {
    setLatest(null)
    setCompareError('')
    await optionsRef.current.reload()
  }, [])

  return {
    conflict,
    mark,
    clear,
    latest,
    compareOpen: latest !== null || compareError !== '',
    compareBusy,
    compareError,
    compare,
    closeCompare,
    reloadLatest,
  }
}

/** ぶつかったことを知らせる帯。読み上げは role=alert（すぐ伝える）。 */
export function SaveConflictBand({
  title,
  description = SAVE_CONFLICT_DESCRIPTION,
  compareBusy = false,
  onCompare,
  onReload,
  designNode,
}: {
  title: string
  description?: string
  compareBusy?: boolean
  onCompare: () => void
  onReload: () => void
  /** 絵の板の印（J1pdB・k32cn など）。 */
  designNode?: string
}) {
  return (
    <div className={styles.band} role="alert" data-design-node={designNode} data-save-conflict="">
      <TriangleAlert aria-hidden="true" className={styles.icon} />
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.desc}>{description}</span>
      </span>
      <Button onClick={onCompare} disabled={compareBusy} busy={compareBusy} busyLabel="比べています…">
        <GitCompare aria-hidden="true" className={styles.buttonIcon} />
        違いを比べる
      </Button>
      <Button variant="primary" onClick={onReload}>
        <RefreshCw aria-hidden="true" className={styles.buttonIcon} />
        最新を読み込んで続ける
      </Button>
    </div>
  )
}

/**
 * 「違いを比べる」の窓。自分の下書きと相手が保存した最新の違いを並べる。
 * lines が null の間（取れなかったとき）は中身を出さず、error を出す。
 */
export function SaveConflictCompareDialog({
  open,
  busy = false,
  error,
  lines,
  omitted = 0,
  onReload,
  onCancel,
}: {
  open: boolean
  busy?: boolean
  error?: string
  lines: SaveConflictDiffLine[] | null
  /** 出しきれなかった違いの数。 */
  omitted?: number
  onReload: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      title="最新の保存と比べる"
      description="あなたの下書きと、相手が保存した最新の内容の違いです。読み込むまでは画面は変わりません。"
      confirmLabel="最新を読み込んで続ける"
      busy={busy}
      error={error || undefined}
      onConfirm={onReload}
      onCancel={onCancel}
    >
      {lines === null ? null : lines.length === 0 ? (
        <p className={styles.changeLine}>違いは見つかりませんでした。そのまま読み込めます。</p>
      ) : (
        <div className={styles.changes} data-save-conflict-changes="">
          {lines.map((line, index) => (
            <p key={index} className={styles.changeLine} data-kind={line.kind ?? 'change'}>
              {line.kind === 'remove' ? '－ ' : line.kind === 'add' ? '＋ ' : '・ '}
              {line.text}
            </p>
          ))}
          {omitted > 0 ? <p className={styles.changeLine}>ほか{omitted}件の違いがあります</p> : null}
        </div>
      )}
    </Dialog>
  )
}
