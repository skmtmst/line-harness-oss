'use client'

import Card from '@/components/shared/card'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import { formatTime } from '@/lib/format'
import type { BookingRequest } from '@/lib/api'
import PeopleVisitActions from './visit-actions'
import type { usePeopleVisitMarks } from './use-visit-marks'
import type { AccountStyle } from '@line-crm/shared'
import { bookingWords } from './words'

/** 日の台帳の一覧行。採用済みのその場の来店印だけを移す。 */
export default function PeopleDayList({ rows, canMark, visits, onOpen, usageStyle }: {
  usageStyle?: AccountStyle
  rows: BookingRequest[]
  canMark: boolean
  visits: ReturnType<typeof usePeopleVisitMarks>
  onOpen: (id: string) => void
}) {
  const words = bookingWords(usageStyle)
  return <>
    {canMark && visits.status === 'error' ? <Notice tone="danger">{words.mark}を読み込めませんでした。<Button onClick={visits.reload}>読み直す</Button></Notice> : null}
    {rows.length === 0 ? <ListState kind="empty" title="この日の予約はありません" /> : <ol className="flex flex-col gap-2" aria-label="時刻順の予約">
      {/* --tpl-bkd-row-pad（12 16）を変数1語で渡すと、Card が左右別々の余白だと見抜けず
          共通の下限 16 と突き合わされて `max(16px, 12px 16px)` になり、余白が 0 に落ちる。
          値を空白で分けて渡す（card.tsx の hasSides）。 */}
      {rows.map(row => <li key={row.id}><Card frame="inset" layout="horizontal" gap="normal" contentPadding="var(--space-12) var(--space-16)">
        <span className="font-semibold tabular-nums">{formatTime(row.starts_at)}</span>
        <span className="min-w-0 flex-1">
          <Button variant="text" textTone="ink" size="inline" onClick={() => onOpen(row.id)}>{row.friend_name ?? '名前の登録なし'}</Button>
          <span className="block truncate text-xs text-ink-secondary" title={`${row.menu_name}・${words.staff} ${row.staff_name}`}>{row.menu_name}・{words.staff} {row.staff_name}</span>
        </span>
        <PeopleVisitActions usageStyle={usageStyle} mark={visits.mark(row.id)} ready={visits.status === 'ready'} busy={visits.busy(row.id)}
          canMark={canMark && (row.status === 'confirmed' || visits.mark(row.id) !== null)}
          onMark={(kind, minutes) => void visits.markVisit(row.id, kind, minutes)} onUnmark={() => void visits.markVisit(row.id, null)} />
      </Card></li>)}
    </ol>}
  </>
}
