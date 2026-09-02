/*
 * 一覧に出す要約。
 *
 * 一覧は**送ったあとに確かめる**ための画面でもある。ここが違うものを
 * 出していると、確かめたつもりで確かめられていない。しかも間違いに
 * 気づく手がかりが画面のどこにも無い。
 */
import { describe, it, expect } from 'vitest'
import { messageTypeLabel, contentExcerpt, audienceSummary } from './broadcast-summary'

describe('送るものの種別', () => {
  it('種別ごとの名前を出す', () => {
    expect(messageTypeLabel('sticker')).toBe('スタンプ')
    expect(messageTypeLabel('carousel')).toBe('カルーセル')
    expect(messageTypeLabel('flex')).toBe('カード型')
    expect(messageTypeLabel('location')).toBe('位置情報')
  })

  it('知らない種別を「Flex」と言い張らない', () => {
    // 前は text / image 以外をすべて「Flex」と出していた。
    expect(messageTypeLabel('unknown_kind')).toBe('unknown_kind')
  })
})

describe('本文の抜粋', () => {
  it('テキストはそのまま（改行はつめる）', () => {
    expect(contentExcerpt('text', '本日は\nありがとうございます')).toBe('本日は ありがとうございます')
  })

  it('長い本文は切る', () => {
    expect(contentExcerpt('text', 'あ'.repeat(60), 10)).toBe(`${'あ'.repeat(10)}…`)
  })

  it('JSONの種別は、そのままJSONを出さない', () => {
    // `{"packageId":"446",…}` が一覧に並ぶと読めない。
    const out = contentExcerpt('sticker', JSON.stringify({ packageId: '446', stickerId: '1988' }))
    expect(out).toBe('スタンプ 446-1988')
    expect(out).not.toContain('{')
  })

  it('位置情報は名前と住所', () => {
    expect(contentExcerpt('location', JSON.stringify({ title: '店舗', address: '東京都渋谷区' })))
      .toBe('店舗 / 東京都渋谷区')
  })

  it('音声はミリ秒を秒にする', () => {
    expect(contentExcerpt('audio', JSON.stringify({ originalContentUrl: 'x', duration: 12000 })))
      .toBe('音声 12秒')
  })

  it('カルーセルは1枚目の題と枚数', () => {
    const columns = JSON.stringify([{ title: '然-NEN- チキン' }, { title: 'ビーフ' }])
    expect(contentExcerpt('carousel', columns)).toBe('然-NEN- チキン（2枚）')
  })

  it('Flex は最初の文字列を拾う', () => {
    const flex = JSON.stringify({ type: 'bubble', body: { type: 'box', contents: [{ type: 'text', text: 'こんにちは' }] } })
    expect(contentExcerpt('flex', flex)).toBe('こんにちは')
  })

  it('壊れたJSONでも一覧を壊さない', () => {
    expect(contentExcerpt('sticker', '{こわれ')).toBe('スタンプ')
  })

  it('空なら空', () => {
    expect(contentExcerpt('text', '   ')).toBe('')
  })
})

describe('宛先の要約', () => {
  const names: Record<string, string> = { t1: 'VIP', s1: '初回フォロー' }
  const tagName = (id: string) => names[id] ?? null

  it('全員', () => {
    expect(audienceSummary({ targetType: 'all' }, tagName)).toBe('友だち全員')
  })

  it('タグ', () => {
    expect(audienceSummary({ targetType: 'tag', targetTagId: 't1' }, tagName)).toBe('タグ：VIP')
  })

  it('消えたタグでも壊れない', () => {
    expect(audienceSummary({ targetType: 'tag', targetTagId: 'gone' }, tagName)).toBe('タグ（削除済み）')
  })

  it('詳細条件を「タグ指定」と言い張らない', () => {
    // 前は targetType が all 以外なら全部「タグ指定」と出ていた。
    const out = audienceSummary({
      targetType: 'segment',
      segmentConditions: {
        operator: 'AND',
        rules: [
          { type: 'is_following', value: true },
          { type: 'registered_at', value: { from: '2026-01-01', to: '' } },
          { type: 'reaction_state', value: 'reply' },
        ],
      },
    }, tagName)
    expect(out).toBe('詳細条件 2 件')
  })

  it('ブロック中を外す条件は数に入れない（どの配信にも付くため）', () => {
    // 入れてしまうと、全員宛の配信まで「詳細条件 1件」と出る。
    expect(audienceSummary({
      targetType: 'segment',
      segmentConditions: { operator: 'AND', rules: [{ type: 'is_following', value: true }] },
    }, tagName)).toBe('友だち全員')
  })

  it('よく使う形は言葉にする', () => {
    expect(audienceSummary({
      targetType: 'segment',
      segmentConditions: {
        operator: 'AND',
        rules: [{ type: 'is_following', value: true }, { type: 'tag_exists', value: 't1' }],
      },
    }, tagName)).toBe('タグ：VIP')

    expect(audienceSummary({
      targetType: 'segment',
      segmentConditions: {
        operator: 'AND',
        rules: [{ type: 'is_following', value: true }, { type: 'scenario_subscribed', value: '' }],
      },
    }, tagName)).toBe('シナリオ購読中の全員')
  })

  it('条件が残っていなければ、その旨を出す', () => {
    expect(audienceSummary({ targetType: 'segment', segmentConditions: null }, tagName)).toBe('条件なし')
  })
})
