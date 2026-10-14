'use client'

import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { RowActions } from '@/components/shared/row-actions'
import TruncatedText from '@/components/shared/truncated-text'
import { shortDateTime, type HistoryRow } from './display'
import styles from './visit-stamps.module.css'

/** 記録の短い値は共通の1行省略、操作は共通の列配分へ渡す。 */
export default function HistoryTable({ rows, friendName, canManage, onOpenFriend, onReverse }: {
  rows: HistoryRow[]
  friendName: (id: string) => string
  canManage: boolean
  onOpenFriend: (id: string) => void
  onReverse: (id: string) => void
}) {
  return <DataTable className={styles.historyTable} columnSizing="controls" data-design="visit-stamp-history" label="押した・使った記録">
    <thead><TableHeadRow>
      <Th className={styles.colWhen}>いつ</Th>
      <Th className={styles.colFriend} grow>誰に</Th>
      <Th className={styles.colCount}>何個</Th>
      <Th className={styles.colWhy}>何で</Th>
      <Th className={styles.colActor}>誰が</Th>
      <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
    </TableHeadRow></thead>
    <tbody>{rows.map(row => <Tr key={row.id} data-row-id={row.id}>
      <Td className={styles.colWhen}><TruncatedText className={styles.plain} value={shortDateTime(row.at)} /></Td>
      <Td grow><TruncatedText className={styles.name} value={friendName(row.friendId)} /></Td>
      <Td className={styles.colCount}><TruncatedText className={`${styles.countText} ${row.reversed ? styles.countReversed : ''}`} value={row.count} /></Td>
      <Td className={styles.colWhy}><TruncatedText className={styles.muted} value={row.why} /></Td>
      <Td className={styles.colActor}><TruncatedText className={styles.muted} value={row.actor} /></Td>
      <Td className={styles.colMenu}>
        <RowActions subjectName={`${shortDateTime(row.at)} の記録`}
          menuItems={[{ id: 'friend', label: '友だちの詳細を開く', external: false, href: `/friends/detail?id=${encodeURIComponent(row.friendId)}`, onSelect: () => onOpenFriend(row.friendId) }]}
          destructiveItem={canManage && row.reversible ? { id: 'reverse', label: 'この記録を取り消す', onSelect: () => onReverse(row.id) } : undefined} />
      </Td>
    </Tr>)}</tbody>
  </DataTable>
}
