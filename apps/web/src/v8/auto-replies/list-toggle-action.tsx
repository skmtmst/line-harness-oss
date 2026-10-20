'use client'

import { permissionDeniedMessage } from '@/components/shared/api-error-message'
import { useSaveFormErrors } from '@/components/shared/save-form-errors'
import { notifyToast } from '@/components/shared/toast'
import { api,ApiError } from '@/lib/api'
import type { Dispatch,RefObject,SetStateAction } from 'react'
import { AutoReply,PendingToggle } from './list-model'

type ToggleAutoReplyContext = {
  listContextKey: string
  load: () => Promise<void>
  pendingToggle: PendingToggle | null
  rules: AutoReply[]
  saveErrors: ReturnType<typeof useSaveFormErrors>
  selectedAccountId: string | null
  selectedAccountIdRef: RefObject<string | null>
  setOptimisticRows: Dispatch<SetStateAction<{ key: string; rows: AutoReply[]; } | null>>
  setPendingToggle: Dispatch<SetStateAction<PendingToggle | null>>
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
  setToggleError: Dispatch<SetStateAction<string>>
  setToggleReason: Dispatch<SetStateAction<string>>
  toggleReason: string
}

export function toggleAutoReply({ listContextKey, load, pendingToggle, rules, saveErrors, selectedAccountId, selectedAccountIdRef, setOptimisticRows, setPendingToggle, setSelectedIds, setToggleError, setToggleReason, toggleReason }: ToggleAutoReplyContext, target = pendingToggle) {
    if (!target) return
    if (target.accountId !== selectedAccountId) {
      setToggleError('アカウントが切り替わりました。操作する自動応答を選び直してください。')
      return
    }
    const requestAccountId = target.accountId
    const ids = target.ids
    const kind = target.kind
    const reason = toggleReason.trim() === '' ? null : toggleReason.trim()
    const key = listContextKey
    // 逆操作のために、変える前の止めた理由を覚えておく。
    const beforeStopReason = new Map(
      rules.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.stopReason ?? null] as const),
    )
    const applyOptimistic = (active: boolean, stopReasonOf: (id: string) => string | null) => {
      setOptimisticRows({
        key,
        rows: rules.map((r) =>
          ids.includes(r.id)
            ? { ...r, isActive: active, stopReason: active ? r.stopReason : stopReasonOf(r.id) }
            : r,
        ),
      })
    }
    const doneMessage = (targetKind: 'stop' | 'resume') =>
      ids.length === 1
        ? targetKind === 'resume'
          ? '自動応答を再開しました'
          : '自動応答を停止しました'
        : targetKind === 'resume'
          ? `${ids.length} 件の自動応答を再開しました`
          : `${ids.length} 件の自動応答を停止しました`
    const failedMessage = (targetKind: 'stop' | 'resume', forbidden: boolean) =>
      forbidden
        ? permissionDeniedMessage('store')
        : targetKind === 'stop'
          ? '自動応答を停止できませんでした。状態を読み直してからお試しください。'
          : '自動応答を再開できませんでした。状態を読み直してからお試しください。'
    const reloadIfSameAccount = () => {
      if (selectedAccountIdRef.current === requestAccountId) void load()
    }
    const sendToggle = (targetKind: 'stop' | 'resume', targetReasonOf: (id: string) => string | null, requestKeys = new Map<string, string>()) => {
      applyOptimistic(targetKind === 'resume', targetReasonOf)
      void (async () => {
        let failed = 0
        let forbidden = false
        for (const id of ids) {
          try {
            if (!requestKeys.has(id)) requestKeys.set(id, crypto.randomUUID())
            const result = targetKind === 'stop'
              ? await api.autoReplies.stop(id, { reason: targetReasonOf(id) }, requestKeys.get(id)!)
              : await api.autoReplies.update(id, { isActive: true })
            if (!result.success) failed += 1
          } catch (error) {
            saveErrors.capture(error);

            if (error instanceof ApiError && error.status === 403) forbidden = true
            failed += 1
          }
        }
        if (failed > 0) {
          setOptimisticRows(null)
          reloadIfSameAccount()
          notifyToast(failedMessage(targetKind, forbidden), {
            tone: 'error',
            actionLabel: 'もう一度',
            onAction: () => sendToggle(targetKind, targetReasonOf, requestKeys),
          })
          return
        }
        setOptimisticRows(null)
        setSelectedIds(new Set())
        reloadIfSameAccount()
        notifyToast(doneMessage(targetKind))
      })()
    }
    setPendingToggle(null)
    setToggleReason('')
    setToggleError('')
    sendToggle(kind, () => reason)
  }
