/*
 * R234: Flex とカルーセルの「入っているが送れない」中身を止める。
 *
 * `{bad` のような壊れた JSON だけでなく、`{}`（形が無い）や `[{}]`
 * （空のパネル）も、保存・5段の帯・配信前検査で未完成にする。正常な
 * バブル・カルーセルは通し、保存と再読込を保つ。
 */
import { describe, it, expect } from 'vitest'
import { carouselColumnsProblem, flexContentProblem } from './bubble-content-check'

const BUBBLE = JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } })

describe('Flex の形', () => {
  it('空は未入力として止める', () => {
    expect(flexContentProblem('')).toBe('Flex JSONを入力してください')
  })

  it('壊れた JSON を止める', () => {
    expect(flexContentProblem('{bad')).toBe('Flex JSONを確認してください')
  })

  it('{}（形が無い）を止める（R234）', () => {
    expect(flexContentProblem('{}')).toBe('Flexはバブルかカルーセルの形にしてください')
  })

  it('バブルとカルーセルは通す', () => {
    expect(flexContentProblem(BUBBLE)).toBeNull()
    expect(flexContentProblem(JSON.stringify({ type: 'carousel', contents: [] }))).toBeNull()
  })
})

describe('カルーセルの中身', () => {
  it('空は未選択として止める', () => {
    expect(carouselColumnsProblem('')).toBe('カルーセルを選択してください')
    expect(carouselColumnsProblem('[]')).toBe('カルーセルを選択してください')
  })

  it('[{}]（空のパネル）を止める（R234）', () => {
    expect(carouselColumnsProblem('[{}]')).toContain('空のパネル')
  })

  it('パネルがそろっていれば通す', () => {
    expect(carouselColumnsProblem(JSON.stringify([{ title: '春', text: '本文' }]))).toBeNull()
  })
})
