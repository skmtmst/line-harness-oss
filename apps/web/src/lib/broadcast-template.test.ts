import { describe, expect, it, vi } from 'vitest'
import {
  bubbleLegacyMessage,
  bubblesForSave,
  contentTemplateToBubble,
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
    expect(bubblesForSave([bubble('a')])).toBeUndefined()
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
