'use client'

import { useEffect } from 'react'

/** globals.css の表の行の登場の動き（v8-content-in）。 */
const ROW_ENTRANCE = 'v8-content-in'

/**
 * 読み込み中・空・失敗の行（TableStateRow・骨組み）は「最初の中身」ではない。
 * これらの登場で済みにすると、続いて載る本当の行が順番出しされない。
 */
function isPlaceholderRow(row: HTMLTableRowElement): boolean {
  return Boolean(row.querySelector('[data-skeleton], [role="status"], [role="alert"]'))
}

/**
 * まだ出ている途中の行があるか。ブラウザでは行ごとの動きの状態を見る
 * （消える行・途中で数が変わっても取りこぼさない）。動きの API が無い環境
 * （試験の偽 DOM）では、最後の行の終わりを全部の終わりとみなす。
 */
function rowsStillEntering(body: HTMLTableSectionElement, ended: HTMLTableRowElement): boolean {
  const rows = Array.from(body.children)
  if (rows.every((row) => typeof (row as Element & { getAnimations?: unknown }).getAnimations === 'function')) {
    return rows.some((row) =>
      row !== ended
      && row.getAnimations().some((animation) =>
        (animation as Animation & { animationName?: string }).animationName === ROW_ENTRANCE
        && animation.playState !== 'finished'),
    )
  }
  return body.lastElementChild !== ended
}

/**
 * 表の行の順番出しが最後の行まで終わったら、その tbody を「済み」にする。
 * 済みの tbody では、後から載った行（読み直し・追加・タブの載せ替え）を出し直さない
 * （提案 F：行の順番出しは初回だけ・頻繁な更新では出さない）。
 * 最後の行がいちばん遅く終わる（4 行目以降は同じ遅れ）ので、最後の行の終わりで付ける。
 * 途中の行で付けると、まだ出ている途中の行の動きが切れる。
 */
export function settleRowEntrance(event: Pick<AnimationEvent, 'animationName' | 'target'>): boolean {
  if (event.animationName !== ROW_ENTRANCE) return false
  const row = event.target
  if (!(row instanceof HTMLTableRowElement)) return false
  const body = row.parentElement
  if (!(body instanceof HTMLTableSectionElement) || body.tagName !== 'TBODY') return false
  if (body.hasAttribute('data-rows-settled')) return false
  if (isPlaceholderRow(row)) return false
  if (rowsStillEntering(body, row)) return false
  body.setAttribute('data-rows-settled', '')
  return true
}

/** 外枠（app-shell）に1つだけ置く。どの画面の表にも効く。 */
export default function RowEntranceSettle() {
  useEffect(() => {
    const onEnd = (event: AnimationEvent) => {
      settleRowEntrance(event)
    }
    document.addEventListener('animationend', onEnd, true)
    return () => document.removeEventListener('animationend', onEnd, true)
  }, [])
  return null
}
