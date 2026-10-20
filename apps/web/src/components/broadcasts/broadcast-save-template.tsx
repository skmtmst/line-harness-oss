'use client'

import type { AccountWithStats } from '@/contexts/account-context'


import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { notifyToast } from '@/components/shared/toast'
import { api,type BroadcastBubble,type BroadcastMessageAsset } from '@/lib/api'
import { bubbleLegacyMessage,isContentTemplateType } from '@/lib/broadcast-template'
import { panelsFromContent } from '@/v8/templates/public/carousel/index'
import { saveCarousel } from '@/v8/templates/public/carousel-core/index'
import type { Dispatch,RefObject,SetStateAction } from 'react'
import { bubblesError } from './broadcast-form-model'


type SaveBroadcastTemplateContext = {
  bubbles: BroadcastBubble[]
  composerBusy: boolean
  saveErrors: ReturnType<typeof useSaveFormErrors>
  selectedAccount: AccountWithStats | null
  selectedAccountId: string | null
  selectedAccountIdRef: RefObject<string | null>
  setComposerBusy: Dispatch<SetStateAction<boolean>>
  setTemplateSaveCreatedId: Dispatch<SetStateAction<string | null>>
  setTemplateSaveError: Dispatch<SetStateAction<string>>
  setTemplateSaveIndex: Dispatch<SetStateAction<number | null>>
  templateSaveCreatedId: string | null
  templateSaveIndex: number | null
  templateSaveName: string
}

export async function saveBroadcastTemplate({ bubbles, composerBusy, saveErrors, selectedAccount, selectedAccountId, selectedAccountIdRef, setComposerBusy, setTemplateSaveCreatedId, setTemplateSaveError, setTemplateSaveIndex, templateSaveCreatedId, templateSaveIndex, templateSaveName }: SaveBroadcastTemplateContext) {
    if (templateSaveIndex === null || !selectedAccountId || composerBusy) return
    if (!templateSaveName.trim()) { setTemplateSaveError('テンプレート名を入力してください。'); return }
    const bubble = bubbles[templateSaveIndex]
    const problem = bubblesError([bubble])
    if (problem) { setTemplateSaveError(problem); return }
    setComposerBusy(true); setTemplateSaveError('')
    try {
      const legacy = bubbleLegacyMessage(bubble)
      if (bubble.type === 'carousel') {
        const saved = await saveCarousel({ templateId: templateSaveCreatedId, selectedAccountId, name: templateSaveName.trim(), panels: panelsFromContent(String(bubble.content.columnsJson ?? '[]'), bubble.content.carouselActions as Record<string, Record<string, unknown[]>> | null), folderId: null, tapLimitMode: bubble.content.tapLimitMode === 'once' ? 'once' : 'none', tapLimitText: String(bubble.content.tapLimitText ?? ''), liffId: selectedAccount?.liffId ?? null })
        if (selectedAccountIdRef.current !== selectedAccountId) return
        if (!saved.ok) { if (saved.createdId) setTemplateSaveCreatedId(saved.createdId); throw new Error(saved.error) }
        setTemplateSaveIndex(null); notifyToast('テンプレートに保存しました'); return
      }
      const result = isContentTemplateType(bubble.type) ? await api.broadcastMessageAssets.create({ lineAccountId: selectedAccountId, name: templateSaveName.trim(), kind: bubble.type as BroadcastMessageAsset['kind'], payload: bubble.content }) : await api.templates.create({ accountId: selectedAccountId, name: templateSaveName.trim(), category: 'general', messageType: legacy.messageType, messageContent: legacy.messageContent })
      if (selectedAccountIdRef.current !== selectedAccountId) return
      if (!result.success) throw new Error(result.error)
      setTemplateSaveIndex(null); notifyToast('テンプレートに保存しました')
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure);
 if (selectedAccountIdRef.current === selectedAccountId) { if (!fieldFailure) setTemplateSaveError('テンプレートに保存できませんでした。もう一度お試しください。') } }
    finally { if (selectedAccountIdRef.current === selectedAccountId) setComposerBusy(false) }
  }
