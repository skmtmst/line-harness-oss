/*
 * 文字数の表示。
 *
 * 設計の「52 / 5,000」は桁区切りが入る。実行環境の既定ロケールに任せると
 * 端末で区切りが変わり、設計と突き合わせられない。ここで固定を見る。
 *
 * 上限の判定は保存操作の可否に効く。ここがずれると、送れない本文のまま
 * 保存を押せてしまう。
 */
import { describe, it, expect } from 'vitest'
import { LINE_TEXT_LIMIT, formatCharCount, isOverCharLimit } from './char-counter'

describe('文字数の表示', () => {
  it('設計と同じ「52 / 5,000」の形になる', () => {
    expect(formatCharCount(52)).toBe('52 / 5,000')
  })

  it('現在の数にも桁区切りが入る', () => {
    expect(formatCharCount(1234)).toBe('1,234 / 5,000')
  })

  it('上限はLINEのテキストメッセージに合わせて5,000字', () => {
    expect(LINE_TEXT_LIMIT).toBe(5000)
  })
})

describe('上限の判定', () => {
  it('ちょうど上限までは超過にしない', () => {
    expect(isOverCharLimit(5000)).toBe(false)
  })

  it('1字超えたら超過にする', () => {
    expect(isOverCharLimit(5001)).toBe(true)
  })

  it('空でも超過にしない', () => {
    expect(isOverCharLimit(0)).toBe(false)
  })
})
