'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { notifySaved } from '@/components/shared/toast'
import { bookingPartyApi, type BookingParty } from '@/lib/api-gap2'
import { hm } from './series-model'
import styles from './party-section.module.css'

/*
 * 予約の詳細パネルの段「この組（N 人）」（B5-3・Nx1kq）。人ごとのメニュー・担当・時間を並べ、
 * 組をまとめて取り消せる。閲覧のみの人には取消を出さない。同じ担当の 2 人は続けて並ぶ（重ならない）。
 */
export default function PartySection({ party, accountId, canOperate, canRemoveMember = false, currentBookingId, onChanged }: {
  party: BookingParty
  accountId: string
  canOperate: boolean
  /** 人を 1 人だけ外せるか（期限内・先払いでないときだけ。B5 の決定）。 */
  canRemoveMember?: boolean
  currentBookingId: string
  onChanged: () => void
}) {
  const [confirm, setConfirm] = useState<'all' | 'member' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function cancel(scope: 'all' | 'member') {
    setBusy(true); setError('')
    try {
      const res = await bookingPartyApi.cancel(accountId, party.groupId, { scope, bookingId: scope === 'member' ? currentBookingId : undefined, expectedVersion: party.version })
      notifySaved(`${res.data.cancelled} 件の予約を取り消しました`)
      setConfirm(null)
      onChanged()
    } catch {
      setError('取り消せませんでした。画面を読み直してからもう一度お試しください。')
    } finally { setBusy(false) }
  }

  return (
    <section className={styles.card} aria-label={`この組（${party.members.length} 人）`}>
      <header className={styles.head}>
        <h3 className={styles.title}>この組（{party.members.length} 人）</h3>
        <span className={styles.owner}>{party.ownerName} さまの予約</span>
      </header>
      <table className={styles.table}>
        <thead><tr><th>人</th><th>メニュー</th><th>担当</th><th>時間</th></tr></thead>
        <tbody>
          {party.members.map((m) => (
            <tr key={m.bookingId} data-current={m.bookingId === currentBookingId || undefined}>
              <td>{m.label}</td><td>{m.menuName}</td><td>{m.staffName}</td><td>{hm(m.startsAt)}〜{hm(m.endsAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canOperate ? <div className={styles.actions}>
        {canRemoveMember && party.members.length > 1 ? <Button variant="secondary" onClick={() => setConfirm('member')}>この人だけ取り消す</Button> : null}
        <Button variant="danger" onClick={() => setConfirm('all')}>組をまとめて取り消す</Button>
      </div> : null}
      <ConfirmDialog
        open={confirm !== null}
        destructive
        title={confirm === 'member' ? 'この人の予約だけ取り消しますか？' : '組をまとめて取り消しますか？'}
        description={confirm === 'member' ? '同じ組のほかの人の予約は残ります。取り消すと元に戻せません。' : `${party.members.length} 人分の予約をすべて取り消します。取り消すと元に戻せません。`}
        confirmLabel={confirm === 'member' ? 'この人を取り消す' : '組を取り消す'}
        busyLabel="取り消しています…"
        busy={busy}
        error={error || undefined}
        onConfirm={() => cancel(confirm ?? 'all')}
        onCancel={() => { setConfirm(null); setError('') }}
      />
    </section>
  )
}
