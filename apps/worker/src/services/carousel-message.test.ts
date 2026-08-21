/*
 * カルーセルの組み立て。
 *
 * これは**壊れていたものの修理**。カルーセルの中身は columns の配列で、
 * Flex が要求するのは bubble か carousel の**オブジェクト**。これまでは
 * carousel を flex に寄せていたので、配列をそのまま Flex の contents に
 * 入れて送っていた。
 *
 * LINE はそれを 400 で返す。400 は永続エラー扱いなので、
 * `pauseFriendScenarioDelivery` が走り、**その人の購読ごと止まる**。
 * カルーセルのテンプレートを選んだ通に当たった人が、そこから先ずっと
 * 何も受け取れなくなる、という壊れ方だった。
 */
import { describe, it, expect } from 'vitest'
import { buildMessage } from './step-delivery.js'

const COLUMNS = [
  {
    thumbnailImageUrl: 'https://e.com/1.jpg',
    title: '然-NEN- チキン',
    text: '国産のむね肉だけを使っています',
    actions: [{ type: 'uri', label: '見る', uri: 'https://e.com/a' }],
  },
  {
    title: '然-NEN- ビーフ',
    text: '赤身のみ',
    actions: [{ type: 'uri', label: '見る', uri: 'https://e.com/b' }],
  },
]

describe('カルーセル', () => {
  it('template メッセージとして組み立てる（Flex ではない）', () => {
    const out = buildMessage('carousel', JSON.stringify(COLUMNS)) as {
      type: string
      altText: string
      template: { type: string; columns: unknown[] }
    }
    expect(out.type).toBe('template')
    expect(out.template.type).toBe('carousel')
    expect(out.template.columns).toHaveLength(2)
  })

  it('Flex にはしない（配列を contents に入れると LINE が 400 を返す）', () => {
    const out = buildMessage('carousel', JSON.stringify(COLUMNS)) as { type: string }
    expect(out.type).not.toBe('flex')
  })

  it('通知欄の文は1枚目の題を使う', () => {
    const out = buildMessage('carousel', JSON.stringify(COLUMNS)) as { altText: string }
    expect(out.altText).toBe('然-NEN- チキン')
  })

  it('題が無ければ本文を使う', () => {
    const columns = [{ text: '国産のむね肉', actions: [] }]
    const out = buildMessage('carousel', JSON.stringify(columns)) as { altText: string }
    expect(out.altText).toBe('国産のむね肉')
  })

  it('題も本文も無ければ既定の文字を出す（通知が空にならないように）', () => {
    const out = buildMessage('carousel', JSON.stringify([{ actions: [] }])) as { altText: string }
    expect(out.altText).toBe('カルーセル')
  })

  it('空の配列はテキストに落とす', () => {
    expect(buildMessage('carousel', '[]')).toEqual({ type: 'text', text: '[]' })
  })

  it('配列でなければテキストに落とす', () => {
    const raw = JSON.stringify({ columns: COLUMNS })
    expect(buildMessage('carousel', raw)).toEqual({ type: 'text', text: raw })
  })

  it('壊れたJSONでもテキストに落ちる（例外にしない）', () => {
    expect(buildMessage('carousel', '{こわれ')).toEqual({ type: 'text', text: '{こわれ' })
  })
})

describe('Flex を壊していない', () => {
  it('本物の Flex はこれまでどおり', () => {
    const bubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } }
    const out = buildMessage('flex', JSON.stringify(bubble)) as { type: string }
    expect(out.type).toBe('flex')
  })
})
