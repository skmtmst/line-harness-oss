'use client'

import type { BroadcastMessageKind } from '@/lib/broadcast-template'


import type { SaveConflictState } from '@/components/shared/save-conflict'


import { type BroadcastStepKey } from '@/components/broadcasts/broadcast-steps'
import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { ApiError,api,type ApiBroadcast,type BroadcastBubble,type BroadcastMessageButton } from '@/lib/api'
import { newBroadcastDraftSession,persistBroadcastDraft,type BroadcastDraftSession } from '@/lib/broadcast-draft'
import type { SegmentCondition } from '@/lib/segment-condition'
import type { Dispatch,RefObject,SetStateAction } from 'react'

type PersistBroadcastFormDraftContext = {
  createKeyByAccount: RefObject<Map<string | null, string>>
  currentStep: BroadcastStepKey | null
  draftPayload: (scheduledAt: string | null, saveAsDraft?: boolean, confirmedCount?: number) => { saveAsDraft?: boolean | undefined; draftStep?: BroadcastStepKey | undefined; trackLinks: boolean; folderId: string | null; measureOpens: boolean; stealthSpreadMinutes: number; internalMemo: string | null; messageOptions: { buttons: BroadcastMessageButton[]; } | null; afterActionVersionId: string | null; confirmedRecipientCount?: number | undefined; lineAccountId: string | null; scheduledAt: string | null; targetType: "tag"; targetTagId: string; segmentConditions: undefined; title: string; messageType: BroadcastMessageKind; messageContent: string; messageBubbles: BroadcastBubble[] | undefined; } | { saveAsDraft?: boolean | undefined; draftStep?: BroadcastStepKey | undefined; trackLinks: boolean; folderId: string | null; measureOpens: boolean; stealthSpreadMinutes: number; internalMemo: string | null; messageOptions: { buttons: BroadcastMessageButton[]; } | null; afterActionVersionId: string | null; confirmedRecipientCount?: number | undefined; lineAccountId: string | null; scheduledAt: string | null; targetType: "segment"; targetTagId: null; segmentConditions: SegmentCondition; title: string; messageType: BroadcastMessageKind; messageContent: string; messageBubbles: BroadcastBubble[] | undefined; }
  draftSession: RefObject<BroadcastDraftSession>
  draftSessionsByAccount: RefObject<Map<string | null, BroadcastDraftSession>>
  editingDraft: ApiBroadcast | null
  saveConflict: SaveConflictState<ApiBroadcast>
  saveErrors: ReturnType<typeof useSaveFormErrors>
  saveInFlightRef: RefObject<{ accountId: string | null; promise: Promise<ApiBroadcast | null>; } | null>
  selectedAccountIdRef: RefObject<string | null>
  setError: Dispatch<SetStateAction<string>>
}

export async function persistBroadcastFormDraft({ createKeyByAccount, currentStep, draftPayload, draftSession, draftSessionsByAccount, editingDraft, saveConflict, saveErrors, saveInFlightRef, selectedAccountIdRef, setError }: PersistBroadcastFormDraftContext, scheduledAt: string | null, saveAsDraft = false, confirmedCount?: number, autosaveStep?: typeof currentStep): Promise<ApiBroadcast | null> {
    const accountId = selectedAccountIdRef.current || null
    /*
     * 編集中にアカウントが切り替わったまま保存すると、下書きが別アカウントの
     * 新規配信として増える（セッションのアカウントと合わないため）。
     * 開いたときの配信元と違うなら送らず、理由を出す（BROADCAST-17）。
     */
    if (editingDraft?.lineAccountId && editingDraft.lineAccountId !== accountId) {
      setError('別のLINEアカウントへ切り替わっています。元のアカウントへ戻してから保存してください。')
      return null
    }
    /*
     * R627: 同じアカウントの保存が重なったら最新の先行を待ち直す。
     * 待たずに2つ投げると初回作成が2回・冪等キー2種になり、
     * 下書きが2件・保持IDの競合になる。1つだけ待つと3つ目以降が
     * 並ぶので、輪の中で読み直す。待った後は最新の入力で送り直すので、
     * 段移動（draftStepの違い）も更新で追いつく。
     */
    for (;;) {
      const latest = saveInFlightRef.current
      if (!latest || latest.accountId !== accountId) break
      try {
        await latest.promise
      } catch (saveFailure) {
        saveErrors.capture(saveFailure)
        /* 先行の失敗はこの保存の判断に混ぜない。下で最新を送る。 */
      }
      if ((selectedAccountIdRef.current || null) !== accountId)


 return null
    }
    const payload = draftPayload(scheduledAt, saveAsDraft, confirmedCount)
    if (saveAsDraft && autosaveStep) payload.draftStep = autosaveStep
    /*
     * R627: 作りかけの冪等キーはアカウントごとに1つ。
     * 初期セッション（accountId=null）のまま毎回新しい鍵を作ると、
     * 並んだ2つの初回作成が別物になる。ここで束ねて同じ鍵を使い回す。
     */
    const sessionForAccount = (() => {
      const stored = draftSessionsByAccount.current.get(accountId)
      if (stored) return stored
      if (draftSession.current.accountId === accountId) {
        draftSessionsByAccount.current.set(accountId, draftSession.current)
        return draftSession.current
      }
      const stableKey = createKeyByAccount.current.get(accountId)
        ?? (() => {
          const next = crypto.randomUUID()
          createKeyByAccount.current.set(accountId, next)
          return next
        })()
      const fresh = newBroadcastDraftSession(accountId, stableKey)
      draftSessionsByAccount.current.set(accountId, fresh)
      return fresh
    })()
    let settleInFlight: (value: ApiBroadcast | null) => void = () => undefined
    const ourPromise = new Promise<ApiBroadcast | null>((resolve) => {
      settleInFlight = resolve
    })
    saveInFlightRef.current = { accountId, promise: ourPromise }
    try {
      const result = await persistBroadcastDraft(
        sessionForAccount,
        accountId,
        payload,
        {
          create: api.broadcasts.create,
          update: (id, draftPayload, expectedVersion) =>
            api.broadcasts.update(id, { ...draftPayload, expectedVersion }),
        },
      )
      /*
       * R626: 待っている間にアカウントが変わっていたら、今の画面の
       * 保存表示・版・下書きIDへ混ぜない。古い方のセッションだけ残し、
       * 今のアカウントは未保存のままにする。
       */
      draftSessionsByAccount.current.set(accountId, result.session)
      if ((selectedAccountIdRef.current || null) !== accountId) {
        settleInFlight(null)
        return null
      }
      draftSession.current = result.session
      settleInFlight(result.broadcast)
      return result.broadcast
    } catch (e) {
      const fieldFailure = saveErrors.capture(e);

      if (e instanceof ApiError && e.status === 409 && sessionForAccount.draftId) {
        /*
         * R626: 古いアカウントの409を今の画面の文言へ混ぜない。
         * 取得も表示も今のアカウントのときだけにする。
         */
        if ((selectedAccountIdRef.current || null) !== accountId) {
          settleInFlight(null)
          return null
        }
        saveConflict.mark()
        setError('')
        settleInFlight(null)
        return null
      }
      settleInFlight(null)
      throw e
    } finally {
      if (saveInFlightRef.current?.promise === ourPromise) saveInFlightRef.current = null
    }
  }
