import { describe, expect, it, vi } from 'vitest'
import {
  bubbleLegacyMessage,
  bubblesForSave,
  contentTemplateToBubble,
  messageTemplateToBubble,
} from './broadcast-template'

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
