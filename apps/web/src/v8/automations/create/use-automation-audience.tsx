'use client'

import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { api } from '@/lib/api'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { FormSnapshot } from './draft-model'
import { StoredDraft } from './draft-storage'

export function useAutomationAudience({ formStashRef, selectedAccountRef, setPreviewRefreshing, setPreviewFailed, setPreviewCount, setPreviewTotal, saveErrors }: {
  formStashRef: RefObject<Record<string, FormSnapshot>>
  selectedAccountRef: RefObject<string | null>
  setPreviewRefreshing: Dispatch<SetStateAction<boolean>>
  setPreviewFailed: Dispatch<SetStateAction<boolean>>
  setPreviewCount: Dispatch<SetStateAction<number | null>>
  setPreviewTotal: Dispatch<SetStateAction<{ accountId: string; draftId: string; total: number; } | null>>
  saveErrors: ReturnType<typeof useSaveFormErrors>
}) {
  const refreshAudiencePreview = async (accountId: string, draft: StoredDraft) => {
    const stashedNow = formStashRef.current[accountId]
    if (stashedNow) stashedNow.previewFailed = false
    if (selectedAccountRef.current === accountId) {
      setPreviewRefreshing(true)
      setPreviewFailed(false)
    }
    try {
      const preview = await api.automations.audiencePreview(draft.id, accountId, draft.draftVersionId)
      if (!preview.success) throw new Error(preview.error)
      const stashed = formStashRef.current[accountId]
      if (stashed) {
        stashed.previewCount = preview.data.matched
        stashed.previewFailed = false
      }
      if (selectedAccountRef.current === accountId) {
        setPreviewCount(preview.data.matched)
        setPreviewFailed(false)
      }
      // 友だち全体の数は、数えた下書き・アカウントと一緒に持つ（別の下書きの数を出さない）。
      setPreviewTotal({ accountId, draftId: draft.id, total: preview.data.total })
    } catch (saveFailure) {
      saveErrors.capture(saveFailure);

      const stashed = formStashRef.current[accountId]
      if (stashed) stashed.previewFailed = true
      if (selectedAccountRef.current === accountId) setPreviewFailed(true)
    } finally {
      if (selectedAccountRef.current === accountId) setPreviewRefreshing(false)
    }
  }

  return { refreshAudiencePreview }
}
