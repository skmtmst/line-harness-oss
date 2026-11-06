'use client'

import type { BroadcastBubbleType } from '@/lib/api'


import { type ApiBroadcast,type BroadcastBubble } from '@/lib/api'
import type { Dispatch,SetStateAction } from 'react'
import { TITLE_MAX } from './broadcast-form-model'


export function copyBroadcastDraft(broadcast: ApiBroadcast) {
    const copied = broadcast.messageBubbles?.filter((bubble): bubble is BroadcastBubble => (
      Boolean(bubble)
      && typeof bubble === 'object'
      && typeof bubble.id === 'string'
      && typeof bubble.type === 'string'
      && Boolean(bubble.content)
    ))
    return {
      title: `${broadcast.title}（複製）`.slice(0, TITLE_MAX),
      bubbles: copied?.length ? copied.map((bubble) => ({ ...bubble, id: crypto.randomUUID() })) : [
        { id: crypto.randomUUID(), type: broadcast.messageType, content: { text: broadcast.messageContent } },
      ],
    }
  }

type CopyRecentBroadcastContext = {
  duplicateCopy: (broadcast: ApiBroadcast) => { title: string; bubbles: { id: string; type: BroadcastBubbleType; content: Record<string, unknown>; }[]; }
  setBubbles: Dispatch<SetStateAction<BroadcastBubble[]>>
  setDeliveryMethod: Dispatch<SetStateAction<"new" | "template" | "duplicate">>
  setLimitToQuota?: Dispatch<SetStateAction<boolean>>
  setRecipientLimitInput?: Dispatch<SetStateAction<string>>
  setTitle: Dispatch<SetStateAction<string>>
}

export function copyRecentBroadcast({ duplicateCopy, setBubbles, setDeliveryMethod, setTitle, setLimitToQuota, setRecipientLimitInput }: CopyRecentBroadcastContext, broadcast: ApiBroadcast) {
    const copy = duplicateCopy(broadcast)
    setLimitToQuota?.(broadcast.messageOptions?.deliveryLimit?.upToRemainingQuota ?? false)
    setRecipientLimitInput?.(broadcast.messageOptions?.deliveryLimit?.maxRecipients === undefined ? '' : String(broadcast.messageOptions.deliveryLimit.maxRecipients))
    setTitle(copy.title)
    setBubbles(copy.bubbles)
    setDeliveryMethod('duplicate')
  }
