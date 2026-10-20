'use client'

import { jstDate as japanDate } from '@/lib/jst-datetime'

import type { ReservationBoardEntry } from '@line-crm/shared'
import { formatDate } from '@/lib/format'
import Button from './button'
import { FolderDotName } from './folder-dot'
import { ListFolderContext } from './list-folder-context'
import styles from './reservation-board.module.css'

/** 月の予約名も、共通の一行表示と全文の吹き出しで読む。 */
export default function ReservationMonth({ month, entries, onOpen, readableNames = false }: {
  month: string
  entries: ReservationBoardEntry[]
  onOpen: (id: string) => void
  readableNames?: boolean
}) {
  const first = new Date(month + '-01T00:00:00Z')
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return <ListFolderContext.Provider value={false}><div className={styles.month}>
    {Array.from({ length: first.getUTCDay() }, (_, index) => <div key={'blank' + index} />)}
    {Array.from({ length: count }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`
      return <div key={date}><strong>{index + 1}日</strong>{entries.filter(entry =>
        japanDate(new Date(entry.startsAt)) === date,
      ).map(entry => {
        const label = `${formatDate(entry.startsAt, { style: 'time' })} ${entry.customerName}`
        if (!readableNames) return <Button presentation="restaurant" key={entry.id} onClick={() => onOpen(entry.id)}>{label}</Button>
        return <Button presentation="restaurant" fullWidth key={entry.id} aria-label={label} title={label} onClick={() => onOpen(entry.id)}>
          <FolderDotName>{label}</FolderDotName>
        </Button>
      })}</div>
    })}
  </div></ListFolderContext.Provider>
}
