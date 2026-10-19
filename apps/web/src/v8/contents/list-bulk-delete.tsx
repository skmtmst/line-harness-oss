'use client'

import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { notifyToast } from '@/components/shared/toast'
import { api } from '@/lib/api'
import type { MediaItem } from '@line-crm/shared'
import type { Dispatch,RefObject,SetStateAction } from 'react'
import { summarizeBulkDeleteResult } from './media-delete-impact'


type DeleteMediaSelectionContext = {
  items: MediaItem[]
  latestAccountRef: RefObject<string | null>
  load: () => Promise<void>
  loadKpis: () => Promise<void>
  saveErrors: ReturnType<typeof useSaveFormErrors>
  selectedAccountId: string | null
  selectionItems: MediaItem[]
  setBulkBusy: Dispatch<SetStateAction<boolean>>
  setBulkConfirm: Dispatch<SetStateAction<string[] | null>>
  setBulkProgress: Dispatch<SetStateAction<{ done: number; total: number; } | null>>
  setError: Dispatch<SetStateAction<string>>
  setSelected: Dispatch<SetStateAction<Set<string>>>
}

export async function deleteMediaSelection({ items, latestAccountRef, load, loadKpis, saveErrors, selectedAccountId, selectionItems, setBulkBusy, setBulkConfirm, setBulkProgress, setError, setSelected }: DeleteMediaSelectionContext, ids: string[]) {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) return
    setBulkBusy(true)
    setBulkProgress({ done: 0, total: ids.length })
    setError('')
    let deleted = 0
    const failedNames: string[] = []
    for (const id of ids) {
      const name = [...items, ...selectionItems].find((m) => m.id === id)?.filename ?? id
      try {
        await api.media.delete(id, accountAtRequest)
      } catch (saveFailure) {
        saveErrors.capture(saveFailure)
        /*
          409（読み直したら使われ始めていた）も通信失敗も、ここでは
          名前だけ残して次へ進む。件ごとに文を出すと最後の1件しか残らない。
        */
        failedNames.push(name)
        setBulkProgress({ done: deleted + failedNames.length, total: ids.length })
        continue
      }
      if (accountAtRequest !== latestAccountRef.current) {
        /*
          アカウントが変わったら、前の窓のままにしない。処理中の表示を
          戻して抜ける（結果文は古いアカウントのものになるので出さない）。
        */
        setBulkBusy(false)
        setBulkConfirm(null)
        setBulkProgress(null)
        return
      }
      deleted += 1
      setBulkProgress({ done: deleted + failedNames.length, total: ids.length })
    }
    const result = summarizeBulkDeleteResult(deleted, failedNames)
    setSelected(new Set())
    setBulkConfirm(null)
    setBulkBusy(false)
    setBulkProgress(null)
    if (result.tone === 'success') notifyToast(result.message)
    else setError(result.message)
    void load()
    void loadKpis()
  }
