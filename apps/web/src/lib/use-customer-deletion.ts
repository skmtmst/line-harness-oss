'use client'
import { useRef, useState } from 'react'
import { ApiError, fetchApi } from './api'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { notifyToast } from '@/components/shared/toast'

export type CustomerDeletionTarget = { id: string; name: string; path: string; kind: 'form_response' | 'friend_data' }
/** Shared behavior only; the screen uses the existing RowMenu and ConfirmDialog. */
export function useCustomerDeletion(onDeleted: (target: CustomerDeletionTarget) => void | Promise<void>) {
  const [target, setTarget] = useState<CustomerDeletionTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const lock = useRef(false)
  const open = (next: CustomerDeletionTarget) => { if (!lock.current) { setError(''); setBlocked(false); setTarget(next) } }
  const close = () => { if (!lock.current) { setError(''); setTarget(null) } }
  const confirm = async () => {
    if (!target || lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try {
      const result = await fetchApi<{ success: boolean }>(target.path, {
        method: 'DELETE', headers: { 'X-Confirm-Irreversible': target.kind === 'friend_data' ? 'delete-friend-data' : 'delete-form-response' },
      })
      if (!result.success) throw new Error('deletion_failed')
      setTarget(null)
      notifyToast(target.kind === 'friend_data' ? '友だちのデータを削除しました' : '回答と添付を削除しました')
      await onDeleted(target)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'deletion_schema_approval_required') {
        setBlocked(true)
        setError('支払・監査の記録を残すため、データ構造の変更承認が必要です。オーナーか管理者に頼んでください。')
      } else if (caught instanceof ApiError && caught.code === 'deletion_in_progress') {
        setError('削除中です。少し待ってから、もう一度お試しください。')
      } else setError(describeApiFailure(caught, '削除', { scope: 'store' }))
    } finally { lock.current = false; setBusy(false) }
  }
  return { target, open, close, confirm, busy, blocked, error }
}
