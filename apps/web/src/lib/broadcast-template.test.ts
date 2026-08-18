import { describe, expect, it, vi } from 'vitest'
import {
  bubbleLegacyMessage,
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
