import type {
  BroadcastBubble,
  BroadcastBubbleType,
  BroadcastMessageAsset,
} from '@/lib/api'
import {
  convertBroadcastAsset,
  isBroadcastAssetKind,
  type BroadcastAssetKind,
} from '@line-crm/shared'
import {
  serializeMessageKind,
  type MessageKind,
  type MessageKindState,
} from '@/components/scenarios/message-kind-fields'

export interface BroadcastTemplateOption {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  /** 置き場。未分類は null。選択窓のフォルダ絞り込みに使う（IDEA-11）。 */
  folderId?: string | null
  /** 持ち主のLINEアカウント。アカウント切替で持ち主を追跡するために残す。 */
  accountId?: string | null
  usageCount?: number
  updatedAt?: string
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
  messageType: BroadcastMessageKind
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
  if (bubble.type === 'video') {
    return { messageType: 'video', messageContent: JSON.stringify(bubble.content) }
  }
  if (bubble.type === 'carousel') {
    // 中身そのもの（columns の配列）を渡す。テンプレートを消したあとも送れる。
    return { messageType: 'carousel', messageContent: String(bubble.content.columnsJson ?? '') }
  }
  if (KIND_FIELD_TYPES.has(bubble.type)) {
    // シナリオと同じ並べ方に直す。書けていなければ空（保存前に validate が止める）。
    const state = bubble.content.state as MessageKindState | undefined
    const json = state ? serializeMessageKind(bubble.type as MessageKind, state) : null
    return { messageType: bubble.type as BroadcastMessageKind, messageContent: json ?? '' }
  }
  if (isBroadcastAssetKind(bubble.type)) {
    /*
     * 配信用素材は、LINE へそのまま渡せる種別へ明示的に直す。
     * 中身の JSON を本文に落とすと、素材の管理名やIDがそのまま相手の
     * トークに届く（監査 R144）。直せない素材は空にして、保存の前に
     * assetBubbleError が止める。
     */
    const converted = convertBroadcastAsset(
      bubble.type as BroadcastAssetKind,
      String(bubble.content.assetName ?? ''),
      bubble.content as Record<string, unknown>,
    )
    if (!converted.ok) return { messageType: 'text', messageContent: '' }
    return { messageType: converted.message.messageType, messageContent: converted.message.messageContent }
  }
  return { messageType: 'text', messageContent: JSON.stringify(bubble.content) }
}

/**
 * 素材の吹き出しが送れる形になっているか。空文字なら問題なし。
 *
 * 選んでいない（assetId が無い）ときと、選んだ素材が送れる形に直せない
 * ときに、利用者への直し方を返す。保存の検査（bubblesError）と Worker の
 * 複数吹き出し解析が同じ変換を見るので、画面では通るのに送信で断られる
 * 形にならない。
 */
export function assetBubbleError(bubble: BroadcastBubble): string {
  if (!isBroadcastAssetKind(bubble.type)) return ''
  if (!bubble.content.assetId) return 'テンプレートを選択してください'
  const converted = convertBroadcastAsset(
    bubble.type as BroadcastAssetKind,
    String(bubble.content.assetName ?? ''),
    bubble.content as Record<string, unknown>,
  )
  return converted.ok ? '' : converted.error
}

/** 一斉配信が LINE へ渡せる種別。worker の `BroadcastMessageType` と同じ。 */
export type BroadcastMessageKind =
  | 'text'
  | 'image'
  | 'flex'
  | 'location'
  | 'video'
  | 'audio'
  | 'sticker'
  | 'carousel'

/** 位置情報・音声・スタンプ。シナリオと同じ入力欄・同じ並べ方を使う。 */
const KIND_FIELD_TYPES = new Set<BroadcastBubbleType>(['location', 'audio', 'sticker'])

export function isContentTemplateType(type: BroadcastBubbleType): boolean {
  return ['rich_message', 'card_message', 'coupon', 'research'].includes(type)
}

/**
 * 保存に渡す吹き出し。1つだけなら渡さない。
 *
 * `message_bubbles_json` が入っている配信は、送信が「複数吹き出しの実配信は
 * 次フェーズです」で断る。画面は1つしか書いていなくても常に配列を渡して
 * いたので、**作れるのに送れない**配信ができていた。1つのときは前からある
 * messageType / messageContent だけで足りる。
 *
 * 2通目以降が本当に送れるようになったら、この関数ごと消してよい。
 */
export function bubblesForSave(bubbles: BroadcastBubble[]): BroadcastBubble[] | undefined {
  return bubbles.length > 1 ? bubbles : undefined
}
