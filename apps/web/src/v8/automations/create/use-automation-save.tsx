'use client'

import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { type SegmentCondition } from '@/components/shared/condition-builder'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { notifySaved } from '@/components/shared/toast'
import { api, ApiError, type AutomationDraftAction } from '@/lib/api'
import { AUTOMATION_DRAFT_TRIGGER_OPTIONS } from '@line-crm/shared'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ActionDraft } from './action-draft'
import { conditionPayload } from './draft-conditions'
import { canonicalJson, draftDetailToForm, draftPayloadFingerprint, FormSnapshot, newOperationKey, TestRunRecord } from './draft-model'
import { clearStoredDraft, StoredDraft, writeStoredDraft } from './draft-storage'

export function useAutomationSave({
  saveErrors, selectedAccountRef, setConflict, conflict,
  selectedAccountId, eventType, suppressTriggerResetRef, setName,
  setEventType, setKeyword, setCondition, setConditionUnreadable,
  setTriggerConfig, setActions, setPreviewFailed, setSavedFingerprint,
  bindAccountDraft, setCompareOpen, setSaveOutcome, setError,
  setNotice, saveRunningRef, saving, blockedReason,
  validate, setSaving, name, draftEventType,
  normalizedTriggerConfig, condition, draftActions, captureFormSnapshot,
  saveOutcome, publishedRuleId, savedFingerprint, disarm,
  router, saveTicketRef, draftByAccountRef, createOpKeyRef,
  formStashRef, setSavedAt, setPublishedRuleId, setTestRun,
  setStoredDraftHint, setResumeTarget, syncResumeUrl, refreshAudiencePreview,
  setPreviewCount,
}: {
  saveErrors: ReturnType<typeof useSaveFormErrors>
  selectedAccountRef: RefObject<string | null>
  setConflict: Dispatch<SetStateAction<{ draftId: string; serverVersionId: string; serverName: string; serverEventLabel: string; serverActionCount: number; } | null>>
  conflict: { draftId: string; serverVersionId: string; serverName: string; serverEventLabel: string; serverActionCount: number; } | null
  selectedAccountId: string | null
  eventType: string
  suppressTriggerResetRef: RefObject<boolean>
  setName: Dispatch<SetStateAction<string>>
  setEventType: Dispatch<SetStateAction<string>>
  setKeyword: Dispatch<SetStateAction<string>>
  setCondition: Dispatch<SetStateAction<SegmentCondition | null>>
  setConditionUnreadable: Dispatch<SetStateAction<boolean>>
  setTriggerConfig: Dispatch<SetStateAction<Record<string, unknown>>>
  setActions: Dispatch<SetStateAction<ActionDraft[]>>
  setPreviewFailed: Dispatch<SetStateAction<boolean>>
  setSavedFingerprint: Dispatch<SetStateAction<string | null>>
  bindAccountDraft: (accountId: string, draft: StoredDraft | null) => void
  setCompareOpen: Dispatch<SetStateAction<boolean>>
  setSaveOutcome: Dispatch<SetStateAction<"failed" | "published" | "idle" | "saved">>
  setError: Dispatch<SetStateAction<string>>
  setNotice: Dispatch<SetStateAction<string>>
  saveRunningRef: RefObject<boolean>
  saving: boolean
  blockedReason: string | null
  validate: () => string | null
  setSaving: Dispatch<SetStateAction<boolean>>
  name: string
  draftEventType: "datetime" | "friend_add" | "tag_change" | "message_received" | "form_submitted" | "link_clicked" | "calendar_booked" | "daily" | "weekly" | "ec.order.confirmed"
  normalizedTriggerConfig: () => Record<string, unknown>
  condition: SegmentCondition | null
  draftActions: () => AutomationDraftAction[]
  captureFormSnapshot: () => FormSnapshot
  saveOutcome: "failed" | "published" | "idle" | "saved"
  publishedRuleId: string | null
  savedFingerprint: string | null
  disarm: () => void
  router: ReturnType<typeof useRouter>
  saveTicketRef: RefObject<Record<string, number>>
  draftByAccountRef: RefObject<Record<string, StoredDraft>>
  createOpKeyRef: RefObject<Record<string, string>>
  formStashRef: RefObject<Record<string, FormSnapshot>>
  setSavedAt: Dispatch<SetStateAction<number | null>>
  setPublishedRuleId: Dispatch<SetStateAction<string | null>>
  setTestRun: Dispatch<SetStateAction<TestRunRecord | null>>
  setStoredDraftHint: Dispatch<SetStateAction<StoredDraft | null>>
  setResumeTarget: Dispatch<SetStateAction<string | null | undefined>>
  syncResumeUrl: (targetId: string | null, mode?: "push" | "replace") => void
  refreshAudiencePreview: (accountId: string, draft: StoredDraft) => Promise<void>
  setPreviewCount: Dispatch<SetStateAction<number | null>>
}) {
  const reconcilePublishedDraft = async (accountId: string, draftId: string): Promise<boolean> => {
    try {
      const list = await api.automations.list({ accountId })
      if (!list.success) return false
      const found = list.data.find((item) => item.id === draftId)
      return !!found && (found.status === 'active' || found.status === 'stopped')
    } catch (saveFailure) {
      saveErrors.capture(saveFailure);

      return false
    }
  }

  /*
   * 競合の記録。保存済みのいまの内容を取り直し、
   * 自分の入力は残したまま帯で知らせる。比べる窓の材料にもする。
   */
  const recordConflict = async (targetDraftId: string, targetAccountId: string): Promise<boolean> => {
    try {
      const server = await api.automations.getDraft(targetDraftId, targetAccountId)
      if (!server.success) return false
      if (selectedAccountRef.current !== targetAccountId) return false
      const eventLabel = AUTOMATION_DRAFT_TRIGGER_OPTIONS.find(
        (option) => option.value === server.data.eventType,
      )?.label ?? server.data.eventType
      setConflict({
        draftId: targetDraftId,
        serverVersionId: server.data.draftVersionId,
        serverName: server.data.name,
        serverEventLabel: eventLabel,
        serverActionCount: server.data.actions.length,
      })
      return true
    } catch (saveFailure) {
      saveErrors.capture(saveFailure);

      return false
    }
  }

  /*
   * 競合のあと、保存されている内容で入力を置き換える。
   * 自分の未保存の入力は消えるので、比べる窓から選ぶのが先。
   */
  const reloadServerDraft = async () => {
    if (!conflict || !selectedAccountId) return
    const accountId = selectedAccountId
    try {
      const res = await api.automations.getDraft(conflict.draftId, accountId)
      if (!res.success) throw new Error(res.error)
      if (selectedAccountRef.current !== accountId) return
      const restored = draftDetailToForm(res.data)
      if (restored.eventType !== eventType) suppressTriggerResetRef.current = true
      setName(restored.name)
      setEventType(restored.eventType)
      setKeyword(restored.keyword)
      setCondition(restored.condition)
      setConditionUnreadable(restored.conditionUnreadable)
      setTriggerConfig(restored.triggerConfig)
      setActions(restored.actions)
      setPreviewFailed(false)
      const fingerprint = draftPayloadFingerprint(restored)
      setSavedFingerprint(fingerprint)
      bindAccountDraft(accountId, { id: res.data.id, draftVersionId: res.data.draftVersionId })
      writeStoredDraft(accountId, { id: res.data.id, draftVersionId: res.data.draftVersionId })
      setConflict(null)
      setCompareOpen(false)
      setSaveOutcome('saved')
      setError('')
      setNotice('最新の内容を読み込みました。表示は保存されている内容です。')
    } catch (saveFailure) {
      const fieldFailure = saveErrors.capture(saveFailure);

      if (selectedAccountRef.current === accountId) {
        { if (!fieldFailure)

        setError('最新の内容を読み込めませんでした。通信状態を確かめて、もう一度お試しください。') }
      }
    }
  }

  const save = async (activate: boolean, force = false) => {
    // N-357: 連打で下書きが2つできないよう、描き直しより先に鍵をかける。
    if (saveRunningRef.current) return
    if (saving || blockedReason) return
    /* 比べてから保存：競合の版を承知の上で上書きする。 */
    const forcedVersion = force ? conflict?.serverVersionId : undefined
    setConflict(null)
    const invalid = validate()
    if (invalid) {
      setNotice('')
      return
    }
    saveRunningRef.current = true
    setSaving(true)
    setError('')
    setNotice('')
    const accountId = selectedAccountId
    /*
     * 保存直前に「送る中身」と「そのアカウントの入力一式」を固める。
     * 非同期の途中で店が切り替わっても、送る店・送る中身は押した時点のもの。
     */
    const payload = {
      name: name.trim(),
      eventType: draftEventType,
      triggerConfig: normalizedTriggerConfig(),
      conditions: conditionPayload(condition),
      // すること（アクション）は { type, params } の形で持つ。
      // params の中身は type ごとに違う。
      actions: draftActions(),
    }
    const fingerprint = canonicalJson(payload)
    const formAtSave = captureFormSnapshot()
    /*
     * R491: すでに公開済みの内容をそのまま「つくって動かす」と、
     * 同じ稼働ルールが2件になる。変えていないなら一覧へ案内し、
     * 変えた後なら新しいルールとして作る（明示的な作り直し）。
     */
    if (saveOutcome === 'published' && publishedRuleId && savedFingerprint === fingerprint) {
      setError('この内容はすでに公開済みです。一覧で確認してください。')
      setNotice('')
      disarm()
      router.push(`/automations?highlight=${publishedRuleId}`)
      return
    }
    // R491: 公開待ちの応答を要求の世代で照合するための番号。
    const saveTicket = (saveTicketRef.current[accountId ?? ''] ?? 0) + 1
    if (accountId) saveTicketRef.current[accountId] = saveTicket
    // R490: 公開の POST まで進んだか。再試行の案内と照合に使う。
    let publishAttempted = false
    let publishDraftId: string | null = null
    // R490: 照合は catch からも触るので、try の外で持つ。
    let draft: StoredDraft | null = null
    try {
      if (!accountId) throw new Error('LINE公式アカウントを選んでください')
      /*
       * DETAIL-13/14: 更新するのは「いま選んでいるアカウントに結び付いた
       * 下書き」だけ。画面の記憶ではなくアカウント別の控えを見るので、
       * 前に保存した別の下書きや、別の店の下書きを上書きすることはない。
       * 結び付いていなければ新しい下書きを作る（新規作成＝新規ID）。
       */
      draft = draftByAccountRef.current[accountId] ?? null
      if (!draft) {
        /*
         * DETAIL-13: 作成操作の冪等鍵。まだ下書きが無い保存のたびに振り直すと、
         * 作成に成功したあと更新で失敗→やり直し、のとき別の下書きが増える。
         * 同じ操作の再試行は同じ鍵で呼ぶので、サーバーは同じ下書きを返す。
         * 別の新規作成（一覧からの再入場・公開後の再作成）は別の鍵になる。
         */
        const operationKey = createOpKeyRef.current[accountId]
          ?? (createOpKeyRef.current[accountId] = newOperationKey())
        const created = await api.automations.createDraftFromTemplate(
          'received-message-tag', accountId, operationKey,
        )
        if (!created.success) throw new Error(created.error)
        draft = created.data
        writeStoredDraft(accountId, draft)
      }
      const res = await api.automations.updateDraft(draft.id, accountId, {
        expectedDraftVersionId: forcedVersion ?? draft.draftVersionId,
        ...payload,
      })
      if (!res.success) throw new Error(res.error)
      /*
       * 保存すると中身が変わるので、版の札も新しくなる。取り直してから
       * 見込み人数と公開へ渡す。古い札のままだと Worker に弾かれる（それが正しい）。
       *
       * R489: 公開するのは「自分の保存が作った版」だけ。保存と読み直しの
       * 間に別の人が保存すると、読み直しが返すのはその人の版になる。
       * 版の札には中身の指紋が入っているので、札が違う＝中身が違う。
       * そのまま使うと自分が確認していない内容を公開してしまうため、
       * 409 と同じ扱いで止めて、双方の入力を残して案内する。
       */
      const saved = await api.automations.getDraft(draft.id, accountId)
      if (!saved.success) throw new Error(saved.error)
      /*
       * R489・: 承知の上書き（force）でなければ、ほかの人の保存と
       * 重なったら帯で知らせる。自分の入力は残す。
       */
      if (!forcedVersion && saved.data.draftVersionId !== res.data.draftVersionId) {
        if (await recordConflict(draft.id, accountId)) return
        throw new ApiError(
          409,
          'ほかの人が同じ下書きを保存しました。内容を確かめてから、もう一度お試しください',
          'version_conflict',
        )
      }
      draft = { id: draft.id, draftVersionId: res.data.draftVersionId }
      writeStoredDraft(accountId, draft)
      const savedTime = Date.now()
      /*
       * 結果の書き込みは「保存を始めたアカウント」の控えへ。いま画面に
       * 出しているのが別のアカウントでも、そのアカウントへ戻ったときに
       * 保存済みの状態（版・時刻・指紋）がそのまま戻る。
       */
      formStashRef.current[accountId] = {
        ...formAtSave,
        savedDraft: draft,
        savedAt: savedTime,
        savedFingerprint: fingerprint,
        saveOutcome: 'saved',
        publishedDefinitionId: null,
        // 保存し直したら前の1人テストの結果は古い内容のもの。残さない。
        testRun: null,
      }
      bindAccountDraft(accountId, draft)
      if (selectedAccountRef.current === accountId) {
        setSavedAt(savedTime)
        setSavedFingerprint(fingerprint)
        setSaveOutcome('saved')
        setPublishedRuleId(null)
        setTestRun(null)
        setStoredDraftHint(null)
        // 再読込・「戻る」でこの下書きへ戻れるよう、URLへ番号を載せる。
        // 再開では番号と中身・版を一緒に読むので、空の画面からの
        // 上書きにはならない（DETAIL-13）。「戻る」で新規画面へ戻れるよう
        // 履歴には積む。
        setResumeTarget(draft.id)
        syncResumeUrl(draft.id, 'push')
      }
      /*
       * AUTOMATION-03: 人数の確認は「保存」の外で行う。ここまで来た時点で
       * 下書きは保存済みなので、人数の失敗を保存の失敗へ混ぜない。
       * 待たずに進める（失敗は previewFailed で別に出る）。
       */
      void refreshAudiencePreview(accountId, draft)
      if (!activate) {
        if (selectedAccountRef.current === accountId) {
          notifySaved('下書きに保存しました。見込み人数を確認して、1人で試せます。')
        }
        return
      }
      /*
       * R483: 新規作成の下書きは状態が draft のはず。読み取り後の停止・再開を
       * 読んだ時点の状態で上書きしないよう、見た状態を条件に入れる。
       */
      publishAttempted = true
      publishDraftId = draft.id
      const published = await api.automations.publishDraft(draft.id, accountId, draft.draftVersionId, true, 'draft')
      if (!published.success) throw new Error(published.error)
      // 公開したら下書きは無くなるので控えも捨てる。
      clearStoredDraft(accountId)
      bindAccountDraft(accountId, null)
      if (selectedAccountRef.current === accountId
        && saveTicketRef.current[accountId] === saveTicket) {
        disarm()
        router.push(`/automations?highlight=${draft.id}`)
      } else {
        /*
         * R491: 別の店を見ている間に公開が済んだ。控えを「公開済み」にして、
         * 戻ったときに未公開の下書きと受け取って作り直さないようにする。
         * 古い番号の応答（世代が違う）は何も書かない。
         */
        if (saveTicketRef.current[accountId] === saveTicket) {
          const stashed = formStashRef.current[accountId]
          if (stashed) {
            stashed.savedDraft = null
            stashed.saveOutcome = 'published'
            stashed.publishedDefinitionId = draft.id
          }
        }
      }
    } catch (caught) {
      const fieldFailure = saveErrors.capture(caught)
      /*
       * : 版の重なり（409）は帯で知らせる。結び付き・控えは捨てず、
       * 自分の入力のまま比べ直せるようにする。消えた下書き（404）だけ
       * 従来どおり控えを捨てて作り直す。
       */
      if (
        draft && accountId
        && caught instanceof ApiError
        && (caught.status === 409 || caught.code === 'version_conflict')
      ) {
        if (await recordConflict(draft.id, accountId)) {
          if (selectedAccountRef.current === accountId) {
            setSaveOutcome('failed')
            { if (!fieldFailure)
            setError('') }
          }
          return
        }
      }
      // 下書き自体が無くなっていたら控えを捨て、次は作り直す（N-357）。
      if (
        caught instanceof ApiError &&
        (caught.status === 404 || caught.status === 409 || caught.code === 'not_found' || caught.code === 'version_conflict')
      ) {
        /*
         * R490: 動かし始める操作で下書きが404/409のときは、公開済みか先に
         * 照合する。公開の応答が失われたあとの再試行では、更新の404が
         * 公開済みの合図になる。公開済みなら作り直さず元のルールへ案内し、
         * 稼働ルールを2件にしない。
         */
        if (activate && draft && accountId) {
          const reconciled = await reconcilePublishedDraft(accountId, draft.id)
          if (reconciled) {
            clearStoredDraft(accountId)
            bindAccountDraft(accountId, null)
            const stashed = formStashRef.current[accountId]
            if (stashed) {
              stashed.savedDraft = null
              stashed.saveOutcome = 'published'
              stashed.publishedDefinitionId = draft.id
              stashed.savedAt = null
            }
            if (selectedAccountRef.current === accountId) {
              setSaveOutcome('published')
              setPublishedRuleId(draft.id)
              setResumeTarget(null)
              syncResumeUrl(null)
              { if (!fieldFailure)
              setNotice('すでに公開されています。一覧で確認できます。') }
              disarm()
              router.push(`/automations?highlight=${draft.id}`)
            }
            saveRunningRef.current = false
            setSaving(false)
            return
          }
        }
        if (accountId) {
          clearStoredDraft(accountId)
          bindAccountDraft(accountId, null)
          const stashed = formStashRef.current[accountId]
          if (stashed) {
            stashed.saveOutcome = 'idle'
            stashed.savedFingerprint = null
            stashed.savedAt = null
            stashed.publishedDefinitionId = null
            stashed.previewCount = null
            stashed.previewFailed = false
          }
        }
        if (selectedAccountRef.current === accountId) {
          setSaveOutcome('idle')
          setSavedFingerprint(null)
          setSavedAt(null)
          setPublishedRuleId(null)
          setPreviewCount(null)
          setPreviewFailed(false)
          // 消えた下書きの番号をURLに残さない。残すと再読込のたびに
          // 「読み込めません」が出てしまう。
          setResumeTarget(null)
          syncResumeUrl(null)
        }
      } else if (accountId) {
        const stashed = formStashRef.current[accountId]
        if (stashed) stashed.saveOutcome = 'failed'
      }
      if (selectedAccountRef.current === accountId) {
        setSaveOutcome('failed')
        /*
         * R490: 公開の POST まで進んだ後の通信切れは、成功か失敗か分からない。
         * 同じ操作を繰り返す前に一覧で公開済みか確かめるよう案内する。
         */
        if (activate && publishAttempted && publishDraftId
          && !(caught instanceof ApiError && (caught.status === 404 || caught.status === 409))) {
          { if (!fieldFailure)
          setError('通信が切れて結果が分かりませんでした。公開されているか一覧で確認してから、もう一度お試しください。')
        }
        } else {
          { if (!fieldFailure)
          setError(
            japaneseDetailOf(caught) || '下書きを保存できませんでした。状態を読み直してから、もう一度お試しください。',
          ) }
        }
      }
    } finally {
      saveRunningRef.current = false
      setSaving(false)
    }
  }

  return { saveErrors, reloadServerDraft, save }
}
