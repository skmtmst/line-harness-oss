'use client'

import { useCallback, useState } from 'react'

/**
 * 行を消すときの合図（★V8 仕上げ3回目 ④）。
 *
 * 削除が決まってから `fadeOut` で行に `data-leaving` を付け、
 * 150ms（--motion-exit）待って薄くしてから呼び出し側が読み直す。
 * 読み直しで消えた行は DOM から外れる。失敗したら呼ばない
 * （行は残る）。動きを減らす設定・サーバ描画では待たない。
 *
 * 使い方は各一覧の削除の確定処理だけ。M4 の残り機能と重ならないよう、
 * 一斉配信・テンプレート・自動応答・リマインダ・シナリオが使う。
 */
export function useRowLeaving() {
  const [leavingIds, setLeavingIds] = useState<readonly string[]>([])

  const fadeOut = useCallback(async (ids: readonly string[], reload: () => Promise<unknown>): Promise<void> => {
    setLeavingIds(ids)
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduce) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 150)
      })
    }
    try {
      await reload()
    } finally {
      setLeavingIds([])
    }
  }, [])

  const isLeaving = useCallback((id: string): boolean => leavingIds.includes(id), [leavingIds])

  return { leavingIds, isLeaving, fadeOut }
}
