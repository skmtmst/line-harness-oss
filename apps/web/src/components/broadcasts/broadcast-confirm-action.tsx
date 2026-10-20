'use client'

import { ApiError,api,describeSaveFailure,type ApiBroadcast } from '@/lib/api'
import { chatSafetyApi } from '@/lib/api/helpers/gap1'
import type { SendConfirmationPreview } from '@line-crm/shared'
import type { Dispatch,SetStateAction } from 'react'


type ConfirmBroadcastMessageContext = {
  onSuccess: (broadcast: ApiBroadcast) => void
  scheduledAtIso: () => string | null
  sendPreview: { state: "loading" | "error" | "ready"; data: SendConfirmationPreview | null; broadcast: ApiBroadcast | null; }
  setConfirmOpen: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
  setPreviewSeq: Dispatch<SetStateAction<number>>
}

export async function confirmBroadcastMessage({ onSuccess, scheduledAtIso, sendPreview, setConfirmOpen, setError, setPreviewSeq }: ConfirmBroadcastMessageContext) {
    const { data, broadcast } = sendPreview
    if (!data || !broadcast) return
    setError('')
    try {
      const at = scheduledAtIso()
      await chatSafetyApi.confirmBroadcast(broadcast.id, { expectedVersion: Number(data.expectedVersion), confirmedRecipientCount: data.recipients, ...(at ? { scheduledAt: at } : {}) })
      setConfirmOpen(false)
      /* 送ったあとの状態を読み直す。読めなくても、確定は済んでいるので先へ進む。 */
      const latest = await api.broadcasts.get(broadcast.id).catch(() => null)
      onSuccess(latest?.success ? latest.data : broadcast)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError('送る相手や内容が変わりました。数え直しました。もう一度確かめてください。')
        setPreviewSeq((value) => value + 1)
        return
      }
      setError(describeSaveFailure(caught))
    }
  }
