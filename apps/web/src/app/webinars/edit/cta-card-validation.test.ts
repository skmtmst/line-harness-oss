import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import type { WebinarCtaCard } from '@/lib/api'
import { cardFieldProblems, parseMinSec } from '@/v8/webinar-edit/cta-validation'

const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/cta.tsx'), 'utf8')

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
    expect(cardFieldProblems(card(), '10:00', 3600)).toEqual({ time: null, title: null, button: null, link: null })
    expect(cardFieldProblems(card({ kind: 'form', formId: 'f1', url: null }), '600', 3600)).toEqual({ time: null, title: null, button: null, link: null })
    expect(parseMinSec('600')).toBe(600)
  })

  it('URLカードの未入力とhttpをそれぞれ直し方つきで示す', () => {
    expect(cardFieldProblems(card({ url: '' }), '10:00', 3600).link).toBe('https:// から始まる URL を入れてください')
    expect(cardFieldProblems(card({ url: 'http://example.com' }), '10:00', 3600).link).toBe('URL は https:// で始めてください（http は使えません）')
  })

  it('フォームカードの未選択を示す', () => {
    expect(cardFieldProblems(card({ kind: 'form', formId: null }), '10:00', 3600).link).toBe('公開中のフォームを選ぶか、種類を URL へ変えてください')
  })

  it('表示時間の不正と動画超過を示す', () => {
    expect(cardFieldProblems(card(), 'abc', 3600).time).toBe('出す時刻は 分:秒 で入れてください（例：45:00）')
    expect(cardFieldProblems(card(), '90:00', 3600).time).toBe('出す時刻が動画の長さ（60分）を超えています。動画の中の時刻に直してください')
  })

  it('タイトル・ボタン文言の空も示し、複数カードの不足をまとめて返す', () => {
    const problems = [card({ title: ' ' }), card({ buttonLabel: '' }), card({ url: '' })].map((item, i) => cardFieldProblems(item, `${i + 1}0:00`, 7200))
    expect(problems[0].title).toBe('カードの見出しを入れてください')
    expect(problems[1].button).toBe('ボタンに出す文字を入れてください')
    expect(problems[2].link).toBe('https:// から始まる URL を入れてください')
    expect(problems.every((item) => Object.values(item).some(Boolean))).toBe(true)
  })

  it('編集タブの保存はこのチェックを通してからAPIを呼ぶ', () => {
    // 関数だけ直して配線を忘れると、不足のまま保存されて公開前検証で初めて止まる。
    expect(PAGE).toContain('cardFieldProblems(card, times[i]')
    expect(PAGE).toContain('fields.define(`cta-${i}-link`')
    expect(PAGE.indexOf('if (fields.submit().length > 0)'))
      .toBeLessThan(PAGE.indexOf('webinarApi.saveCtas(webinarId, next)'))
  })
})
