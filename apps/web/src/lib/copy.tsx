'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * コピーの手応え（★V7 §11）。
 *
 * 押すと印が 1.2 秒だけ ✓ に変わる。知らせ（Toast）は出さない。
 * 読み上げは「コピーしました」——`CopyAnnounce` をボタンの隣に置く。
 *
 * 使い方:
 *   const { copied, copy } = useCopy()
 *   <Button done={copied('url')} doneLabel="コピーしました" onClick={() => void copy(url)}>
 *     URLをコピー
 *   </Button>
 *   <CopyAnnounce show={copied('url')} />
 *
 * `copy` は成功したかを返す。失敗時（非HTTPS・権限拒否）の見せ方は
 * 画面ごとに違う（読み取り専用欄を出す等）ので、呼び出し側が持つ。
 */

/** 手応えを出す長さ（★V7：約1.2秒）。Button の done 点滅と同じ。 */
export const COPY_FEEDBACK_MS = 1200

export function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  /** 一覧では `id` に行の識別子を渡す（規定はコピーした値そのもの）。 */
  const copy = useCallback(async (value: string, id: string = value) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return false
    }
    setCopiedId(id)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopiedId(null), COPY_FEEDBACK_MS)
    return true
  }, [])

  /** `copy(value)` で写した直後か。コピー対象が1つなら引数なしで使える。 */
  const copied = useCallback(
    (id?: string) => copiedId !== null && (id === undefined || copiedId === id),
    [copiedId],
  )

  /** 写した対象が替わったとき（鍵の再発行など）に手応えを消す。 */
  const reset = useCallback(() => {
    setCopiedId(null)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return { copy, copied, reset }
}

/**
 * 読み上げの手応え。表示は何もせず、写した瞬間だけ支援技術へ
 * 「コピーしました」と届ける。ボタンの隣に1つ置く。
 */
export function CopyAnnounce({ show }: { show: boolean }) {
  return (
    <span role="status" className="sr-only">
      {show ? 'コピーしました' : ''}
    </span>
  )
}
