import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { forgetCreatedFormDraft, readCreatedFormDraft, rememberCreatedFormDraft } from '@/lib/form-draft-session'
import { describeApiFailure } from '@/components/shared/api-error-message'

/** 作成元の記録がある下書きだけ、離れる時に版付きで消せるようにする。 */
export function useCreatedDraft({ accountId, id, revision, loaded, published, canEdit, canDelete, captureResource, waitForSave }: {
  accountId: string | null; id: string; revision: number | null; loaded: boolean; published: boolean; canEdit: boolean; canDelete: boolean
  captureResource: () => () => boolean; waitForSave: () => Promise<unknown> | null
}) {
  const [expected, setExpected] = useState(() => accountId && id ? readCreatedFormDraft(accountId, id) : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const deleting = useRef(false)
  const valid = loaded && expected !== null && expected === revision && !published
  const owned = valid && canEdit
  const writable = useRef(canEdit && canDelete)
  writable.current = canEdit && canDelete
  const expectedRef = useRef(expected)
  expectedRef.current = expected
  useEffect(() => {
    if (!loaded || expected === null || valid || !accountId) return
    forgetCreatedFormDraft(accountId, id)
    setExpected(null)
  }, [loaded, expected, valid, accountId, id])
  const saved = (nextRevision: number, automatic: boolean) => {
    if (!accountId || expectedRef.current === null) return
    if (automatic) {
      rememberCreatedFormDraft(accountId, id, nextRevision)
      expectedRef.current = nextRevision
      setExpected(nextRevision)
    } else {
      forgetCreatedFormDraft(accountId, id)
      expectedRef.current = null
      setExpected(null)
    }
  }
  const discard = async (leave: () => void) => {
    if (deleting.current || !owned || !writable.current || !accountId) return
    const isCurrent = captureResource()
    deleting.current = true; setBusy(true); setError('')
    try {
      let pending = waitForSave()
      while (pending) { await pending.catch(() => undefined); pending = waitForSave() }
      if (!isCurrent() || !writable.current) return
      const ownRevision = expectedRef.current
      if (ownRevision === null || readCreatedFormDraft(accountId, id) !== ownRevision) throw new Error('draft_changed')
      const impact = await api.forms.deleteImpact(id, accountId)
      if (!isCurrent() || !writable.current) return
      if (!impact.success || !impact.data.canDelete || impact.data.contentRevision !== ownRevision) {
        setError('下書きの状態が変わったため消せません。入力は残っています。編集を続けて最新の状態を確認してください。')
        return
      }
      try {
        const removed = await api.forms.remove(id, accountId, impact.data.revision)
        if (!removed.success) throw new Error(removed.error)
      } catch (cause) {
        // 応答が失われた時は、同じ店の同じ対象がなくなったと確認できた場合だけ移る。
        try { await api.forms.get(id, accountId) } catch (check) {
          if (check instanceof ApiError && check.status === 404) {
            if (!isCurrent()) return
            forgetCreatedFormDraft(accountId, id); setExpected(null); leave(); return
          }
        }
        throw cause
      }
      if (!isCurrent()) return
      forgetCreatedFormDraft(accountId, id); setExpected(null); leave()
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof ApiError && cause.status === 409
        ? 'ほかの人が更新したため消せません。入力は残っています。編集を続けて最新の状態を確認してください。'
        : describeApiFailure(cause, '下書きの削除'))
    } finally { deleting.current = false; if (isCurrent()) setBusy(false) }
  }
  return { owned, busy, error, saved, discard, deleting, clearError: () => setError('') }
}
