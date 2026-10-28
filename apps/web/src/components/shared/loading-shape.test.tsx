import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ListSkeleton } from './skeleton'

/** 読み込み中の形は型ごとに1つ。出てきた時に形が大きく変わらないように、本物と同じ並びの骨組みを出す。 */
describe('読み込み中の形はその画面の形', () => {
  it('予約の盤は見出しの段と時刻の列を持つ時間の表の枠', () => {
    const html = renderToStaticMarkup(<ListSkeleton shape="board" />)
    expect(html).toContain('data-skeleton-shape="board"')
    expect(html).toContain('aria-hidden="true"')
  })
})
