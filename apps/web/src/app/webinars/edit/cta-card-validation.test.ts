import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import type { WebinarCtaCard } from '@/lib/api'
import { ctaCardProblems } from './cta-card-validation'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

function parseMinSec(v: string): number | null {
  const m = /^(\d+):([0-5]?\d)$/.exec(v.trim())
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(v.trim())
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

const card = (over: Partial<WebinarCtaCard> = {}): WebinarCtaCard => ({
  atSeconds: 0,
  kind: 'url',
  title: '申込案内',
  body: null,
  buttonLabel: '申し込む',
  autoOpen: false,
  formId: null,
  url: 'https://example.com/apply',
  ...over,
})

describe('CTAカードの保存前チェック (N-119)', () => {
  it('不足の無いカードはそのまま通る', () => {
    expect(ctaCardProblems([card()], ['10:00'], 3600, parseMinSec)).toEqual([])
    expect(ctaCardProblems([card({ kind: 'form', formId: 'f1', url: null })], ['600'], 3600, parseMinSec)).toEqual([])
  })

  it('URLカードの未入力とhttpをそれぞれ直し方つきで示す', () => {
    expect(ctaCardProblems([card({ url: '' })], ['10:00'], 3600, parseMinSec)).toEqual([
      '1枚目: URLが未入力です。https:// から始まるURLを入れてください',
    ])
    expect(ctaCardProblems([card({ url: 'http://example.com' })], ['10:00'], 3600, parseMinSec)).toEqual([
      '1枚目: URLは https:// で始めてください（httpは使えません）',
    ])
  })

  it('フォームカードの未選択を示す', () => {
    expect(ctaCardProblems([card({ kind: 'form', formId: null })], ['10:00'], 3600, parseMinSec)).toEqual([
      '1枚目: フォームが選ばれていません。公開中のフォームを選ぶか、種類をURLへ変えてください',
    ])
  })

  it('表示時間の不正と動画超過を示す', () => {
    expect(ctaCardProblems([card()], ['abc'], 3600, parseMinSec)).toEqual([
      '1枚目: 表示時間が不正です（例: 45:00 または秒数）',
    ])
    expect(ctaCardProblems([card()], ['90:00'], 3600, parseMinSec)).toEqual([
      '1枚目: 表示時間が動画の長さ（60分）を超えています。動画の中の時刻に直してください',
    ])
  })

  it('タイトル・ボタン文言の空も示し、複数カードの不足をまとめて返す', () => {
    const problems = ctaCardProblems(
      [card({ title: ' ' }), card({ buttonLabel: '' }), card({ url: '' })],
      ['10:00', '20:00', '30:00'],
      7200,
      parseMinSec,
    )
    expect(problems).toEqual([
      '1枚目: タイトルが空です。カードの見出しを入れてください',
      '2枚目: ボタンの文言が空です。ボタンに出す文字を入れてください',
      '3枚目: URLが未入力です。https:// から始まるURLを入れてください',
    ])
  })

  it('編集タブの保存はこのチェックを通してからAPIを呼ぶ', () => {
    // 関数だけ直して配線を忘れると、不足のまま保存されて公開前検証で初めて止まる。
    expect(PAGE).toContain('ctaCardProblems(ctas, times, durationSeconds, parseMinSec)')
    expect(PAGE.indexOf('ctaCardProblems(ctas, times, durationSeconds, parseMinSec)'))
      .toBeLessThan(PAGE.indexOf('webinarApi.saveCtas(webinarId, sorted)'))
  })
})
