import { describe, expect, it } from 'vitest'
import {
  MAX_BUBBLES,
  MAX_TEXT_LENGTH,
  messageLengthLabel,
  messageLengthNotice,
  SPLIT_HINT_LENGTH,
} from './message-limits'

describe('本文の上限', () => {
  it('設計どおり1通5,000文字にする', () => {
    // 前は500文字で、設計どおりの配信がそもそも書けなかった。
    expect(MAX_TEXT_LENGTH).toBe(5000)
    expect(SPLIT_HINT_LENGTH).toBe(4500)
  })

  it('吹き出しはWorkerが受け取れる数までにする', () => {
    // `routes/broadcasts.ts:494,679` が 3 を超えると400を返す。
    // 画面だけ5通に上げると、書けるのに保存で失敗する。
    expect(MAX_BUBBLES).toBe(3)
  })

  it('帯には上限を添えて出す', () => {
    expect(messageLengthLabel(238)).toBe('238 / 5,000')
    // 取得できた0は0のまま。
    expect(messageLengthLabel(0)).toBe('0 / 5,000')
  })
})

describe('本文の長さの知らせ', () => {
  it('収まっていれば合計と通数を言う', () => {
    const notice = messageLengthNotice({ longest: 238, total: 400, bubbles: 2 })
    expect(notice.tone).toBe('ok')
    expect(notice.description).toContain('400文字')
    expect(notice.description).toContain('2通')
  })

  it('分けたほうがよい長さを、送れない長さと別に言う', () => {
    // 4,500〜5,000 は送れるが読みにくい。ここを言わないと、
    // 「問題ありません」と「超えています」の2つしかなくなる。
    const hint = messageLengthNotice({ longest: 4600, total: 4600, bubbles: 1 })
    expect(hint.tone).toBe('hint')
    expect(hint.title).toContain('分ける')

    const error = messageLengthNotice({ longest: 5001, total: 5001, bubbles: 1 })
    expect(error.tone).toBe('error')
    expect(error.description).toContain('5,000文字まで')
  })

  it('境目でちょうど切り替わる', () => {
    expect(messageLengthNotice({ longest: 4500, total: 4500, bubbles: 1 }).tone).toBe('ok')
    expect(messageLengthNotice({ longest: 4501, total: 4501, bubbles: 1 }).tone).toBe('hint')
    expect(messageLengthNotice({ longest: 5000, total: 5000, bubbles: 1 }).tone).toBe('hint')
    expect(messageLengthNotice({ longest: 5001, total: 5001, bubbles: 1 }).tone).toBe('error')
  })
})
