'use client'

import { FormLeaveGuard } from '@/components/shared/form-leave-guard'

import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import { PageFrame, PageFooter } from '@/components/templates/page-frame'
import TruncatedText from '@/components/shared/truncated-text'
import { RowMenu } from '@/components/shared/row-actions'
import { ActionCell, DataTable, RowNameButton, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import Card from '@/components/shared/card'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { notifyToast } from '@/components/shared/toast'
import { useAccount } from '@/contexts/account-context'
import { jstDate } from '@/lib/jst-datetime'
import type { RestaurantTable } from '@/lib/restaurant-test-api'
import { AssignmentConflict, AssignmentRowDialog, AssignmentSection, PRIORITY, useAssignment } from '@/v8/booking-payments/public/assignment/index'
import type { RestaurantV8Context } from '@/v8/restaurant/booking-kit/public/shell/index'
import styles from './tables.module.css'

/*
 * 座席・卓管理 › 卓の割り当て方（・絵 jmVYJ）。受け付ける指定：?view=assign。
 * 人数に合う一番小さい卓から（固定）＋同じ大きさの卓の中の選び方。卓ごとに優先度と 1 日の上限。
 * 口は組3 の bookingAssignmentApi.getTables／saveTables（店舗ごと）。口が無い間は準備中の帯。
 */

const SEAT_TYPE_LABEL: Record<string, string> = { table: 'テーブル', counter: 'カウンター', private_room: '個室', terrace: 'テラス' }
const TABLE_LAYOUT = { headHeight: 'var(--polish-table-head)', rowHeight: 'var(--polish-table-row)', gap: 'var(--polish-space-card)', padding: '0 var(--polish-space-section)', bodyTextSize: 'var(--polish-text-body)', collapseScope: 'page' as const }

export default function TablesAssignBoard({ ctx, canEdit, heading, notice }: { ctx: RestaurantV8Context; canEdit: boolean; heading?: ReactNode; notice?: ReactNode }) {
  const { data, store } = ctx
  const { selectedAccountId } = useAccount()
  const assignment = useAssignment(selectedAccountId && store ? { kind: 'tables', accountId: selectedAccountId, storeId: store.id } : null)
  const rows: RestaurantTable[] = (store ? data.tables.filter((table) => table.store_id === store.id) : data.tables).filter((table) => table.is_active)
  const order = rows.map((table) => table.id)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const preparing = usePreparingDialog()
  const [target, setTarget] = useState<RestaurantTable | null>(null)
  const today = jstDate(new Date())
  const todayCount = (id: string) => data.reservations.filter((item) => item.table_id === id && jstDate(new Date(item.starts_at)) === today && !['cancelled', 'no_show', 'rejected'].includes(item.status)).length

  return (
    <PageFrame kind="restaurant" standalone boardId="jmVYJ" hasFooter={canEdit}>
      {heading}
      <div data-template-region="body">
      <div className={styles.assignStack}>
      {notice}
      <FormLeaveGuard dirty={assignment.dirty} busy={assignment.saving} />
      <AssignmentSection state={assignment} kind="tables" canEdit={canEdit} />
      <Card overflow="hidden">
        <DataTable aria-label="卓の優先度と上限" columnSizing="content" columnLayout={TABLE_LAYOUT}>
          <thead><TableHeadRow data-table-layout="columns"><Th grow truncate>卓</Th><Th truncate>席数</Th><Th truncate>優先度</Th><Th truncate>1日の上限</Th><Th truncate>今日の予約</Th><Th showActionLabel>操作</Th></TableHeadRow></thead>
          <tbody>{rows.map((table) => {
            const setting = assignment.resources[table.id]
            const level = PRIORITY[setting?.priority ?? 'normal']
            const name = `${table.code}${table.label && table.label !== SEAT_TYPE_LABEL[table.seat_type] ? ` ${table.label}` : ''}`
            return (
              <Tr key={table.id} data-table-layout="columns">
                <Td grow><span className={styles.assignName}><RowNameButton onClick={() => canEdit && setTarget(table)} title={name}>{name}</RowNameButton><span className={styles.assignSub}>{SEAT_TYPE_LABEL[table.seat_type] ?? table.seat_type}</span></span></Td>
                <Td><TruncatedText value={`${table.max_capacity} 席`} /></Td>
                <Td><StatusBadge tone={level.tone} size="compact">{level.label}</StatusBadge></Td>
                <Td><TruncatedText value={setting?.dailyLimit ? `${setting.dailyLimit} 組` : '上限なし'} /></Td>
                <Td><TruncatedText value={`${todayCount(table.id)} 組`} /></Td>
                <ActionCell>{canEdit ? <RowMenu appearance="box" size="row" label={`${name}の操作`} open={openMenu === table.id} onOpenChange={(next) => setOpenMenu(next ? table.id : null)}
                  items={[{ id: 'assign', label: '割り当ての設定', onSelect: () => setTarget(table) }]} /> : null}</ActionCell>
              </Tr>
            )
          })}</tbody>
        </DataTable>
      </Card>
      </div>
      </div>
      {canEdit ? (
        <PageFooter actions={<>
          <Button onClick={assignment.reset} disabled={assignment.saving}>キャンセル</Button>
          <Button variant="primary" busy={assignment.saving} onClick={() => { if (!assignment.dirty) { notifyToast('変更はありません。'); return } if (assignment.status === 'not-ready') { preparing.open('卓の割り当て方の保存'); return } void assignment.save(order) }}><Check size={15} aria-hidden="true" />保存する</Button>
        </>} />
      ) : null}
      {preparing.dialog}
      <AssignmentRowDialog open={target !== null} name={target ? `卓 ${target.code}` : ''} unit="組" value={target ? assignment.resources[target.id] : undefined}
        onClose={() => setTarget(null)} onApply={(patch) => { if (target) assignment.setResource(target.id, patch) }} />
      <AssignmentConflict state={assignment} unit="組" order={order} subject="卓の割り当て方" names={Object.fromEntries(rows.map((table) => [table.id, `卓 ${table.code}`]))} />
    </PageFrame>
  )
}
