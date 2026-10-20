'use client'

import { permissionDeniedMessage } from '@/components/shared/api-error-message'
import { type SegmentCondition } from '@/components/shared/condition-builder'
import { api, ApiError } from '@/lib/api'
import type { Automation } from '@line-crm/shared'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect } from 'react'
import type { ActionDraft } from './action-draft'
import { blankFormSnapshot, draftDetailToForm, draftPayloadFingerprint, FormSnapshot, formSnapshotHasContent, TestConfirmation, TestRunRecord } from './draft-model'
import { readStoredDraft, StoredDraft, writeStoredDraft } from './draft-storage'

export function useAutomationDraftResume({
  name, eventType, keyword, condition,
  conditionUnreadable, triggerConfig, actions, testFriendId,
  savedDraft, savedAt, savedFingerprint, saveOutcome,
  publishedRuleId, previewCount, previewFailed, testRun,
  suppressTriggerResetRef, setName, setEventType, setKeyword,
  setCondition, setConditionUnreadable, setTriggerConfig, setActions,
  setTestFriendId, setSavedDraft, setSavedAt, setSavedFingerprint,
  setSaveOutcome, setPublishedRuleId, setPreviewCount, setPreviewFailed,
  setTestRun, draftByAccountRef, createOpKeyRef, formStashRef,
  selectedAccountRef, chrome, setTagsLoading, setTagsFailed,
  selectedAccountId, setTags, setScenarios, setCommonActions,
  setExistingAutomations, setExistingError, existingRetry, setResumeTarget,
  setStoredDraftHint, previousAccountRef, accountSwitchPendingRef, setError,
  setInputError, setTestConfirmation, refreshTestRun, setNotice,
  resumeTarget, setResumeStatus, resumedKeyRef, setResumeErrorKind,
  setSourceName, resumeRetry,
}: {
  name: string
  eventType: string
  keyword: string
  condition: SegmentCondition | null
  conditionUnreadable: boolean
  triggerConfig: Record<string, unknown>
  actions: ActionDraft[]
  testFriendId: string
  savedDraft: StoredDraft | null
  savedAt: number | null
  savedFingerprint: string | null
  saveOutcome: "failed" | "published" | "idle" | "saved"
  publishedRuleId: string | null
  previewCount: number | null
  previewFailed: boolean
  testRun: TestRunRecord | null
  suppressTriggerResetRef: RefObject<boolean>
  setName: Dispatch<SetStateAction<string>>
  setEventType: Dispatch<SetStateAction<string>>
  setKeyword: Dispatch<SetStateAction<string>>
  setCondition: Dispatch<SetStateAction<SegmentCondition | null>>
  setConditionUnreadable: Dispatch<SetStateAction<boolean>>
  setTriggerConfig: Dispatch<SetStateAction<Record<string, unknown>>>
  setActions: Dispatch<SetStateAction<ActionDraft[]>>
  setTestFriendId: Dispatch<SetStateAction<string>>
  setSavedDraft: Dispatch<SetStateAction<StoredDraft | null>>
  setSavedAt: Dispatch<SetStateAction<number | null>>
  setSavedFingerprint: Dispatch<SetStateAction<string | null>>
  setSaveOutcome: Dispatch<SetStateAction<"failed" | "published" | "idle" | "saved">>
  setPublishedRuleId: Dispatch<SetStateAction<string | null>>
  setPreviewCount: Dispatch<SetStateAction<number | null>>
  setPreviewFailed: Dispatch<SetStateAction<boolean>>
  setTestRun: Dispatch<SetStateAction<TestRunRecord | null>>
  draftByAccountRef: RefObject<Record<string, StoredDraft>>
  createOpKeyRef: RefObject<Record<string, string>>
  formStashRef: RefObject<Record<string, FormSnapshot>>
  selectedAccountRef: RefObject<string | null>
  chrome: "draft" | "create"
  setTagsLoading: Dispatch<SetStateAction<boolean>>
  setTagsFailed: Dispatch<SetStateAction<boolean>>
  selectedAccountId: string | null
  setTags: Dispatch<SetStateAction<{ id: string; name: string; }[]>>
  setScenarios: Dispatch<SetStateAction<{ id: string; name: string; }[]>>
  setCommonActions: Dispatch<SetStateAction<{ id: string; name: string; }[]>>
  setExistingAutomations: Dispatch<SetStateAction<Automation[]>>
  setExistingError: Dispatch<SetStateAction<boolean>>
  existingRetry: number
  setResumeTarget: Dispatch<SetStateAction<string | null | undefined>>
  setStoredDraftHint: Dispatch<SetStateAction<StoredDraft | null>>
  previousAccountRef: RefObject<string | null>
  accountSwitchPendingRef: RefObject<boolean>
  setError: Dispatch<SetStateAction<string>>
  setInputError: Dispatch<SetStateAction<{ target: string; message: string; } | null>>
  setTestConfirmation: Dispatch<SetStateAction<TestConfirmation | null>>
  refreshTestRun: (record: TestRunRecord, accountId: string) => Promise<void>
  setNotice: Dispatch<SetStateAction<string>>
  resumeTarget: string | null | undefined
  setResumeStatus: Dispatch<SetStateAction<"failed" | "none" | "loading" | "ready">>
  resumedKeyRef: RefObject<string | null>
  setResumeErrorKind: Dispatch<SetStateAction<"gone" | "forbidden" | "network" | null>>
  setSourceName: Dispatch<SetStateAction<string>>
  resumeRetry: number
}) {
  const captureFormSnapshot = (): FormSnapshot => ({
    name,
    eventType,
    keyword,
    condition,
    conditionUnreadable,
    triggerConfig,
    actions,
    testFriendId,
    savedDraft,
    savedAt,
    savedFingerprint,
    saveOutcome,
    publishedDefinitionId: publishedRuleId,
    previewCount,
    previewFailed,
    testRun,
  })

  /** 控えを画面へ戻す。eventType の切替で詳細設定が消えないよう印を付ける。 */
  const applyFormSnapshot = (snapshot: FormSnapshot) => {
    if (snapshot.eventType !== eventType) suppressTriggerResetRef.current = true
    setName(snapshot.name)
    setEventType(snapshot.eventType)
    setKeyword(snapshot.keyword)
    setCondition(snapshot.condition)
    setConditionUnreadable(snapshot.conditionUnreadable)
    setTriggerConfig(snapshot.triggerConfig)
    setActions(snapshot.actions)
    setTestFriendId(snapshot.testFriendId)
    setSavedDraft(snapshot.savedDraft)
    setSavedAt(snapshot.savedAt)
    setSavedFingerprint(snapshot.savedFingerprint)
    setSaveOutcome(snapshot.saveOutcome)
    setPublishedRuleId(snapshot.publishedDefinitionId)
    setPreviewCount(snapshot.previewCount)
    setPreviewFailed(snapshot.previewFailed)
    setTestRun(snapshot.testRun)
  }

  /*
   * 「このアカウントに結び付いた下書き」を記録する。保存が走っている途中で
   * 店が切り替わっても、記録は始めたときの店のものへ入るので、表示中の
   * 画面を別の店の下書きに結び付けることはない（DETAIL-14）。
   */
  const bindAccountDraft = (accountId: string, draft: StoredDraft | null) => {
    if (draft) draftByAccountRef.current[accountId] = draft
    else delete draftByAccountRef.current[accountId]
    /*
     * 下書きの結び付きが確定したら作成操作の鍵は役目を終える。
     * 次に作り直しが走るのは別の新規作成なので、新しい鍵を振る。
     */
    delete createOpKeyRef.current[accountId]
    const stashed = formStashRef.current[accountId]
    if (stashed) stashed.savedDraft = draft
    if (selectedAccountRef.current === accountId) setSavedDraft(draft)
  }

  /*
   * URLの `?draft=` を、この画面が覚えている再開先と揃える。
   * 再読込・「戻る」で同じ下書きへ戻るための唯一の入口（DETAIL-13）。
   * URLの書き換えだけを担当し、再開要求そのものは `setResumeRequest` が持つ。
   */
  /* 下書きの仕上げでは番号を `?id=` で持つ。再開の読み直しは番号だけ見る。 */
  const resumeBase = chrome === 'draft' ? '/automations/drafts' : '/automations/new'
  const syncResumeUrl = (targetId: string | null, mode: 'push' | 'replace' = 'replace') => {
    const url = chrome === 'draft'
      ? (targetId ? `${resumeBase}?id=${encodeURIComponent(targetId)}` : resumeBase)
      : (targetId ? `${resumeBase}?draft=${encodeURIComponent(targetId)}` : resumeBase)
    if (mode === 'push') history.pushState(null, '', url)
    else history.replaceState(null, '', url)
  }

  useEffect(() => {
    let cancelled = false
    setTagsLoading(true)
    setTagsFailed(false)
    if (!selectedAccountId) {
      setTags([])
      setScenarios([])
      setTagsLoading(false)
      return
    }
    api.automations
      .draftResources(selectedAccountId)
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setTags(res.data.tags)
          setScenarios(res.data.scenarios)
          setCommonActions(res.data.commonActions ?? [])
        } else setTagsFailed(true)
      })
      .catch(() => {
        if (!cancelled) setTagsFailed(true)
      })
      .finally(() => {
        if (!cancelled) setTagsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, setCommonActions, setScenarios, setTags, setTagsFailed, setTagsLoading])

  // 「同じきっかけ」の注意はこの店の分だけ見れば足りる（#519 軽）。
  // 未選択のときは全件に戻さず空にして、他店の名前で脅かさない。
  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setExistingAutomations([])
      return () => {
        cancelled = true
      }
    }
    setExistingError(false)
    api.automations.list({ accountId: selectedAccountId })
      .then((response) => {
        if(!response.success)throw new Error(response.error)
        if (!cancelled) setExistingAutomations(response.data)
      })
      .catch(() => {
        if (!cancelled) setExistingError(true)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, existingRetry, setExistingAutomations, setExistingError])

  /*
   * DETAIL-13: `?draft=` の読み取りは画面が開いてから1回。
   * 戻る・進むでURLが変わったときも読み直す（popstate）。
   * 控え（sessionStorage）は「前に保存した下書きがあります」と案内する
   * ためだけに読み、番号を黙って画面へ結び付けることはしない。
   */
  useEffect(() => {
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search)
      setResumeTarget(params.get('draft') ?? params.get('id'))
    }
    readLocation()
    setStoredDraftHint(
      selectedAccountRef.current ? readStoredDraft(selectedAccountRef.current) : null,
    )
    window.addEventListener('popstate', readLocation)
    return () => window.removeEventListener('popstate', readLocation)
  }, [selectedAccountRef, setResumeTarget, setStoredDraftHint])

  /*
   * DETAIL-14: アカウントを切り替えたら、入力ごと切り替える。
   *
   * 前のアカウントの入力はそのアカウントの控えとして残し（戻れば復元）、
   * 切り替え先は控えか初期値を読み直す。前の店の文面が残ったまま
   * 別の店の下書きとして保存されることはない。
   * 走っている途中の保存・1人テストは、返ってきても自分の店でなければ
   * 何も書かない（`selectedAccountRef` で見張る）。
   */
  useEffect(() => {
    const previous = previousAccountRef.current
    previousAccountRef.current = selectedAccountId
    if (previous === selectedAccountId) return

    if (previous === null) {
      // 初めて店が決まっただけ。URLの `?draft=` はこの店のものとして読む。
      setStoredDraftHint(selectedAccountId ? readStoredDraft(selectedAccountId) : null)
      return
    }

    accountSwitchPendingRef.current = true
    setError('')
    setInputError(null)
    setTestConfirmation(null)

    const snapshot = captureFormSnapshot()
    if (formSnapshotHasContent(snapshot) || snapshot.savedDraft) {
      formStashRef.current[previous] = snapshot
    }

    const stashed = selectedAccountId ? formStashRef.current[selectedAccountId] : undefined
    setStoredDraftHint(selectedAccountId ? readStoredDraft(selectedAccountId) : null)
    if (stashed) {
      if (stashed.savedDraft && selectedAccountId) draftByAccountRef.current[selectedAccountId] = stashed.savedDraft
      applyFormSnapshot(stashed)
      // R488・第145回: 受け付けた実行があれば状態を読み直す。待機が
      // 終わっていれば、その結果に戻る。公開済みの控えは元ルールへ案内する。
      if (stashed.testRun && selectedAccountId) void refreshTestRun(stashed.testRun, selectedAccountId)
      if (stashed.saveOutcome === 'published' && stashed.publishedDefinitionId) {
        setNotice('この内容はすでに公開済みです。一覧で確認できます。')
      }
      // URLの再開先も切り替え先の下書き（または無し）へ置き換える。
      const nextTarget = stashed.savedDraft?.id ?? null
      setResumeTarget(nextTarget)
      syncResumeUrl(nextTarget)
      setNotice('切り替える前にこのアカウントで入力していた内容を戻しました。')
    } else {
      applyFormSnapshot(blankFormSnapshot())
      setResumeTarget(null)
      syncResumeUrl(null)
      if (selectedAccountId) {
        setNotice('LINEアカウントを切り替えました。前のアカウントで入力していた内容は、そのアカウントを選び直すと戻ります。')
      } else {
        setNotice('')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId,existingRetry])

  /*
   * DETAIL-13: `?draft=` で示された下書きは、番号・中身・版を一緒に読む。
   * 読み終わるまで保存はできない（blockedReason で止める）。
   * R532: 読めない下書きは理由を出して保存を止める。通信断では同じ
   * 下書きの再試行だけを出し、対象なし・権限なしでは白紙への作り直しを
   * 明示の選択にする。失敗中に別の新規下書きは作らない。
   */
  useEffect(() => {
    if (accountSwitchPendingRef.current) {
      /*
       * 切り替えの直後のURLはまだ前のアカウントの下書きを指している。
       * 切り替え側のeffectが正しい番号（または無し）へ置き換えるので、
       * ここでは何もしない。
       */
      accountSwitchPendingRef.current = false
      return
    }
    if (!selectedAccountId || resumeTarget === undefined) return
    if (resumeTarget === null) {
      setResumeStatus('none')
      return
    }
    const key = `${selectedAccountId}:${resumeTarget}`
    if (resumedKeyRef.current === key) return
    /*
     * そのアカウントの控えがすでにこの下書きを持っているなら読み直さない
     * （A→B→A と往復しても、未保存の入力を消さないため）。
     */
    if (draftByAccountRef.current[selectedAccountId]?.id === resumeTarget) {
      resumedKeyRef.current = key
      setResumeStatus('ready')
      return
    }
    resumedKeyRef.current = key
    const accountId = selectedAccountId
    const draftId = resumeTarget
    let cancelled = false
    let settled = false
    setResumeStatus('loading')
    setResumeErrorKind(null)
    setError('')
    setNotice('')
    api.automations
      .getDraft(draftId, accountId)
      .finally(() => { settled = true })
      .then((res) => {
        if (cancelled || selectedAccountRef.current !== accountId) return
        if (!res.success) {
          setResumeStatus('failed')
          setResumeErrorKind('gone')
          setError(
            '指定された下書きは読み込めませんでした。削除されたか、ほかのアカウントの下書きの可能性があります。',
          )
          return
        }
        const restored = draftDetailToForm(res.data)
        const draft = { id: res.data.id, draftVersionId: res.data.draftVersionId }
        if (restored.eventType !== eventType) suppressTriggerResetRef.current = true
        setName(restored.name)
        setSourceName(restored.name)
        setEventType(restored.eventType)
        setKeyword(restored.keyword)
        setCondition(restored.condition)
        setConditionUnreadable(restored.conditionUnreadable)
        setTriggerConfig(restored.triggerConfig)
        setActions(restored.actions)
        setPreviewFailed(false)
        const fingerprint = draftPayloadFingerprint(restored)
        setSavedFingerprint(fingerprint)
        setSaveOutcome('saved')
        setSavedAt(null)
        bindAccountDraft(accountId, draft)
        writeStoredDraft(accountId, draft)
        setStoredDraftHint(null)
        formStashRef.current[accountId] = {
          ...restored,
          testFriendId: '',
          savedDraft: draft,
          savedAt: null,
          savedFingerprint: fingerprint,
          saveOutcome: 'saved',
          publishedDefinitionId: null,
          previewCount: null,
          previewFailed: false,
          testRun: null,
        }
        setResumeStatus('ready')
        /* 見本から作った下書きは頭の下の帯がどこから来たかを伝えるので、読み込みの知らせは重ねない。 */
        if (chrome !== 'draft') setNotice('保存した下書きを読み込みました。続きを直せます。')
        if (restored.conditionUnreadable) {
          /*
           * 古い保存口が残した読めない条件。黙って「条件なし」へ戻すと
           * 全員へ届くルールに変わるので、付け直しを頼むまで保存させない
           * （AUTOMATION-04）。
           */
          setError('保存されていた「だれに」の条件は古い形のため読めませんでした。下の案内にしたがって付け直してください。')
        }
      })
      .catch((caught: unknown) => {
        if (cancelled || selectedAccountRef.current !== accountId) return
        setResumeStatus('failed')
        // R532: 失敗の理由を分ける。通信断では同じ下書きの再試行を出し、
        // 対象なし・権限なしでは白紙への作り直しを選ばせる。
        if (caught instanceof ApiError && caught.status === 404) {
          setResumeErrorKind('gone')
          setError('指定された下書きは見つかりませんでした。削除された可能性があります。')
        } else if (caught instanceof ApiError && caught.status === 403) {
          setResumeErrorKind('forbidden')
          setError(permissionDeniedMessage('store'))
        } else {
          setResumeErrorKind('network')
          setError('下書きを読み込めませんでした。通信状態を確かめて、もう一度お試しください。')
        }
      })
    return () => {
      cancelled = true
      /*
       * 読み終わる前に片付けられた（開いた直後の二度目の実行・番号の切り替え）なら、
       * 同じ番号をもう一度読めるように印を戻す。戻さないと「読み込んでいます」のまま止まる
       * （番号を最初から持って開く「下書きを仕上げる」で起きた）。
       */
      if (!settled && resumedKeyRef.current === key) resumedKeyRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, resumeTarget, resumeRetry])

  return { syncResumeUrl, bindAccountDraft, captureFormSnapshot, resumeBase }
}
