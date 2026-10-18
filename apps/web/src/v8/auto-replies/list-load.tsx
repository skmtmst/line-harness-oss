'use client'

import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { api,ApiError } from '@/lib/api'
import type { Dispatch,RefObject,SetStateAction } from 'react'
import { AutoReply,TemplateLite } from './list-model'
import { isCurrentAutoReplyLoad,type LoadState } from './words'

type loadAutoRepliesContext = {
  loadGenerationRef: RefObject<number>
  saveErrors: ReturnType<typeof useSaveFormErrors>
  selectedAccountId: string | null
  selectedAccountIdRef: RefObject<string | null>
  setConflictCount: Dispatch<SetStateAction<number | null>>
  setItems: Dispatch<SetStateAction<AutoReply[]>>
  setLoadedAccountId: Dispatch<SetStateAction<string | null | undefined>>
  setLoadError: Dispatch<unknown>
  setLoadState: Dispatch<SetStateAction<LoadState>>
  setTemplateListAvailable: Dispatch<SetStateAction<boolean>>
  setTemplates: Dispatch<SetStateAction<TemplateLite[]>>
}

export async function loadAutoReplies({ loadGenerationRef, saveErrors, selectedAccountId, selectedAccountIdRef, setConflictCount, setItems, setLoadedAccountId, setLoadError, setLoadState, setTemplateListAvailable, setTemplates }: loadAutoRepliesContext) {
    const requestAccountId = selectedAccountId
    const requestGeneration = ++loadGenerationRef.current
    setLoadState('loading')
    setLoadError(null)
    setConflictCount(null)
    try {
      const [arRes, tplRes, summaryRes] = await Promise.all([
        api.autoReplies.list({ accountId: selectedAccountId || undefined }),
        api.templates.list(undefined, selectedAccountId || undefined),
        selectedAccountId
          ? api.autoReplies.summary(selectedAccountId).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!isCurrentAutoReplyLoad(
        requestAccountId,
        selectedAccountIdRef.current,
        requestGeneration,
        loadGenerationRef.current,
      )) return
      if (!arRes.success) {
        setLoadedAccountId(requestAccountId)
        setLoadState('error')
        return
      }
      setItems(arRes.data as AutoReply[])
      setConflictCount(summaryRes?.success ? summaryRes.data.conflictCount : null)
      setTemplateListAvailable(tplRes.success)
      setTemplates(tplRes.success
        ? tplRes.data.map((t) => ({
            id: t.id,
            name: t.name,
            messageType: t.messageType,
            messageContent: t.messageContent,
          }))
        : [])
      setLoadedAccountId(requestAccountId)
      setLoadState('ready')
    } catch (reason) {
      if (!isCurrentAutoReplyLoad(
        requestAccountId,
        selectedAccountIdRef.current,
        requestGeneration,
        loadGenerationRef.current,
      )) return
      const fieldFailure = saveErrors.capture(reason)
      setLoadedAccountId(requestAccountId)
      { if (!fieldFailure)
      setLoadError(reason) }
      { if (!fieldFailure)
      setLoadState(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }
  }

