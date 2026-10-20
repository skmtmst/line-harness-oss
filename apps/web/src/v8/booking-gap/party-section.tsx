'use client'

import { useEffect, useRef, useState } from 'react'
import Dialog from '@/components/shared/dialog'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import { notifySaved } from '@/components/shared/toast'
import { bookingAdvancedApi } from '@/lib/api/helpers/booking-advanced'
import Card from '@/components/shared/card'

import { DataTable, Tr, Th, Td } from '@/components/shared/table'

import Button from '@/components/shared/button'
import TruncatedText from '@/components/shared/truncated-text'
import type { BookingGroupView as BookingParty } from '@line-crm/shared'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { hm } from './series-model'
import styles from './party-section.module.css'

/*
 * 予約の詳細パネルの段「この組（N 人）」（B5-3・Nx1kq）。人ごとのメニュー・担当・時間を並べ、
 * 組をまとめて取り消せる。閲覧のみの人には取消を出さない。同じ担当の 2 人は続けて並ぶ（重ならない）。
 */
export default function PartySection({ party, canOperate, canRemoveMember = false, currentBookingId, accountId, onChanged, onReload }: {
  party: BookingParty
  accountId?: string
  onChanged?: () => void
  onReload?: () => void
  canOperate: boolean
  /** 人を 1 人だけ外せるか（期限内・先払いでないときだけ。B5 の決定）。 */
  canRemoveMember?: boolean
  currentBookingId: string
}) {
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const preparing = usePreparingDialog()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancellable = party.members.filter((member) => member.status === 'requested' || member.status === 'confirmed')
  async function cancelAll() {
    if (!accountId || busy || !canOperate || !reason.trim() || cancellable.length === 0) return
    setBusy(true); setError('')
    try {
      const response = await bookingAdvancedApi.cancelGroup(accountId, party.groupId, reason.trim(), party.version)
      if (!active.current) return
      notifySaved(`${response.data.cancelled} 件の予約を取り消しました`)
      setOpen(false)
      onChanged?.()
    } catch {
      if (!active.current) return
      setError('取り消せませんでした。入力は残っています。この組を読み直して状態を確認してください。')
    } finally { if (active.current) setBusy(false) }
  }

  return (
    <Card padding="compact" layout="vertical" gap="var(--polish-space-field)" aria-label={`この組（${party.members.length} 人）`}>
      <header className={styles.head}>
        <h3 className={styles.title}>この組（{party.members.length} 人）</h3>
        {party.ownerName ? <span className={styles.owner}>{party.ownerName} さまの予約</span> : null}
      </header>
      <DataTable>
        <thead><Tr><Th truncate>人</Th><Th truncate>メニュー</Th><Th truncate>担当</Th><Th truncate>時間</Th></Tr></thead>
        <tbody>
          {party.members.map((m) => (
            <Tr key={m.bookingId} data-current={m.bookingId === currentBookingId || undefined}>
              <Td><TruncatedText value={m.label || m.personName} /></Td><Td><TruncatedText value={m.menuName} /></Td><Td><TruncatedText value={m.staffName ?? '—'} /></Td><Td><TruncatedText value={`${hm(m.startsAt)}〜${hm(m.endsAt)}`} /></Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {canOperate ? <div className={styles.actions}>
        {canRemoveMember && party.members.length > 1 ? <Button variant="secondary" onClick={() => preparing.open('この人だけ取り消す')}>この人だけ取り消す</Button> : null}
        {cancellable.length > 0 ? <Button variant="danger" onClick={() => { if (!accountId) { preparing.open('組をまとめて取り消す'); return }; setReason(''); setError(''); setOpen(true) }}>組をまとめて取り消す</Button> : null}
      </div> : null}
      <Dialog open={open} title="組をまとめて取り消しますか？" titleNote={`${cancellable.length} 件の予約をまとめて取り消します`} size="small" contentLayout="form" tone="destructive"
        busy={busy} error={error || undefined} cancelLabel="キャンセル" onCancel={() => { if (!busy) setOpen(false) }} confirmLabel="まとめて取り消す" confirmDisabled={!canOperate || !reason.trim() || cancellable.length === 0} confirmDisabledReason="理由と操作権限を確認してください" onConfirm={() => void cancelAll()}>
        <Field label="取り消す理由" required><TextField aria-label="取り消す理由" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></Field>
        <p>取り消すと元に戻せません。来店済み・取消済みの予約は変えません。この操作ではLINEを自動送信しません。必要な連絡は受信箱から行ってください。</p>
        {error ? <Button onClick={onReload ?? onChanged}>この組を読み直す</Button> : null}
      </Dialog>
      {preparing.dialog}
    </Card>
  )
}
