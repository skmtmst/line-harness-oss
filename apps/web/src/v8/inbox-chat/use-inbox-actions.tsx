'use client'
import { japaneseDetailOf } from '@/components/shared/api-error-message';
import { useOverlayFocus } from '@/components/shared/overlay-utils';
import { useSaveFormErrors } from '@/components/shared/save-form-errors';
import { ApiError, api, fetchApi, type ChatDetail as ApiChatDetail, type ChatListItem } from '@/lib/api';
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events';
import { runOptimistic } from '@/lib/undoable';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Chat } from './inbox-model';

type Options = {
  chatDetail: ApiChatDetail | null
  selectedChatId: string | null
  loadChatDetail: (chatId: string) => Promise<void>
  loadChats: () => Promise<void>
  saveErrors: ReturnType<typeof useSaveFormErrors>
  setError: Dispatch<SetStateAction<string>>
  setChatDetail: Dispatch<SetStateAction<ApiChatDetail | null>>
  setChats: Dispatch<SetStateAction<ChatListItem[]>>
  selectedAccountId: string | null
  selectedChatIdRef: RefObject<string | null>
  detailAccountRef: RefObject<string | null>
}

export function useInboxActions({ chatDetail, selectedChatId, loadChatDetail, loadChats, saveErrors, setError, setChatDetail, setChats, selectedAccountId, selectedChatIdRef, detailAccountRef }: Options) {

  const [showMemoEditor, setShowMemoEditor] = useState(false)

  const [memoDraft, setMemoDraft] = useState('')

  const [memoSaving, setMemoSaving] = useState(false)

  const [memoError, setMemoError] = useState('')

  const [attentionSaving, setAttentionSaving] = useState(false)

  useEffect(() => {
    setMemoDraft(chatDetail?.notes ?? '')
    setMemoError('')
    setShowMemoEditor(false)
  }, [chatDetail?.id, chatDetail?.notes])

  /** 担当を付け替える（設計 `TalkPane` の「担当」）。 */
  const handleOperatorUpdate = async (operatorId: string | null) => {
    if (!selectedChatId || !chatDetail) return
    try {
      await api.chats.update(selectedChatId, { operatorId, revision: chatDetail.revision })
      loadChatDetail(selectedChatId)
      loadChats()
    } catch (reason) {
      saveErrors.capture(reason)
      setError('担当の更新に失敗しました。')
    }
  }

  /*
   * 対応状況の切替は取り消せる軽い操作。押した瞬間に画面へ反映して
   * 裏で保存する（★V7 sTJsh §1）。失敗したら元の状況へ戻す。
   */
  const handleStatusUpdate = (newStatus: Chat['status']) => {
    if (!selectedChatId || !chatDetail) return
    const chatId = selectedChatId
    const previous = chatDetail.status
    const revision = chatDetail.revision
    const apply = (status: Chat['status']) => {
      setChatDetail((current) => (current?.id === chatId ? { ...current, status } : current))
      setChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, status } : chat)))
    }
    apply(newStatus)
    runOptimistic({
      request: () => api.chats.update(chatId, { status: newStatus, revision }),
      revert: () => apply(previous),
      failureMessage: '対応状況を変えられませんでした。',
      retry: () => handleStatusUpdate(newStatus),
      onSuccess: () => {
        loadChatDetail(chatId)
        loadChats()
        // 対応済み/未読の切替は未対応バッジに影響するので即時更新させる
        window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
      },
    })
  }

  /** 友だち一覧と同じ「注目」を受信箱の★から切り替える。 */
  const handleAttentionUpdate = async () => {
    if (!chatDetail || attentionSaving) return
    const updatingChatId = chatDetail.id
    const next = !chatDetail.isAttention
    setAttentionSaving(true)
    setChatDetail((current) => current?.id === updatingChatId ? { ...current, isAttention: next } : current)
    try {
      // N-040(#808): 友だちの現行改訂値を読んでから送り、競合は上書きしない。
      const detail = await fetchApi<{ success: boolean; data: { updatedAt: string } }>(
        `/api/friends/${chatDetail.friendId}`,
      )
      await fetchApi<{ success: boolean; data: unknown }>(
        `/api/friends/${chatDetail.friendId}/metadata?expectedUpdatedAt=${encodeURIComponent(detail.data.updatedAt)}`,
        { method: 'PUT', body: JSON.stringify({ __attention: next ? '1' : null }) },
      )
    } catch (error) {
      setChatDetail((current) => current?.id === updatingChatId ? { ...current, isAttention: !next } : current)
      if (error instanceof ApiError && error.status === 409) {
        setError('ほかの変更が先に保存されました。最新の状態で確認してもう一度お試しください。')
      } else {
        setError('注目の変更に失敗しました。')
      }
    } finally {
      setAttentionSaving(false)
    }
  }

  /*
   * 内部メモの紙を閉じる。Escape・キャンセル・フォーカス戻しで
   * 共通なので1か所にする(N-031)。
   */
  const closeMemoEditor = useCallback(() => {
    setMemoDraft(chatDetail?.notes ?? '')
    setMemoError('')
    setShowMemoEditor(false)
  }, [chatDetail?.notes])

  /*
   * role="dialog" の紙なのに Tab が裏の送信欄へ抜け、閉じても
   * フォーカスがボタンへ戻らなかった(N-031)。共通部品と同じ
   * useOverlayFocus で、Tabを紙の中に留め・Escapeで閉じ・
   * 閉じたら開いたボタンへフォーカスを戻す。
   */
  const memoPopoverRef = useOverlayFocus(showMemoEditor, closeMemoEditor, memoSaving)

  const handleSaveMemo = async () => {
    if (!selectedChatId || memoSaving) return
    /*
     * 保存を始めた会話と版を固定する(INBOX-25)。応答を待つ間に別の
     * 会話・アカウントへ切り替わっても、その画面へ結果を書き込まない。
     */
    const savingChatId = selectedChatId
    const savingAccountId = selectedAccountId
    const savingRevision = chatDetail?.revision
    const notes = memoDraft.trim() || null
    setMemoSaving(true)
    setMemoError('')
    try {
      const response = await api.chats.update(savingChatId, {
        notes,
        revision: savingRevision,
      })
      if (!response.success) throw new Error(response.error || '内部メモを保存できませんでした')
      // 返ってきた版を採用する。古い版のまま次の保存を送ると409になる。
      setChatDetail((current) => current && current.id === savingChatId
        ? { ...current, notes: response.data?.notes ?? notes, revision: response.data.revision }
        : current)
      setChats((current) => current.map((chat) => chat.id === savingChatId
        ? { ...chat, notes }
        : chat))
      // 開いている紙を閉じるのは、いまも同じ会話を見ているときだけ。
      if (selectedChatIdRef.current === savingChatId && detailAccountRef.current === savingAccountId) {
        setShowMemoEditor(false)
      }
    } catch (memoSaveError) {
      if (selectedChatIdRef.current === savingChatId && detailAccountRef.current === savingAccountId) {
        saveErrors.capture(memoSaveError)
        setMemoError(japaneseDetailOf(memoSaveError) || '内部メモを保存できませんでした')
      }
    } finally {
      setMemoSaving(false)
    }
  }

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: showMemoEditor && memoDraft !== (chatDetail?.notes ?? ''),
    busy: memoSaving,
    samePage: (destination) => destination.pathname === '/chats',
    onDiscard: () => { setShowMemoEditor(false); setMemoDraft(chatDetail?.notes ?? '') },
  })
  return { showMemoEditor, setShowMemoEditor, memoDraft, setMemoDraft, memoSaving, memoError, attentionSaving, setAttentionSaving, handleOperatorUpdate, handleStatusUpdate, handleAttentionUpdate, closeMemoEditor, memoPopoverRef, handleSaveMemo, leaveTarget, confirmLeave, cancelLeave }
}
