'use client'

/*
 * ★V8 予約台帳「一覧」（板 `Z3FoM`）。今週・今月もこの形で、その期間の予約を出す。
 *
 * 数5（予約・ご来店人数・LINE予約・媒体予約・未配席）→ 期間・状態の絞り込みと
 * 受信データを試す・手動予約を登録する → 予約タイムラインの表（時刻・予約元・お客さま・人数・卓・
 * コース・注意事項・状態・操作）→ ページ送り（一覧だけ）。
 */
import { Inbox, Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'
import { Panel, Stat, StatRow, Status } from '../booking-kit/shell'
import { INACTIVE_STATUSES, type LedgerView, isHold, maskPhone, mdhm, sourceKind, sourceName } from './format'
import styles from './reservations.module.css'

export const PAGE_SIZE = 20

export const LEDGER_STATUS_OPTIONS = [
  { value: 'all', label: 'すべての状態' },
  { value: 'pending,confirmed,seated,visited', label: '有効のみ' },
  { value: 'cancelled,no_show', label: '取消・無断のみ' },
]

export default function ListView({ view, rows, total, tables, page, period, status, busy, canWrite, canImport, onPeriod, onStatus, onPage, onImport, onCreate, onOpen, onCancel, onRestore }: {
  view: LedgerView
  rows: RestaurantReservation[]
  /** 一覧は口の総数（ページ送りの母数）。今週・今月は表示中の数。 */
  total: number
  tables: RestaurantTable[]
  page: number
  period: string
  status: string
  busy: boolean
  canWrite: boolean
  /** 受信データの試し（媒体受信の口）は管理者だけ。 */
  canImport: boolean
  onPeriod: (value: string) => void
  onStatus: (value: string) => void
  onPage: (page: number) => void
  onImport: () => void
  onCreate: () => void
  onOpen: (id: string) => void
  onCancel: (id: string) => void
  onRestore: (id: string) => void
}) {
  const live = rows.filter((item) => !INACTIVE_STATUSES.includes(item.status) && !isHold(item))
  const guests = live.reduce((sum, item) => sum + item.guest_count, 0)
  const cancelledGuests = rows.filter((item) => INACTIVE_STATUSES.includes(item.status)).reduce((sum, item) => sum + item.guest_count, 0)
  const lineCount = live.filter((item) => item.source === 'line').length
  const mediaCount = live.filter((item) => sourceKind(item.source) === 'media' || item.source === 'restaurant_board').length
  const unseated = live.filter((item) => !item.table_id).length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const tableById = new Map(tables.map((table) => [table.id, table]))

  return (
    <>
      <StatRow>
        <Stat label="予約" value={`${total}件`} note={`表示中 ${rows.length}件`} />
        <Stat label="ご来店人数" value={`${guests}名`} note={`表示中の${rows.length}件${cancelledGuests > 0 ? `・取消 ${cancelledGuests} 名を除く` : ''}`} />
        <Stat label="LINE予約" value={`${lineCount}`} note="自社導線" />
        <Stat label="媒体予約" value={`${mediaCount}`} note="受信した予約" />
        <Stat label="未配席" value={`${unseated}`} note="卓の割当が必要" warning={unseated > 0} />
      </StatRow>
      <div className={styles.filterRow}>
        {view === 'list' ? (
          <>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>期間</span>
              <Select aria-label="期間" size="full" value={period} onChange={onPeriod} options={[
                { value: 'upcoming', label: '今後の予約' },
                { value: 'all', label: 'すべての期間' },
                { value: 'past', label: '過去の予約' },
              ]} />
            </div>
            <div className={styles.filterField}>
              <span className={styles.filterLabel}>状態</span>
              <Select aria-label="状態" size="full" value={status} onChange={onStatus} options={LEDGER_STATUS_OPTIONS} />
            </div>
          </>
        ) : null}
        <span className={styles.dateSpacer} />
        {canImport ? <Button disabled={busy} onClick={onImport}><Inbox size={15} aria-hidden="true" />受信データを試す</Button> : null}
        {canWrite ? <Button variant="primary" disabled={busy} onClick={onCreate}><Plus size={15} aria-hidden="true" />手動予約を登録する</Button> : null}
      </div>
      <Panel title="予約タイムライン" description="媒体別の色と、配席・コースを同時に確認します。" flush>
        {rows.length === 0 ? (
          <p className={styles.emptyText}>条件に合う予約はありません。</p>
        ) : (
          <DataTable className={styles.listTable}>
            <thead>
              <TableHeadRow className={styles.listHead}>
                <Th className={`${styles.lth} ${styles.lcTime}`}>時刻</Th>
                <Th className={`${styles.lth} ${styles.lcSource}`}>予約元</Th>
                <Th className={`${styles.lth} ${styles.lcCustomer}`}>お客さま</Th>
                <Th className={`${styles.lth} ${styles.lcGuests}`} align="right">人数</Th>
                <Th className={`${styles.lth} ${styles.lcTable}`}>卓</Th>
                <Th className={`${styles.lth} ${styles.lcCourse}`}>コース</Th>
                <Th className={`${styles.lth} ${styles.lcNote}`}>注意事項</Th>
                <Th className={`${styles.lth} ${styles.lcStatus}`}>状態</Th>
                <Th className={`${styles.lth} ${styles.lcOps}`}>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {rows.map((item) => {
                const inactive = INACTIVE_STATUSES.includes(item.status)
                const hold = isHold(item)
                const kind = sourceKind(item.source)
                const table = item.table_id ? tableById.get(item.table_id) : null
                return (
                  <Tr key={item.id} className={styles.listRow}>
                    <Td className={styles.ltd}>{mdhm(item.starts_at)}</Td>
                    <Td className={styles.ltd}>
                      <span className={`${styles.sourcePill} ${kind === 'line' ? styles.pillLine : kind === 'phone' ? styles.pillPhone : item.source === 'tabelog' || item.source === 'gurunavi' ? styles.pillWarn : item.source === 'ikyu' || item.source === 'retty' || item.source === 'reszaiko' ? styles.pillInfo : styles.pillMedia}`}>{sourceName(item.source)}</span>
                    </Td>
                    <Td className={styles.ltd}>
                      <p className={styles.customerName} title={item.customer_name}>{hold ? '押さえ' : item.customer_name}</p>
                      <p className={styles.customerSub}>{hold ? (item.note || '仮押さえ') : item.line_uid ? 'LINE UID' : maskPhone(item.customer_phone) || '電話未登録'}</p>
                    </Td>
                    <Td className={styles.ltd} align="right">{`${item.guest_count}名`}</Td>
                    <Td className={styles.ltd}>
                      {table ? <span className={styles.clip} title={`${table.code}・${table.label}`}>{`${table.code}・${table.label}`}</span> : item.table_label ? item.table_label : <span className={styles.warnText}>未配席</span>}
                    </Td>
                    <Td className={styles.ltd}><span className={styles.clip} title={item.course_name ?? undefined}>{item.course_name || '席のみ'}</span></Td>
                    <Td className={styles.ltd}>{item.allergy_note && !hold ? <span className={styles.alertText}>{item.allergy_note}</span> : <span className={styles.mutedText}>—</span>}</Td>
                    <Td className={styles.ltd}><Status value={hold ? 'scheduled' : item.status} label={hold ? '押さえ' : undefined} /></Td>
                    <Td className={styles.ltd}>
                      {canWrite ? (
                        <span className={styles.rowActions}>
                          <Button disabled={busy} onClick={() => onOpen(item.id)}>変更</Button>
                          {inactive ? (
                            <Button disabled={busy} onClick={() => onRestore(item.id)}>復活</Button>
                          ) : (
                            <Button className={styles.dangerText} disabled={busy} onClick={() => onCancel(item.id)}>取消</Button>
                          )}
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
        {view === 'list' && pageCount > 1 ? (
          <div className={styles.pager}>
            <Pagination page={page} pageCount={pageCount} onPageChange={onPage} ariaLabel="予約台帳のページ送り" />
          </div>
        ) : null}
      </Panel>
      <Panel title="顧客カルテ" description="電話番号または LINE UID で名寄せする設計です。">
        <div className={styles.karte}>
          {live.slice(0, 3).map((item) => (
            <div key={item.id} className={styles.karteCard}>
              <p className={styles.karteName}>{item.customer_name}</p>
              <p className={styles.karteContact}>{item.line_uid ? 'LINE UID' : maskPhone(item.customer_phone) || '電話未登録'}</p>
              <p className={styles.karteRecent}>{`直近：${mdhm(item.starts_at)} / ${item.guest_count}名`}</p>
            </div>
          ))}
          {live.length === 0 ? <p className={styles.karteRecent}>表示中の予約がありません。</p> : null}
        </div>
      </Panel>
    </>
  )
}
