import { describe, expect, it } from 'vitest'
import { mergeVisibleOrder, movableIds } from './reorder-utils'

/*
 * #1014 ATTR-03/04: 絞り込み中に見えている行だけを動かしても、
 * 隠れた行と動かせない行（共通項目・共有マーク）の位置を保つ。
 * 画面の楽観表示とサーバー保存で同じ考え方にするため、ここで固定する。
 */

const rows = (...ids: string[]) => ids.map((id) => ({ id }))

describe('mergeVisibleOrder', () => {
  it('絞り込みで隠れた行は元の位置に残る', () => {
    const all = rows('a', 'b', 'c', 'd')
    // b・d が見えている状態で d を b の前へ動かす
    const merged = mergeVisibleOrder(all, rows('d', 'b'))
    expect(merged.map((row) => row.id)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('pinned の行は位置が固定され、動かせる行が残りの位置を埋める', () => {
    const all = rows('a', 'pin', 'b', 'c')
    const merged = mergeVisibleOrder(all, rows('a', 'pin', 'c', 'b'), (row) => row.id === 'pin')
    expect(merged.map((row) => row.id)).toEqual(['a', 'pin', 'c', 'b'])
  })

  it('見えている順を変えない場合は全体の並びも変わらない', () => {
    const all = rows('a', 'b', 'c')
    const merged = mergeVisibleOrder(all, rows('a', 'b', 'c'))
    expect(merged.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('全体に無いIDが visibleAfter に混じっても壊れない', () => {
    const all = rows('a', 'b')
    const merged = mergeVisibleOrder(all, rows('ghost', 'a', 'b'))
    // ghost は all に無いので位置へ戻せない。a・b は指定順のまま残る。
    expect(merged.map((row) => row.id)).toEqual(['a', 'b'])
  })
})

describe('movableIds', () => {
  it('動かせる行だけのIDを新しい順で返す', () => {
    const merged = rows('pin', 'b', 'a')
    expect(movableIds(merged, (row) => row.id !== 'pin')).toEqual(['b', 'a'])
  })
})
