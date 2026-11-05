'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import { broadcastCorrectionApi } from '@/lib/api/features/broadcast-corrections'
import { lineSenderApi } from '@/lib/api/helpers/gap1'
import { readPermissionSessionSnapshot } from '@/lib/session-snapshot'
import { readStaffIdentity, staffIdentityGeneration } from '@/lib/staff-identity-state'
import { canEditBroadcastNow } from './write-access'

type Sender = { id: string; name: string; status: string }
type State = { senderId: string | null; sender: { name: string } | null; sentByStaffName: string | null; senderStale: boolean; version: number; testMode: boolean }
export function BroadcastSenderControl({ id, accountId, isDraft, allowed, lockedReason }: {
  id: string; accountId: string | null; isDraft: boolean; allowed: boolean; lockedReason?: string
}) {
  const [data, setData] = useState<State | null>(null)
  const [senders, setSenders] = useState<Sender[]>([])
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const saveErrors = useSaveFormErrors()
  const active = useRef(true), saving = useRef(false), generation = useRef(0)
  useEffect(() => {
    let alive = true
    active.current = true; generation.current += 1; saving.current = false; setBusy(false); setData(null); setError('')
    if (!accountId) { setError('アカウントを確認できませんでした。'); return () => { alive = false; active.current = false } }
    void Promise.all([broadcastCorrectionApi.getSender(id), isDraft ? lineSenderApi.list(accountId) : Promise.resolve({ data: [] })]).then(([saved, list]) => {
      if (!alive) return
      setData(saved.data); setValue(saved.data.senderId ?? ''); setSenders(list.data.filter(row => row.status === 'active'))
    }).catch(() => { if (alive) setError('送り手を読み込めませんでした。') })
    return () => { alive = false; active.current = false; generation.current += 1 }
  }, [id, accountId, attempt, isDraft])
  async function save() {
    if (!data || !data.testMode || saving.current || !allowed || !canEditBroadcastNow() || readPermissionSessionSnapshot()?.impersonation) return
    const ticket = generation.current, identity = readStaffIdentity(), identityGeneration = staffIdentityGeneration(), session = readPermissionSessionSnapshot()
    saving.current = true; setBusy(true); setError('')
    try {
      await broadcastCorrectionApi.setSender(id, value || null, data.version)
      if (active.current && generation.current === ticket && identity === readStaffIdentity() && identityGeneration === staffIdentityGeneration() && session === readPermissionSessionSnapshot()) setAttempt(n => n + 1)
    } catch (error) { if (active.current && generation.current === ticket && !saveErrors.capture(error)) setError('送り手を保存できませんでした。配信を読み直してから、もう一度お試しください。') }
    finally { if (active.current && generation.current === ticket) { saving.current = false; setBusy(false) } }
  }
  if (error) return <Notice tone="warn" message={error} action={<Button onClick={() => setAttempt(n => n + 1)}>読み直す</Button>} />
  if (!data) return <span>読み込み中…</span>
  if (!isDraft) return <span>{data.sender?.name ?? '店の名前'}{data.sentByStaffName ? `（担当：${data.sentByStaffName}）` : ''}</span>
  const reason = readPermissionSessionSnapshot()?.impersonation ? '代理ログイン中は変更できません。' : lockedReason ?? (!allowed ? '操作する権限を確認しています。' : !data.testMode ? '送り手の変更は模擬の配信で使えます。' : undefined)
  return <SaveErrorScope errors={saveErrors}>
    {data.senderStale && <Notice tone="warn" message="送り手の名前が変わりました。選び直してください。" />}
    <SaveErrorField names={['senderId']}><Select aria-label="送り手" value={value} onChange={setValue} lockedReason={reason} disabled={!allowed || busy}
      options={[{ value: '', label: '店の名前' }, ...(data.senderId && !senders.some(sender => sender.id === data.senderId) ? [{ value: data.senderId, label: `${data.sender?.name ?? '不明'}（現在は選べません）`, disabled: true }] : []), ...senders.map(sender => ({ value: sender.id, label: sender.name }))]} /></SaveErrorField>
    <Button lockedReason={reason} disabled={!allowed || busy || (!data.senderStale && value === (data.senderId ?? ''))} onClick={() => void save()}>送り手を保存</Button>
  </SaveErrorScope>
}
