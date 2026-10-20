'use client'

import type { BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'


import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { api,type ApiBroadcast } from '@/lib/api'
import { formatTime } from '@/lib/format'
import type { Dispatch,SetStateAction } from 'react'
import { testSendFailure,testSendResult,type TestSendView } from './test-send-view'

type TestBroadcastContext = {
  onDraftSaved: ((broadcast: ApiBroadcast) => void) | undefined
  persistDraft: (scheduledAt: string | null, saveAsDraft?: boolean, confirmedCount?: number, autosaveStep?: BroadcastStepKey | null) => Promise<ApiBroadcast | null>
  rejectValidation: (validationError: string) => void
  saveErrors: ReturnType<typeof useSaveFormErrors>
  setError: Dispatch<SetStateAction<string>>
  setTestHistory: Dispatch<SetStateAction<TestSendView[]>>
  setTestResult: Dispatch<SetStateAction<TestSendView | null>>
  setTestSending: Dispatch<SetStateAction<boolean>>
  validate: () => string
}

export async function testBroadcast({ onDraftSaved, persistDraft, rejectValidation, saveErrors, setError, setTestHistory, setTestResult, setTestSending, validate }: TestBroadcastContext) {
    const validationError = validate()
    if (validationError) {
      rejectValidation(validationError)
      return
    }
    setTestSending(true)
    setError('')
    setTestResult(null)
    const at = formatTime(new Date())
    try {
      const draft = await persistDraft(null, true)
      if (!draft) return
      // BROADCAST-16: テスト送信でも下書きが増えるので、一覧と
      // フォルダ件数を読み直してもらう。
      onDraftSaved?.(draft)
      const res = await api.broadcasts.testSend(draft.id)
      /*
       * **HTTPの成功と配信の成功は分ける。** 全員に失敗しても
       * `success: true` で `sent/failed` が返るので、共通の分類
       * （全員失敗=エラー、一部失敗=要対応、全員成功=成功）を通す。
       */
      const view = res.success
        ? testSendResult(res.sent ?? 0, res.failed ?? 0, at)
        : res.error
          ? { kind: 'error' as const, message: `${at} ${res.error}` }
          : testSendFailure(at)
      setTestResult(view)
      setTestHistory((history) => [view, ...history])
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure);

      const view = testSendFailure(at)
      { if (!fieldFailure)
      setTestResult(view) }
      setTestHistory((history) => [view, ...history])
    } finally {
      setTestSending(false)
    }
  }
