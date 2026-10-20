'use client'

import { describeApiFailure } from '@/components/shared/api-error-message'
import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { api, ApiError, type AutomationDraftAction, type AutomationDraftDetail } from '@/lib/api'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { canonicalJson, draftFingerprint, FormSnapshot, newOperationKey, TestConfirmation, TestRunRecord, testRunStatusLabel } from './draft-model'
import { StoredDraft, writeStoredDraft } from './draft-storage'

export function useAutomationTest({
  selectedAccountId, testFriendId, savedDraft, setError,
  prepareRunningRef, setPreparingTest, setNotice, bindAccountDraft,
  selectedAccountRef, describeDraftActions, setTestConfirmation, saveErrors,
  setTestRun, formStashRef, testConfirmation, testRunningRef,
  testTicketRef, setTesting,
}: {
  selectedAccountId: string | null
  testFriendId: string
  savedDraft: StoredDraft | null
  setError: Dispatch<SetStateAction<string>>
  prepareRunningRef: RefObject<boolean>
  setPreparingTest: Dispatch<SetStateAction<boolean>>
  setNotice: Dispatch<SetStateAction<string>>
  bindAccountDraft: (accountId: string, draft: StoredDraft | null) => void
  selectedAccountRef: RefObject<string | null>
  describeDraftActions: (list: AutomationDraftAction[], refs: AutomationDraftDetail["commonActionRefs"], versions: AutomationDraftDetail["commonActionVersions"]) => { contents: string[]; effects: string[]; unconfirmed: boolean; }
  setTestConfirmation: Dispatch<SetStateAction<TestConfirmation | null>>
  saveErrors: ReturnType<typeof useSaveFormErrors>
  setTestRun: Dispatch<SetStateAction<TestRunRecord | null>>
  formStashRef: RefObject<Record<string, FormSnapshot>>
  testConfirmation: TestConfirmation | null
  testRunningRef: RefObject<boolean>
  testTicketRef: RefObject<number>
  setTesting: Dispatch<SetStateAction<boolean>>
}) {
  const askOnePersonTest = async () => {
    const accountId = selectedAccountId
    const friendId = testFriendId.trim()
    const draft = savedDraft
    if (!draft || !accountId) {
      setError('実際に送る内容を確認するため、先に下書きを保存してください')
      return
    }
    if (!friendId) {
      setError('試す友だちのIDを入力してください')
      return
    }
    if (prepareRunningRef.current) return
    prepareRunningRef.current = true
    setPreparingTest(true)
    setError('')
    setNotice('')
    try {
      const detail = await api.automations.getDraft(draft.id, accountId)
      if (!detail.success) throw new Error(detail.error)
      // 別のタブで作り直されていたら、こちらの控えも新しい版へ合わせる。
      if (detail.data.draftVersionId !== draft.draftVersionId) {
        const refreshed = { id: draft.id, draftVersionId: detail.data.draftVersionId }
        writeStoredDraft(accountId, refreshed)
        bindAccountDraft(accountId, refreshed)
      }
      if (selectedAccountRef.current !== accountId) return
      const refs = detail.data.commonActionRefs ?? []
      const described = describeDraftActions(
        detail.data.actions, refs, detail.data.commonActionVersions ?? {},
      )
      /*
       * R486: 使う版・中身が確かめられない共通アクションがあるときは
       * 確認画面を開かない。「見ていないものを送る」を防ぐ。
       */
      if (described.unconfirmed || refs.some((ref) => !ref.versionId)) {
        setError('共通アクションの内容を確認できませんでした。編集を開き直して確かめてから、もう一度試してください')
        return
      }
      setTestConfirmation({
        accountId,
        draftId: draft.id,
        draftVersionId: detail.data.draftVersionId,
        fingerprint: draftFingerprint(detail.data),
        actionsFingerprint: canonicalJson(detail.data.actions),
        friendId,
        contents: described.contents,
        effects: described.effects,
        // R487: 確認時に見せた版の一式。実行前の照合へそのまま渡す。
        commonActionExpectations: refs.map((ref) => ({
          stepId: ref.stepId,
          commonActionId: ref.commonActionId,
          versionId: ref.versionId ?? '',
        })),
        // R484: 確認を開くたびに新しい鍵。同じ確認の再試行だけが同じ鍵。
        operationKey: newOperationKey(),
      })
    } catch (caught) {
      if (selectedAccountRef.current !== accountId) return
      const fieldFailure = saveErrors.capture(caught)
      { if (!fieldFailure)

      setError(
        describeApiFailure(caught, '読み込み'),
      ) }
    } finally {
      prepareRunningRef.current = false
      setPreparingTest(false)
    }
  }

  /**
   * 確認した中身だけを送る（N-358）。
   *
   * 送る直前にサーバーのいまの中身を取り直し、確認したときの指紋と
   * **1文字でも違えば送らない**。
   *
   * ここでの突き合わせは、利用者へ先に知らせるためのもの。**最後の砦は
   * Worker 側**にある。`api.automations.test` へ渡す `versionId` は
   * `getDraft` が返した札（`<版の行のid>.<中身の指紋>`）そのままで、Worker は
   * 実行記録を作る前にこの指紋と DB の中身を突き合わせ、違えば 409 で返す。
   * 画面側の突き合わせを外しても実送信は起きない（逆変異で確認済み）。
   */
  /**
   * R488: 受け付けた実行の状態を読み直す。待機が終わっていれば終わった
   * 状態に変わる。店が替わっていたら書かない。
   */
  const refreshTestRun = async (record: TestRunRecord, accountId: string): Promise<void> => {
    try {
      const detail = await api.automations.getRun(record.runId)
      if (!detail.success) return
      if (selectedAccountRef.current !== accountId) return
      const next = { ...record, status: detail.data.status }
      setTestRun((current) => current && current.runId === record.runId ? next : current)
      const stashed = formStashRef.current[accountId]
      if (stashed?.testRun?.runId === record.runId) stashed.testRun = next
    } catch (saveFailure) {
      saveErrors.capture(saveFailure)
      // 読み直しの失敗は黙る。古い状態のまま残し、押せばまた読める。
    }
  }

  const runOnePersonTest = async () => {
    const pending = testConfirmation
    if (!pending || testRunningRef.current) return
    testRunningRef.current = true
    // R485: 送信前の読み取りに番号を付ける。「やめる」で番号が進んだら、
    // 遅れて返っても送信へ進まない。
    const ticket = testTicketRef.current + 1
    testTicketRef.current = ticket
    setTesting(true)
    setError('')
    const sameAccount = () => selectedAccountRef.current === pending.accountId
    try {
      const latest = await api.automations.getDraft(pending.draftId, pending.accountId)
      if (!latest.success) throw new Error(latest.error)
      /*
       * R487: 下書きの版と中身に加え、確認した共通アクションの版も
       * いま解決されるものと照合する。束の切り替えは版の札を変えないので、
       * ここで先に気づけば Worker へ送る前に止められる（最後の砦は Worker）。
       */
      const latestRefs = latest.data.commonActionRefs ?? []
      const commonActionsUnchanged = latestRefs.length === pending.commonActionExpectations.length
        && pending.commonActionExpectations.every((expected) => {
          const current = latestRefs.find((ref) => ref.stepId === expected.stepId)
          return current?.commonActionId === expected.commonActionId
            && current?.versionId === expected.versionId
        })
      if (
        latest.data.draftVersionId !== pending.draftVersionId
        || draftFingerprint(latest.data) !== pending.fingerprint
        || !commonActionsUnchanged
      ) {
        if (sameAccount()) {
          setTestConfirmation(null)
          setError('確認したあとに下書きが変わりました。送っていません。もう一度、送る内容を確認してください')
        }
        return
      }
      // R485: 読み取り待ちに「やめる」を押されていたら送らない。
      if (ticket !== testTicketRef.current) return
      const result = await api.automations.test(
        pending.draftId, pending.accountId, pending.friendId, pending.draftVersionId,
        pending.operationKey, pending.commonActionExpectations,
      )
      if (!result.success) throw new Error(result.error)
      if (!sameAccount()) {
        /*
         * 第145回: 待っている間に店を替えたら、前の店の成否をこの画面へ
         * 書かない。ただし実行は要求IDで読み直せるよう控える。
         */
        const stashed = formStashRef.current[pending.accountId]
        if (stashed) {
          stashed.testRun = {
            runId: result.data.runId, status: result.data.status,
            accountId: pending.accountId, at: Date.now(),
          }
        }
        return
      }
      setTestConfirmation(null)
      const record: TestRunRecord = {
        runId: result.data.runId, status: result.data.status,
        accountId: pending.accountId, at: Date.now(),
      }
      setTestRun(record)
      const stashed = formStashRef.current[pending.accountId]
      if (stashed) stashed.testRun = record
      setNotice(`1人テストを受け付けました（${testRunStatusLabel(result.data.status)}）。結果は下の実行から確認できます。`)
    } catch (caught) {
      // 待っている間に店を替えたら、前の店の成否をこの画面へ書かない。
      if (!sameAccount()) return
      const fieldFailure = saveErrors.capture(caught)
      // R485: 取りやめた後の失敗は出さない。送っていないので黙って閉じる。
      if (ticket !== testTicketRef.current) {
        setTestConfirmation(null);

        return
      }
      // Worker が「確認したときと違う」と返したときも、画面側で気づいたときと
      // 同じ扱いにする。古い確認を開いたままにしない。
      if (caught instanceof ApiError && (caught.status === 409 || caught.code === 'version_conflict')) {
        setTestConfirmation(null)
      }
      { if (!fieldFailure)
      setError(
        describeApiFailure(caught, '送信'),
      ) }
    } finally {
      testRunningRef.current = false
      setTesting(false)
    }
  }

  /**
   * DETAIL-13の再開入口。新規作成はいつも新しい下書きを作るが、
   * 前に保存した下書きがあるなら「開く」ことをここで選べる。
   */

  return { refreshTestRun, askOnePersonTest, runOnePersonTest }
}
