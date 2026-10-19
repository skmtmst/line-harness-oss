'use client'

import type { BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'


import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { notifyToast } from '@/components/shared/toast'
import { describeSaveFailure,type ApiBroadcast,type BroadcastBubble,type BroadcastMessageButton } from '@/lib/api'
import { bubbleLegacyMessage,bubblesForSave } from '@/lib/broadcast-template'
import type { SegmentCondition } from '@/lib/segment-condition'
import type { Dispatch,RefObject,SetStateAction } from 'react'

type BuildBroadcastDraftContext = {
  afterActionVersionId: string
  bubbles: BroadcastBubble[]
  currentStep: BroadcastStepKey | null
  folderId: string
  internalMemo: string
  measureOpens: boolean
  messageButtons: BroadcastMessageButton[]
  selectedAccountId: string | null
  spreadMinutes: string
  targetPayload: () => { targetType: "tag"; targetTagId: string; segmentConditions: undefined; } | { targetType: "segment"; targetTagId: null; segmentConditions: SegmentCondition; }
  title: string
  trackLinks: boolean
}

export function buildBroadcastDraft({ afterActionVersionId, bubbles, currentStep, folderId, internalMemo, measureOpens, messageButtons, selectedAccountId, spreadMinutes, targetPayload, title, trackLinks }: BuildBroadcastDraftContext, scheduledAt: string | null, saveAsDraft = false, confirmedCount?: number) {
    const first = bubbles[0]
    const legacy = bubbleLegacyMessage(first)
    return {
      title: title.trim() || '（テスト送信）',
      messageType: legacy.messageType,
      messageContent: legacy.messageContent,
      messageBubbles: bubblesForSave(bubbles),
      ...targetPayload(),
      lineAccountId: selectedAccountId || null,
      scheduledAt,
      // 1人運用のとき、送る人が確認で入れた人数。予約の口が突き合わせる。
      ...(confirmedCount !== undefined ? { confirmedRecipientCount: confirmedCount } : {}),
      trackLinks,
      folderId: folderId || null,
      measureOpens,
      stealthSpreadMinutes: Number(spreadMinutes) || 0,
      internalMemo: internalMemo.trim() || null,
      messageOptions: messageButtons.length > 0 ? { buttons: messageButtons } : null,
      afterActionVersionId: afterActionVersionId || null,
      ...(saveAsDraft ? {
        saveAsDraft: true,
        draftStep: currentStep ?? 'basic',
      } : {}),
    }
  }

type SaveBroadcastDraftContext = {
  cleanFingerprintRef: RefObject<string | null>
  draftAutosave: { autosaving: boolean; savedAt: number | null; failed: boolean; markSaved: () => void; retry: () => void; label: string | null; }
  formFingerprint: string
  onDraftSaved: ((broadcast: ApiBroadcast) => void) | undefined
  persistDraft: (scheduledAt: string | null, saveAsDraft?: boolean, confirmedCount?: number, autosaveStep?: BroadcastStepKey | null) => Promise<ApiBroadcast | null>
  rejectValidation: (validationError: string) => void
  saveErrors: ReturnType<typeof useSaveFormErrors>
  scheduledAtIso: () => string | null
  selectedAccountIdRef: RefObject<string | null>
  setError: Dispatch<SetStateAction<string>>
  setSaving: Dispatch<SetStateAction<boolean>>
  validate: () => string
}

export async function saveBroadcastDraft({ cleanFingerprintRef, draftAutosave, formFingerprint, onDraftSaved, persistDraft, rejectValidation, saveErrors, scheduledAtIso, selectedAccountIdRef, setError, setSaving, validate }: SaveBroadcastDraftContext): Promise<boolean> {
    /*
     * 監査 R206: 下書き保存も確認・テスト送信と同じ検査を通す。
     * 通さないと、ボタンの不備が Worker で断られて「保存できませんでした」
     * だけになり、どこを直すべきか分からない。
     */
    const validationError = validate()
    if (validationError) {
      rejectValidation(validationError)
      return false
    }
    setSaving(true)
    setError('')
    const requestAccountId = selectedAccountIdRef.current || null
    const fingerprintAtSave = formFingerprint
    try {
      // #772: 409時は persistDraft が案内ずみで null を返すため、保存ずみにはしない。
      const saved = await persistDraft(scheduledAtIso(), true)
      // R626: 待っている間にアカウントが変わっていたら今の画面へ混ぜない。
      if ((selectedAccountIdRef.current || null) !== requestAccountId) return false
      if (saved) {
        cleanFingerprintRef.current = fingerprintAtSave
        draftAutosave.markSaved()
        notifyToast('下書きを保存しました。')
        // BROADCAST-16: フォームは閉じない保存なので、背後の一覧と
        // フォルダ件数の読み直しは呼び側に任せる。失敗時は呼ばない。
        onDraftSaved?.(saved)
        return true
      }
      return false
    } catch (error) {
      /*
       * R234: 保存側で弾いた理由（音声URL・スタンプ番号・Flexの形など）を
       * そのまま出す。「保存できませんでした」だけだと、どこを直すか分からない。
       * 400 の本文は運用者へ出してよい安全な文だけが来る（api.ts の約束）。
       * R626: 古いアカウントの失敗を今の画面の文言へ混ぜない。
       */
      if ((selectedAccountIdRef.current || null) !== requestAccountId) return false
      const fieldFailure = saveErrors.capture(error)
      { if (!fieldFailure)

      setError(describeSaveFailure(error)) }
      return false
    } finally {
      setSaving(false)
    }
  }
