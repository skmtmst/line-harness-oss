'use client'

import Card from '@/components/shared/card'

import { DataTable, Tr, Th, Td } from '@/components/shared/table'

import Button from '@/components/shared/button'
import type { BookingParty } from '@/lib/api-gap2-pending'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { hm } from './series-model'
import styles from './party-section.module.css'

/*
 * 予約の詳細パネルの段「この組（N 人）」（B5-3・Nx1kq）。人ごとのメニュー・担当・時間を並べ、
 * 組をまとめて取り消せる。閲覧のみの人には取消を出さない。同じ担当の 2 人は続けて並ぶ（重ならない）。
 */
export default function PartySection({ party, canOperate, canRemoveMember = false, currentBookingId }: {
  party: BookingParty
  canOperate: boolean
  /** 人を 1 人だけ外せるか（期限内・先払いでないときだけ。B5 の決定）。 */
  canRemoveMember?: boolean
  currentBookingId: string
}) {
  const preparing = usePreparingDialog()

  return (
    <Card padding="compact" layout="vertical" gap="var(--polish-space-field)" aria-label={`この組（${party.members.length} 人）`}>
      <header className={styles.head}>
        <h3 className={styles.title}>この組（{party.members.length} 人）</h3>
        <span className={styles.owner}>{party.ownerName} さまの予約</span>
      </header>
      <DataTable>
        <thead><Tr><Th>人</Th><Th>メニュー</Th><Th>担当</Th><Th>時間</Th></Tr></thead>
        <tbody>
          {party.members.map((m) => (
            <Tr key={m.bookingId} data-current={m.bookingId === currentBookingId || undefined}>
              <Td>{m.label}</Td><Td>{m.menuName}</Td><Td>{m.staffName}</Td><Td>{hm(m.startsAt)}〜{hm(m.endsAt)}</Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {canOperate ? <div className={styles.actions}>
        {canRemoveMember && party.members.length > 1 ? <Button variant="secondary" onClick={() => preparing.open('この人だけ取り消す')}>この人だけ取り消す</Button> : null}
        <Button variant="danger" onClick={() => preparing.open('組をまとめて取り消す')}>組をまとめて取り消す</Button>
      </div> : null}
      {preparing.dialog}
    </Card>
  )
}
