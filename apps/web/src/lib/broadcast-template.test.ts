import { describe, expect, it, vi } from 'vitest'
import {
  assetBubbleError,
  bubbleLegacyMessage,
  bubblesForSave,
  contentTemplateToBubble,
  messageButtonsError,
  messageTemplateToBubble,
} from './broadcast-template'
import { emptyMessageKindState } from '@/components/scenarios/message-kind-fields'

vi.stubGlobal('crypto', { randomUUID: () => 'bubble-id' })

describe('broadcast template conversion', () => {
  it('converts a text template into a broadcast bubble', () => {
    expect(messageTemplateToBubble({
      id: 'tpl-1',
      name: 'ご案内',
      category: 'general',
      messageType: 'text',
      messageContent: 'こんにちは',
    })).toEqual({
      id: 'bubble-id',
      type: 'text',
      content: { text: 'こんにちは', templateId: 'tpl-1', templateName: 'ご案内' },
    })
  })

  it('keeps a content template reference in the selected bubble', () => {
    const bubble = contentTemplateToBubble({
      id: 'asset-1',
      lineAccountId: null,
      kind: 'coupon',
      name: '夏クーポン',
      payload: { description: '500円引き', actionUrl: 'https://example.com' },
      createdAt: '2026-08-18T00:00:00Z',
      updatedAt: '2026-08-18T00:00:00Z',
    })
    expect(bubble.type).toBe('coupon')
    expect(bubble.content).toMatchObject({ assetId: 'asset-1', assetName: '夏クーポン' })
  })

  it('uses raw Flex JSON as the legacy message content', () => {
    expect(bubbleLegacyMessage({
      id: 'bubble-id',
      type: 'flex',
      content: { flexJson: '{"type":"bubble"}' },
    })).toEqual({ messageType: 'flex', messageContent: '{"type":"bubble"}' })
  })

  it('rejects malformed image templates', () => {
    expect(messageTemplateToBubble({
      id: 'tpl-bad',
      name: '壊れた画像',
      category: 'general',
      messageType: 'image',
      messageContent: 'not-json',
    })).toBeNull()
  })
})

/*
 * 保存に渡す吹き出し。
 *
 * ここを間違えると、**作れるのに送れない配信**ができる。しかも作った時点では
 * 何も起きず、送信を押した時点で「複数吹き出しの実配信は次フェーズです」と
 * 出る。予約配信なら、断られるのは配信の時刻——直せる人が見ていない時刻になる。
 */
describe('保存に渡す吹き出し', () => {
  const bubble = (text: string) => ({ id: text, type: 'text' as const, content: { text } })

  it('1つだけなら渡さない', () => {
    expect(bubblesForSave([bubble('a')])).toEqual([bubble('a')])
  })

  it('2つ以上なら渡す', () => {
    expect(bubblesForSave([bubble('a'), bubble('b')])).toHaveLength(2)
  })

  it('空でも渡さない', () => {
    expect(bubblesForSave([])).toBeUndefined()
  })
})

/*
 * 吹き出し → 配信の中身。
 *
 * ここが間違うと、**中身の JSON がそのまま相手のトークに届く**。
 * 前はスタンプも動画も「テキストに JSON を入れたもの」に落ちていて、
 * 選べるのに送ると壊れる状態だった。
 */
describe('吹き出しを配信の中身に直す', () => {
  it('位置情報は種別ごと渡す（テキストに落とさない）', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'location',
      content: { state: { ...emptyMessageKindState(), location: { title: '店舗', address: '東京都', latitude: '35.6', longitude: '139.7' } } },
    })
    expect(out.messageType).toBe('location')
    expect(JSON.parse(out.messageContent)).toMatchObject({ title: '店舗', latitude: 35.6, longitude: 139.7 })
  })

  it('スタンプは packageId / stickerId を渡す', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'sticker',
      content: { state: { ...emptyMessageKindState(), sticker: { packageId: '446', stickerId: '1988' } } },
    })
    expect(out.messageType).toBe('sticker')
    expect(JSON.parse(out.messageContent)).toEqual({ packageId: '446', stickerId: '1988' })
  })

  it('音声は秒をミリ秒に直す', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'audio',
      content: { state: { ...emptyMessageKindState(), audio: { originalContentUrl: 'https://e.com/a.m4a', duration: '12' } } },
    })
    expect(JSON.parse(out.messageContent).duration).toBe(12000)
  })

  it('カルーセルは控えた中身そのものを渡す（テンプレートIDではない）', () => {
    // テンプレートを消したあとも、この配信は送れないといけない。
    const columns = JSON.stringify([{ title: '然-NEN- チキン', text: '国産むね肉', actions: [] }])
    const out = bubbleLegacyMessage({
      id: 'b', type: 'carousel',
      content: { templateId: 'tpl-1', templateName: 'チキン', columnsJson: columns },
    })
    expect(out.messageType).toBe('carousel')
    expect(out.messageContent).toBe(columns)
  })

  it('動画は種別ごと渡す', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'video',
      content: { originalContentUrl: 'https://e.com/v.mp4', previewImageUrl: 'https://e.com/v.jpg' },
    })
    expect(out.messageType).toBe('video')
  })

  it('書けていない位置情報は空を返す（保存前に画面が止める）', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'location',
      content: { state: emptyMessageKindState() },
    })
    expect(out.messageContent).toBe('')
  })
})

/*
 * 配信用素材の引用（監査 R144）。
 *
 * 中身の JSON を本文に落としていた頃は、作れた素材が「カルーセル・画像・
 * クーポン案内・アンケート案内」として届かなかった。素材は対応する LINE の
 * 種別へ明示的に直す。内部の管理名・ID は本文に入れない。
 */
describe('素材の引用を LINE の種別に直す', () => {
  const cardContent = {
    assetId: 'asset-1',
    assetName: '夏の案内',
    cards: [{ title: 'パネル', description: '説明です', actionLabel: '詳しく見る', actionUrl: 'https://example.com/a' }],
    moreCard: false,
  }

  it('カルーセル素材はカルーセルの列に直す', () => {
    const out = bubbleLegacyMessage({ id: 'b', type: 'card_message', content: cardContent })
    expect(out.messageType).toBe('carousel')
    const columns = JSON.parse(out.messageContent) as Array<Record<string, unknown>>
    expect(columns[0]).toMatchObject({ title: 'パネル', text: '説明です' })
    expect(out.messageContent).not.toContain('assetId')
  })

  it('リッチメッセージはタップ範囲を持つイメージマップに直す', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'rich_message',
      content: { assetId: 'a', assetName: '便り',baseUrl:'https://example.com/images/map',baseSize:{width:1040,height:520},tapAreas:[{x:0,y:0,width:100,height:100,actionType:'uri',uri:'https://example.com/lp'}], imageUrl: 'https://example.com/a.png', description: '新米です', actionUrl: 'https://example.com/lp' },
    })
    expect(out.messageType).toBe('imagemap')
    expect(JSON.parse(out.messageContent)).toMatchObject({baseSize:{width:1040,height:520}})
    expect(out.messageContent).not.toContain('assetId')
  })

  it('クーポンは使用ボタンつきカードに直す', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'coupon',
      content: { assetId: 'a', assetName: '夏クーポン',startsAt:'2026-01-01T00:00',endsAt:'2027-01-01T00:00',description: '500円引き', actionUrl: 'https://example.com/c' },
    })
    expect(out.messageType).toBe('flex')
    expect(out.messageContent).toContain('coupon_use:a')
  })

  it('リサーチは読める文に直す', () => {
    const out = bubbleLegacyMessage({
      id: 'b', type: 'research',
      content: { assetId: 'a', assetName: '調査', description: '答えてください', actionUrl: 'https://example.com/f' },
    })
    expect(out.messageType).toBe('text')
    expect(out.messageContent).toContain('答えてください')
    expect(out.messageContent).not.toContain('assetId')
  })

  it('選んでいない素材は選び直しを求める', () => {
    expect(assetBubbleError({ id: 'b', type: 'coupon', content: {} })).toContain('選択')
  })

  it('直せない素材は番号ではなく中身の直し方を返す', () => {
    const error = assetBubbleError({ id: 'b', type: 'card_message', content: { ...cardContent, cards: [{ title: 'パネル' }] } })
    expect(error).toContain('パネル1')
    expect(error).toContain('リンク先')
  })

  it('直った素材は空文字（問題なし）を返す', () => {
    expect(assetBubbleError({ id: 'b', type: 'card_message', content: cardContent })).toBe('')
  })
})

/*
 * ボタンの入力不備（監査 R206）。
 *
 * 空の名前・空のURL・https でないURLを区別して返し、番号で指す。
 * 「下書きを保存できませんでした」だけでは、どこを直すべきか分からない。
 */
describe('ボタンの入力不備', () => {
  const button = (over: Record<string, unknown> = {}) => ({
    label: '資料を見る',
    type: 'url' as const,
    value: 'https://example.com/guide',
    ...over,
  })

  it('空の名前は番号と項目を指す', () => {
    expect(messageButtonsError([button({ label: '  ' })])).toBe('ボタン1の名前を入力してください')
  })

  it('空のURLは番号と項目を指す', () => {
    expect(messageButtonsError([button({ value: '' })])).toBe('ボタン1のURLを入力してください')
  })

  it('https でないURLは https を求める', () => {
    expect(messageButtonsError([button({ value: 'not-a-url' })])).toBe(
      'ボタン1のURLは https:// から始めてください',
    )
    expect(messageButtonsError([button({ value: 'http://example.com' })])).toBe(
      'ボタン1のURLは https:// から始めてください',
    )
  })

  it('2つ目以降も番号で指す', () => {
    expect(messageButtonsError([button(), button({ value: 'not-a-url' })])).toBe(
      'ボタン2のURLは https:// から始めてください',
    )
  })

  it('そろっていれば空文字（問題なし）を返す', () => {
    expect(messageButtonsError([])).toBe('')
    expect(messageButtonsError([button()])).toBe('')
  })

  it('5つ目は置けない', () => {
    expect(messageButtonsError([button(), button(), button(), button(), button()])).toBe(
      'ボタンは4つまでです',
    )
  })
})


describe('イメージマップのAPIと編集用データの往復',()=>{
  it('LINEの範囲をピクセルのまま保ち、既存のリッチメッセージとして読み込む',()=>{
    const payload={baseUrl:'https://example.com/images/map',baseSize:{width:1040,height:520},altText:'予約案内',actions:[{type:'message',text:'予約',area:{x:520,y:0,width:520,height:520}}]}
    const loaded=messageTemplateToBubble({id:'template',name:'予約案内',messageType:'imagemap',messageContent:JSON.stringify(payload)})!
    expect(loaded.type).toBe('rich_message')
    expect(loaded.content.coordinateUnit).toBe('px')
    expect(bubblesForSave([loaded])).toHaveLength(1)
    expect(JSON.parse(bubbleLegacyMessage(loaded).messageContent)).toMatchObject(payload)
  })
})
