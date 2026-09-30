'use client'

import { notifyToast } from '@/components/shared/toast'

/*
 * ★V7 sTJsh §1・§4「押したらすぐ反映」「確認の代わりに元に戻す」。
 *
 * - §4 消す系の操作（`runUndoable`）：画面からはすぐ消し、
 *   サーバーへは5秒後に送る。「元に戻す」で止めたら送らない。
 *   送信が失敗したら画面を元に戻して、やり直せる失敗の知らせを出す。
 * - §1 先に画面を変える軽い操作（`runOptimistic`）：表示は先に変えて
 *   すぐ送る。失敗したら元に戻して「もう一度」の知らせを出す。
 *
 * 取り消せない操作（配信を送る・支払い・予約を消す・友だちを消す・
 * 連携を切る）はここを通さず、従来どおり確認を残して返事を待つ。
 */

/** 「元に戻す」の猶予（toast の UNDO_DURATION と揃える）。 */
const UNDO_WINDOW_MS = 5000

type Commit = () => Promise<{ success: boolean; error?: string } | void> | void

/**
 * 画面側の変更を先に済ませたあと呼ぶ。`commit` は `UNDO_WINDOW_MS` 後に
 * 実行され、「元に戻す」または ⌘Z で止められる。
 *
 * `undo` は戻したときの画面の復元。`onCommitError` は送信失敗時の復元
 * （`undo` と同じ処理を渡せることが多い）。知らせの文は呼び出し側が
 * 運用者の言葉で渡す（例「3人から『VIP』を外しました」）。
 */
export function runUndoable(options: {
  message: string
  commit: Commit
  undo: () => void
  /** commit が失敗したときの画面の復元。省略すると undo を呼ぶ。 */
  onCommitError?: () => void
  /** 失敗の知らせの文面。 */
  failureMessage?: string
  /** commit が通ったあとに呼ぶ（一覧の読み直しなど）。 */
  onCommitted?: () => void
}): void {
  let undone = false
  const timer = setTimeout(() => {
    if (undone) return
    void Promise.resolve()
      .then(() => options.commit())
      .then((res) => {
        if (res && res.success === false) throw new Error(res.error ?? '')
        options.onCommitted?.()
      })
      .catch(() => {
        ;(options.onCommitError ?? options.undo)()
        notifyToast(options.failureMessage ?? 'できませんでした。もう一度お試しください。', { tone: 'error' })
      })
  }, UNDO_WINDOW_MS)

  notifyToast(options.message, {
    actionLabel: '元に戻す',
    onAction: () => {
      undone = true
      clearTimeout(timer)
      options.undo()
    },
  })
}

/**
 * 軽い操作を「押した瞬間」に画面へ反映し、裏で保存する（★V7 sTJsh §1）。
 *
 * `apply` で先に画面を変えてから呼ぶ。`request` が失敗したら `revert`
 * で戻し、「もう一度」で同じ操作をやり直せる知らせを出す。
 * 保存できたときは何も出さない（静かに終わる）。
 */
export function runOptimistic(options: {
  request: Commit
  revert: () => void
  /** 失敗の知らせの文面（例「タグを付けられませんでした」）。 */
  failureMessage: string
  /** 「もう一度」のやり直し。省略すると失敗の知らせは文だけ。 */
  retry?: () => void
  /** 保存が通ったあとに呼ぶ（一覧の読み直しなど）。 */
  onSuccess?: () => void
}): void {
  void Promise.resolve()
    .then(() => options.request())
    .then((res) => {
      if (res && res.success === false) throw new Error(res.error ?? '')
      options.onSuccess?.()
    })
    .catch(() => {
      options.revert()
      notifyToast(options.failureMessage, {
        tone: 'error',
        actionLabel: options.retry ? 'もう一度' : undefined,
        onAction: options.retry,
      })
    })
}
