'use client'

import type { MileageAdminHistoryItem } from '@/lib/api'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { FolderDotName } from '@/components/shared/folder-dot'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import { formatNumber } from '@/lib/format'
import { emptyValue } from '@/components/shared/empty-value'
import { formatMileageChange, formatMileageShortDateTime, mileageEntryTypeLabel, mileageStatusLabel, mileageSourceLabel, mileageSourceNoteText } from './display'
import { MILEAGE_TABLE_LAYOUT } from './frame'
import styles from './mileage.module.css'

export default function HistoryTable({ items, readonly, menuId, setMenuId, openPending, viewName }: {
  items: MileageAdminHistoryItem[]; readonly: boolean; menuId: string | null
  setMenuId: (id: string | null) => void
  openPending: (kind: 'confirm' | 'void', item: MileageAdminHistoryItem) => void
  viewName: (item: MileageAdminHistoryItem) => string
}) {
  const router = useRouter()
  return (
    <div className={styles.tableWrap}>
      <DataTable columnLayout={MILEAGE_TABLE_LAYOUT}>
        <thead>
          <TableHeadRow data-table-layout="columns">
            <Th grow>いつ・だれに</Th>
            <Th align="right" className={styles.colDelta}>増減</Th>
            <Th className={styles.colWhy}>なぜ</Th>
            <Th align="right" className={styles.colAfter}>残高</Th>
            <Th collapseAt="narrow" className={styles.colWho}>だれが</Th>
            <Th className={styles.colOpsHistory}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {items.map((item) => {
            const pending = !readonly && item.status === 'pending'
            const reversible = !readonly && item.entryType === 'grant' && item.status === 'available'
            const friendHref = `/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`
            return (
              <Tr
                key={item.id}

                data-table-layout="columns"
                interactive
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('a, button, [role="menu"]')) return
                  router.push(friendHref)
                }} data-row-id={item.id}
              >
                <Td grow><FolderDotName>
                  <span  title={`${viewName(item)}・${formatMileageShortDateTime(item.occurredAt)}`}>{viewName(item)}</span>

                </FolderDotName></Td>
                <Td align="right" className={styles.colDelta}><span className={styles.cellMain}>{formatMileageChange(item.amount)}</span></Td>
                <Td className={styles.colWhy}>
                  <span
                    className={styles.cellMain}
                    title={`${item.reason} / ${mileageEntryTypeLabel(item.entryType)}・${mileageStatusLabel(item.status)} / ${mileageSourceLabel(item.source)} / ${mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: item.hasSourceEvent })}`}
                  >
                    {item.reason}
                  </span>
                  <span className={styles.cellSub}>{`${mileageEntryTypeLabel(item.entryType)}・${mileageStatusLabel(item.status)}`}</span>
                </Td>
                <Td align="right" className={styles.colAfter}>
                  <span className={styles.cellMain}>{item.balanceAfter === null ? emptyValue('unknown') : formatNumber(item.balanceAfter)}</span>
                </Td>
                <Td collapseAt="narrow" className={styles.colWho}>
                  <span className={styles.cellMain}>
                    {item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : item.entryType === 'spend' ? '本人' : '自動'}
                  </span>
                </Td>
                <ActionCell>
                    {pending ? (
                      <Button onClick={() => openPending('confirm', item)}>確定する</Button>
                    ) : reversible ? (
                      <Button onClick={() => openPending('void', item)}>取り消す</Button>
                    ) : (
                      <Button href={friendHref}>友だちを見る</Button>
                    )}
                      <RowMenu
                        label={`${viewName(item)}の明細の操作`}
                        open={menuId === item.id}
                        onOpenChange={(next) => setMenuId(next ? item.id : null)}
                        items={[
                          ...(pending ? [{ id: 'void', label: '取り消す', onSelect: () => openPending('void', item) }] : []),
                          { id: 'friend', label: '友だちを見る', external: false, href: friendHref, onSelect: () => router.push(friendHref) },
                        ]}
                      />
                </ActionCell>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )
}
