import { describe, expect, it } from 'vitest'
import type { InlineAction } from '@/components/auto-replies/draft-fields'
import { chipName, choiceKindOptions, inlineActionsText, panelsFromContent } from './carousel'
import { buildCarouselContent, carouselChoiceProblems, choiceFromUri, emptyChoice, type Choice, type Panel } from './carousel-core'

describe('カルーセルを作る（J60utH）の札と動きの1行', () => {
  it('札の名前はタイトルの（）書きを外す', () => {
    expect(chipName('夏の定番セット（送料込み）')).toBe('夏の定番セット')
    expect(chipName('定期便')).toBe('定期便')
  })

  it('動きはタグの名前で、無ければ「何もしない（決める）」', () => {
    const tag = { key: 'k', actionType: 'tag', config: { op: 'add', tagIds: ['t1'] }, onFailure: 'continue' } as unknown as InlineAction
    expect(inlineActionsText([tag], [{ id: 't1', name: '夏セット興味' }])).toBe('タグ「夏セット興味」を付ける')
    expect(inlineActionsText([], [])).toBe('何もしない（決める）')
  })
})


/* ボタンの「押したら」（絵 JkLOF・2026-10-08）。 */
const LIFF = '1234567890-AbCdEf'
const panelWith = (actions: Choice[]): Panel => ({ thumbnailImageUrl: '', title: '', text: '本文', actions })
const choice = (patch: Partial<Choice>): Choice => ({ ...emptyChoice(), label: 'ボタン', ...patch })

describe('カルーセルのボタンの押したら（JkLOF）：保存の形', () => {
  it('動きごとに LINE のアクションの JSON になる', () => {
    const content = buildCarouselContent([panelWith([
      choice({ kind: 'uri', uri: ' https://nen.example/a ' }),
      choice({ kind: 'message', text: ' 予約したい ' }),
      choice({ kind: 'form', formId: 'form 1' }),
    ]), panelWith([
      choice({ kind: 'booking' }),
      choice({ kind: 'booking_history' }),
      choice({ kind: 'action' }),
    ])], 'tpl1', LIFF)
    const columns = JSON.parse(content) as Array<{ actions: unknown[] }>
    expect(columns[0].actions).toEqual([
      { type: 'uri', label: 'ボタン', uri: 'https://nen.example/a' },
      { type: 'message', label: 'ボタン', text: '予約したい' },
      { type: 'uri', label: 'ボタン', uri: `https://liff.line.me/${LIFF}/?page=form&id=form%201` },
    ])
    expect(columns[1].actions).toEqual([
      { type: 'uri', label: 'ボタン', uri: `https://liff.line.me/${LIFF}/?page=salon-book` },
      { type: 'uri', label: 'ボタン', uri: `https://liff.line.me/${LIFF}/?page=salon-book&view=history` },
      { type: 'postback', label: 'ボタン', data: 'ctpl=tpl1&c=1&a=2' },
    ])
  })

  it('保存したものを読み戻すと同じ動き・同じ中身に戻る', () => {
    const panels = [panelWith([
      choice({ kind: 'message', text: '予約したい' }),
      choice({ kind: 'form', formId: 'f-9' }),
      choice({ kind: 'booking_history' }),
    ]), panelWith([choice({ kind: 'booking' }), choice({ kind: 'uri', uri: 'https://nen.example/b' }), choice({ kind: 'action' })])]
    const back = panelsFromContent(buildCarouselContent(panels, 'tpl1', LIFF))
    expect(back.map((p) => p.actions.map((a) => [a.kind, a.uri, a.text, a.formId]))).toEqual([
      [['message', '', '予約したい', ''], ['form', '', '', 'f-9'], ['booking_history', '', '', '']],
      [['booking', '', '', ''], ['uri', 'https://nen.example/b', '', ''], ['action', '', '', '']],
    ])
  })

  it('古い保存（uri と postback だけ）はそのまま読める', () => {
    const old = JSON.stringify([{ text: '本文', actions: [
      { type: 'uri', label: '見る', uri: 'https://nen.example/set' },
      { type: 'postback', label: '詳しく', data: 'ctpl=t&c=0&a=1' },
    ] }])
    const [panel] = panelsFromContent(old, { 0: { 1: [] } })
    expect(panel.actions.map((a) => [a.label, a.kind, a.uri])).toEqual([['見る', 'uri', 'https://nen.example/set'], ['詳しく', 'action', '']])
  })

  it('{{liff_id}} の URL も LIFF のページとして読める。ほかの LIFF の URL・ふつうの URL は URL のまま', () => {
    expect(choiceFromUri('https://liff.line.me/{{liff_id}}/?page=form&id=abc')).toEqual({ kind: 'form', formId: 'abc' })
    expect(choiceFromUri('https://liff.line.me/1-x?page=salon-book&view=history')).toEqual({ kind: 'booking_history', formId: '' })
    expect(choiceFromUri('https://liff.line.me/1-x/?page=event&id=e1').kind).toBe('uri')
    expect(choiceFromUri('https://nen.example/?page=form&id=abc').kind).toBe('uri')
  })

  it('保存の前に止める：送る文が空・長すぎ・フォーム未選択・LIFF なし', () => {
    expect(carouselChoiceProblems([panelWith([choice({ kind: 'message', text: '' })])], LIFF)).toHaveLength(1)
    expect(carouselChoiceProblems([panelWith([choice({ kind: 'message', text: 'あ'.repeat(301) })])], LIFF)[0]).toContain('300文字まで')
    expect(carouselChoiceProblems([panelWith([choice({ kind: 'message', text: 'あ'.repeat(300) })])], LIFF)).toEqual([])
    expect(carouselChoiceProblems([panelWith([choice({ kind: 'form', formId: '' })])], LIFF)[0]).toContain('回答フォームを選んで')
    expect(carouselChoiceProblems([panelWith([choice({ kind: 'booking' })])], null)[0]).toContain('LIFF')
    expect(carouselChoiceProblems([panelWith([choice({ kind: 'booking' })])], LIFF)).toEqual([])
    // 文字の無いボタンは保存しないので見ない
    expect(carouselChoiceProblems([panelWith([choice({ label: '', kind: 'message', text: '' })])], null)).toEqual([])
  })
})

describe('カルーセルのボタンの押したら（JkLOF）：出す候補', () => {
  const values = (opts: Parameters<typeof choiceKindOptions>[0]) => choiceKindOptions(opts).map((item) => item.value)
  it('店（LIFF あり）は絵の順に6つ', () => {
    expect(values({ host: false, hasLiff: true })).toEqual(['uri', 'message', 'form', 'booking', 'booking_history', 'action'])
  })
  it('店（LIFF なし）は回答フォーム・予約・予約履歴を出さない', () => {
    expect(values({ host: false, hasLiff: false })).toEqual(['uri', 'message', 'action'])
  })
  it('統括は URL を開く・テキストを送るだけ（回答フォーム・予約・予約履歴・動きを実行するは出ない）', () => {
    expect(values({ host: true, hasLiff: true })).toEqual(['uri', 'message'])
  })
  it('いま選んでいる種類は候補から消さない（読み込んだ保存を壊さない）', () => {
    expect(values({ host: false, hasLiff: false, current: 'form' })).toContain('form')
  })
})
