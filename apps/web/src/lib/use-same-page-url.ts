'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'

/*
 * 同じ画面の中で URL の ?step= ・?tab= などだけを書き換える口（2026-10-08 オーナー：
 * 統括の一括配信を作るで「次へ」を押すと「このサイトを離れますか？」が出る）。
 *
 * router.replace / router.push は、クエリだけの変更でも Next が RSC（`<path>.txt`）を
 * 取りに行く。検証環境は静的書き出しで、新しい版が出た後はその応答の版IDが手元と
 * 違うため、Next は画面を丸ごと読み直す（ハード遷移）。入力中の画面では離脱の確認が
 * 出て、閉じると段も進まない。ほかの画面でも全画面の待ちになる。
 *
 * 行き先が今と同じパスなら、ルーターを通さずブラウザの履歴だけを書き換える。
 * Next はこの書き換えを拾い、useSearchParams も新しい値になる（取得は起きない）。
 * 別のパスへ行くときは今までどおりルーターを使う。
 */
export interface SamePageUrl {
  /** 履歴を積まずに書き換える（段・タブの切り替え）。 */
  replace: (href: string) => void
  /** 履歴を積んで書き換える（戻るで前の状態へ戻したいとき）。 */
  push: (href: string) => void
}

/** 行き先が今と同じパスかどうか。href は '/a?b=1' でも '?b=1' でもよい。 */
export function isSamePagePath(href: string, current: Location = window.location): boolean {
  const target = new URL(href, current.href)
  return target.origin === current.origin && target.pathname === current.pathname
}

/** 同じパスなら履歴だけを書き換えて true。違うパスは何もせず false。 */
export function writeSamePageUrl(href: string, mode: 'replace' | 'push' = 'replace'): boolean {
  if (typeof window === 'undefined' || !isSamePagePath(href)) return false
  const target = new URL(href, window.location.href)
  const url = `${target.pathname}${target.search}${target.hash}`
  if (mode === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
  return true
}

export function useSamePageUrl(): SamePageUrl {
  const router = useRouter()
  return useMemo(() => ({
    replace: (href: string) => {
      if (!writeSamePageUrl(href, 'replace')) router.replace(href)
    },
    push: (href: string) => {
      if (!writeSamePageUrl(href, 'push')) router.push(href)
    },
  }), [router])
}
