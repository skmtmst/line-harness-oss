'use client'

import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { api,type BroadcastBubble } from '@/lib/api'
import { messageTemplateToBubble,type BroadcastTemplateOption } from '@/lib/broadcast-template'
import type { Dispatch,RefObject,SetStateAction } from 'react'


type ApplyBroadcastTemplateContext = {
  placeTemplateBubble: (bubble: BroadcastBubble) => void
  saveErrors: ReturnType<typeof useSaveFormErrors>
  selectedAccountId: string | null
  selectedAccountIdRef: RefObject<string | null>
  setComposerBusy: Dispatch<SetStateAction<boolean>>
  setShowTemplatePicker: Dispatch<SetStateAction<boolean>>
  setTemplateApplyError: Dispatch<SetStateAction<string>>
  templateApplyLock: RefObject<boolean>
}

export async function applyBroadcastTemplate({ placeTemplateBubble, saveErrors, selectedAccountId, selectedAccountIdRef, setComposerBusy, setShowTemplatePicker, setTemplateApplyError, templateApplyLock }: ApplyBroadcastTemplateContext, template: BroadcastTemplateOption) {
    const accountId = selectedAccountId
    if (templateApplyLock.current) return
    setTemplateApplyError('')
    let source = template
    if (template.messageType === 'carousel') {
      templateApplyLock.current = true; setComposerBusy(true)
      try {
        const detail = await api.templates.get(template.id)
        if (selectedAccountIdRef.current !== accountId) return
        if (!detail.success || (detail.data.accountId && detail.data.accountId !== accountId)) { setTemplateApplyError('このアカウントで使えるテンプレートを読み込めませんでした。'); return }
        source = { ...template, carouselActions: detail.data.carouselActions, carouselTapLimitMode: detail.data.carouselTapLimitMode, carouselTapLimitText: detail.data.carouselTapLimitText }
      } catch (saveFailure) {
        const fieldFailure = saveErrors.capture(saveFailure);
 if (selectedAccountIdRef.current === accountId) { if (!fieldFailure) setTemplateApplyError('テンプレートを読み込めませんでした。もう一度選んでください。'); } return }
      finally { templateApplyLock.current = false; if (selectedAccountIdRef.current === accountId) setComposerBusy(false) }
    }
    const bubble = messageTemplateToBubble(source)
    if (!bubble) {
      setTemplateApplyError('このテンプレートの内容を読み込めませんでした')
      return
    }
    placeTemplateBubble(bubble)
    setShowTemplatePicker(false)
  }
