'use client'

import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { api } from '@/lib/api'
import type { Dispatch,RefObject,SetStateAction } from 'react'


type OpenBroadcastTestContext = {
  rejectValidation: (validationError: string) => void
  saveErrors: ReturnType<typeof useSaveFormErrors>
  selectedAccountId: string | null
  setTestDialogOpen: Dispatch<SetStateAction<boolean>>
  setTestRecipients: Dispatch<SetStateAction<{ id: string; displayName: string; pictureUrl: string | null; }[]>>
  setTestRecipientState: Dispatch<SetStateAction<"error" | "idle" | "loading" | "ready">>
  testRecipientsGeneration: RefObject<number>
  validate: () => string
}

export async function openBroadcastTest({ rejectValidation, saveErrors, selectedAccountId, setTestDialogOpen, setTestRecipients, setTestRecipientState, testRecipientsGeneration, validate }: OpenBroadcastTestContext) {
    const generation = ++testRecipientsGeneration.current
    const validationError = validate()
    if (validationError) { rejectValidation(validationError); return }
    setTestDialogOpen(true)
    setTestRecipientState('loading')
    setTestRecipients([])
    try {
      if (!selectedAccountId) throw new Error('account is not selected')
      const res = await api.accountSettings.getTestRecipients(selectedAccountId)
      if (generation !== testRecipientsGeneration.current) return
      const recipients = res.success && Array.isArray(res.data) ? res.data : []
      setTestRecipients(recipients)
      setTestRecipientState(res.success ? 'ready' : 'error')
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure);

      if (generation === testRecipientsGeneration.current) { if (!fieldFailure) setTestRecipientState('error') }
    }
  }
