'use client'

/*
 * 「今日のお店」の今日の予約の表（E-1 `今日の予約`）。
 * 列：時刻・名前・人数・卓・経路・状態・来店。予約中の行に［✓ 来店］（来店の印の口）と「…」。
 * 閲覧のみには［来店］と「…」の変える操作を置かない。
 */
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SectionHeader from '@/components/shared/section-header'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import type { RestaurantReservation } from '@/lib/restaurant-test-api'
import { pad2 } from '../front-desk/slots'
import { isWalkIn } from '../front-desk/walk-in'
import { sourceName } from '../reservations/format'
import { canMarkVisited, visitState } from './summarize'
import styles from './dashboard.module.css'

function hm(iso: string): string {
  const day = new Date(iso)
  return `${pad2(day.getHours())}:${pad2(day.getMinutes())}`
}

export function routeLabel(r: Pick<RestaurantReservation, 'source' | 'note'>): string {
  return isWalkIn(r) ? 'ウォークイン' : sourceName(r.source)
}

export function TodayTable({ rows, canWrite, busyId, onVisited, onUndo }: {
  rows: RestaurantReservation[] | null
  canWrite: boolean
  busyId: string
  onVisited: (id: string) => void
  onUndo: (id: string) => void
}) {
  const router = useRouter()
  const list = (rows ?? [])
    .filter((r) => r.status !== 'cancelled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  return (
    <div className={styles.today}>
      <SectionHeader
        title="今日の予約"
        help="取消を除く今日の予約です。来店したお客さまは［来店］を押すと来店済みになります。30秒ごとに読み直します。"
        helpLabel="今日の予約の説明"
        href="/restaurant-test/reservations"
        linkLabel="予約台帳へ"
      />
      {rows === null ? (
        <ListState kind="loading" />
      ) : list.length === 0 ? (
        <ListState kind="empty" title="今日の予約はまだありません" description={canWrite ? '電話予約・ウォークインから入れられます。' : undefined} />
      ) : (
        <DataTable className={styles.table} data-design="restaurant-today">
          <thead>
            <TableHeadRow className={styles.headRow} data-table-layout="columns">
              <Th className={styles.colTime}>時刻</Th>
              <Th className={styles.colName}>名前</Th>
              <Th className={styles.colGuests}>人数</Th>
              <Th className={styles.colTable}>卓</Th>
              <Th className={styles.colRoute}>経路</Th>
              <Th className={styles.colState}>状態・来店</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {list.map((r) => {
              const state = visitState(r)
              const seated = r.status === 'seated' || r.status === 'visited'
              const menuItems = [
                { id: 'open', label: '予約台帳で見る', external: true, onSelect: () => { router.push(`/restaurant-test/reservations?date=${r.starts_at.slice(0, 10)}`) } },
                ...(canWrite && seated ? [{ id: 'undo', label: '来店の印を取り消す', onSelect: () => onUndo(r.id) }] : []),
              ]
              return (
                <Tr key={r.id} className={styles.row} data-table-layout="columns">
                  <Td className={styles.colTime}><span className={styles.time}>{hm(r.starts_at)}</span></Td>
                  <Td className={styles.colName}><span className={styles.name} title={r.customer_name}>{r.customer_name}</span></Td>
                  <Td className={styles.colGuests}>{`${r.guest_count}名`}</Td>
                  <Td className={styles.colTable}>{r.table_label || '未配席'}</Td>
                  <Td className={styles.colRoute}><span className={styles.route}>{routeLabel(r)}</span></Td>
                  <Td className={styles.colState}>
                    <span className={styles.stateCell}>
                      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      <span className={styles.stateSpacer} />
                      {canWrite && canMarkVisited(r) ? (
                        <Button onClick={() => onVisited(r.id)} disabled={busyId === r.id} aria-label={`${r.customer_name}さんを来店にする`}>
                          <Check size={15} aria-hidden="true" />来店
                        </Button>
                      ) : null}
                      <RowActions className={styles.more} menuItems={menuItems} subjectName={r.customer_name} />
                    </span>
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  )
}
