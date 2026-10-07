'use client'

import { useCallback, useMemo, useState } from 'react'
import { runUndoable } from './undoable'

/*
 * 消しても5秒は取り消せる削除（動きの点検 17 番）。
 *
 * 押した瞬間に一覧から行を隠し、知らせに「元に戻す」を出す。5秒たったら
 * はじめてサーバーへ削除を送る（`runUndoable`）。取り消したら送らずに行を戻す。
 * 送って失敗したら行を戻して失敗の知らせを出す。
 *
 * API は今のところ「すぐ消す」しか持たないので、待つのは画面の側。
 * そのため 5 秒の間にタブを閉じると削除は送られない（消えずに残る＝安全な側に倒れる）。
 *
 * 使うのは、消しても他へ影響が無いもの（使われていないテンプレート・友だちに付いていない
 * タグ・止まっている自動応答・下書きの配信など）。影響があるものは今までどおり確かめの窓。
 */
export type DeferredDelete = {
  /** 隠している（取り消し待ちの）行か。一覧はこれで行を外して描く。 */
  isHidden: (id: string) => boolean
  /** 隠している行の数（件数の表示を合わせるとき）。 */
  hiddenCount: number
  /** 行を隠して、5秒後に commit を送る。 */
  schedule: (options: {
    ids: readonly string[]
    /** 知らせの文（例「テンプレート「A」を削除しました」）。 */
    message: string
    /** 本当に消す。失敗は throw か { success: false }。 */
    commit: () => Promise<{ success: boolean; error?: string } | void>
    /** 消せた後の読み直し。終わってから隠した印を外す（行が一瞬戻らないように）。 */
    onCommitted?: () => Promise<unknown> | void
    failureMessage?: string
  }) => void
}

export function useDeferredDelete(): DeferredDelete {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())

  const show = useCallback((ids: readonly string[]) => {
    setHidden((current) => {
      const next = new Set(current)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])

  const schedule = useCallback<DeferredDelete['schedule']>((options) => {
    const ids = [...options.ids]
    setHidden((current) => new Set([...current, ...ids]))
    runUndoable({
      message: options.message,
      commit: options.commit,
      undo: () => show(ids),
      failureMessage: options.failureMessage,
      onCommitted: () => {
        void Promise.resolve()
          .then(() => options.onCommitted?.())
          .catch(() => undefined)
          .finally(() => show(ids))
      },
    })
  }, [show])

  const isHidden = useCallback((id: string) => hidden.has(id), [hidden])

  return useMemo(() => ({ isHidden, hiddenCount: hidden.size, schedule }), [isHidden, hidden, schedule])
}
