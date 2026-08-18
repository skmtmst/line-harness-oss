import type {
  BroadcastBubble,
  BroadcastBubbleType,
  BroadcastMessageAsset,
} from '@/lib/api'

export interface BroadcastTemplateOption {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

function bubbleId(): string {
  return crypto.randomUUID()
}

export function messageTemplateToBubble(template: BroadcastTemplateOption): BroadcastBubble | null {
  if (template.messageType === 'text') {
    return {
      id: bubbleId(),
      type: 'text',
      content: { text: template.messageContent, templateId: template.id, templateName: template.name },
    }
  }

  if (template.messageType === 'image') {
    try {
      const image = JSON.parse(template.messageContent) as {
        originalContentUrl?: string
        previewImageUrl?: string
      }
      if (!image.originalContentUrl) return null
      return {
        id: bubbleId(),
        type: 'image',
        content: {
          originalContentUrl: image.originalContentUrl,
          previewImageUrl: image.previewImageUrl ?? image.originalContentUrl,
          templateId: template.id,
          templateName: template.name,
        },
      }
    } catch {
      return null
    }
  }

  if (template.messageType === 'flex') {
    try {
      JSON.parse(template.messageContent)
      return {
        id: bubbleId(),
        type: 'flex',
        content: {
          flexJson: template.messageContent,
          templateId: template.id,
          templateName: template.name,
        },
      }
    } catch {
      return null
    }
  }

  return null
}

export function contentTemplateToBubble(asset: BroadcastMessageAsset): BroadcastBubble {
  return {
    id: bubbleId(),
    type: asset.kind,
    content: { assetId: asset.id, assetName: asset.name, ...asset.payload },
  }
}

export function bubbleLegacyMessage(bubble: BroadcastBubble): {
  messageType: 'text' | 'image' | 'flex'
  messageContent: string
} {
  if (bubble.type === 'text') {
    return { messageType: 'text', messageContent: String(bubble.content.text ?? '') }
  }
  if (bubble.type === 'image') {
    return { messageType: 'image', messageContent: JSON.stringify(bubble.content) }
  }
  if (bubble.type === 'flex') {
    return { messageType: 'flex', messageContent: String(bubble.content.flexJson ?? '') }
  }
  if (bubble.type === 'rich_message' || bubble.type === 'card_message') {
    return { messageType: 'flex', messageContent: JSON.stringify(bubble.content) }
  }
  return { messageType: 'text', messageContent: JSON.stringify(bubble.content) }
}

export function isContentTemplateType(type: BroadcastBubbleType): boolean {
  return ['rich_message', 'card_message', 'coupon', 'research'].includes(type)
}
