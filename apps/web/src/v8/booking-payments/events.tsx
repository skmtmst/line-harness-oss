'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, Info, Link2, RefreshCw } from 'lucide-react'
import Button from '@/components/shared/button'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import Card from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import TruncatedText from '@/components/shared/truncated-text'
import { RowMenu } from '@/components/shared/row-actions'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import { ActionCell, DataTable, RowNameLink, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifySaved, notifyToast } from '@/components/shared/toast'
import { emptyValue } from '@/components/shared/empty-value'
import { formatListTimestamp, formatYen } from '@/lib/format'
import { bookingPaymentAdminApi, isNotReadyError, type PaymentEvent } from '@/lib/api/helpers/booking-payment-admin'
import { EVENT_KIND, EVENT_RESULT } from './labels'
import styles from './payments.module.css'

/* Stripe から届いた知らせ（UteeA の右）。失敗の行は「…」から［もう一度読む］。同じ知らせは二重に数えない。 */

const TABLE_LAYOUT = { headHeight: 'var(--polish-table-head)', rowHeight: 'var(--polish-table-row)', gap: 'var(--polish-space-card)', padding: '0 var(--polish-space-section)', bodyTextSize: 'var(--polish-text-body)', collapseScope: 'page' as const }
const RESULT_FILTER = [
  { value: '', label: '結果：すべて' },
  { value: 'applied', label: '結果：反映した' },
  { value: 'duplicate', label: '結果：もう反映済み' },
  { value: 'failed', label: '結果：失敗' },
]
const PERIOD_FILTER = [
  { value: '7d', label: '期間：この７日' },
  { value: '30d', label: '期間：過去30日' },
  { value: '90d', label: '期間：過去90日' },
]

type Load = { state: 'loading' } | { state: 'ready'; items: PaymentEvent[]; total: number } | { state: 'not-ready' } | { state: 'error' }

export default function PaymentEvents({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [result, setResult] = useState('')
  const [period, setPeriod] = useState('7d')
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const generation = useRef(0)
  const preparing = usePreparingDialog()

  const reload = useCallback(async () => {
    const mine = ++generation.current
    setLoad({ state: 'loading' })
    try {
      const response = await bookingPaymentAdminApi.events(accountId, { result, period, limit: 20 })
      if (mine === generation.current) setLoad({ state: 'ready', items: response.data.items, total: response.data.total })
    } catch (cause) {
      if (mine === generation.current) setLoad({ state: isNotReadyError(cause) ? 'not-ready' : 'error' })
    }
  }, [accountId, result, period])

  useEffect(() => { void reload() }, [reload])

  async function replay(event: PaymentEvent) {
    try {
      await bookingPaymentAdminApi.replayEvent(accountId, event.id)
      notifySaved('知らせをもう一度読みました')
      void reload()
    } catch (cause) {
      notifyToast(isNotReadyError(cause) ? 'データの準備が済むと、もう一度読めるようになります。' : 'もう一度読めませんでした。少し待ってからお試しください。')
    }
  }

  function menuFor(event: PaymentEvent): ActionMenuItem[] {
    return [
      ...(event.bookingId ? [{ id: 'open', label: '予約を開く', icon: <CalendarDays size={15} aria-hidden="true" />, href: `/booking/bookings?booking=${encodeURIComponent(event.bookingId)}` }] : []),
      ...(canEdit && event.result === 'failed' ? [{ id: 'replay', label: 'もう一度読む', icon: <RefreshCw size={15} aria-hidden="true" />, onSelect: () => void replay(event) }] : []),
    ]
  }

  if (load.state === 'not-ready') {
    return <Notice tone="info" icon={<Info size={16} aria-hidden="true" />}>Stripe から届いた知らせは、データの準備が済むと見られます。</Notice>
  }

  return (
    <div className={styles.events} data-design="PaymentEvents">
      <h2 className={styles.eventsTitle}>Stripe から届いた知らせ</h2>
      <div data-template-region="toolbar"><ListToolbar
        filters={<>
          <Select aria-label="結果" value={result} onChange={setResult} options={RESULT_FILTER} />
          <Select aria-label="期間" value={period} onChange={setPeriod} options={PERIOD_FILTER} />
        </>}
        trailing={<span className={styles.count}>{load.state === 'ready' ? `${load.total}件表示` : ''}</span>}
      /></div>
      {load.state === 'loading' ? <ListState kind="loading" title="届いた知らせを読み込んでいます" />
        : load.state === 'error' ? <ListState kind="error" title="届いた知らせを表示できませんでした" onRetry={() => void reload()} />
          : load.items.length === 0 ? <ListState kind="empty" title="この期間に届いた知らせはありません" />
            : (
              <Card overflow="hidden"><DataTable aria-label="Stripe から届いた知らせ" columnSizing="content" columnLayout={TABLE_LAYOUT}>
                <thead><TableHeadRow data-table-layout="columns"><Th truncate>日時</Th><Th grow truncate>種類</Th><Th truncate>予約</Th><Th truncate>結果</Th><Th showActionLabel>操作</Th></TableHeadRow></thead>
                <tbody>{load.items.map((event) => {
                  const badge = EVENT_RESULT[event.result]
                  const sub = event.note ?? (event.amount !== null ? formatYen(event.amount) : null)
                  const menu = menuFor(event)
                  return (
                    <Tr key={event.id} data-table-layout="columns">
                      <Td><TruncatedText value={formatListTimestamp(event.receivedAt)} /></Td>
                      <Td grow><span className={styles.eventKind}><span className={styles.cellStack}><TruncatedText value={`${EVENT_KIND[event.kind]}${event.repeat ? '（2回目）' : ''}`} />{sub ? <span className={styles.cellSub}>{sub}</span> : null}</span>
                        {/* 結び付け・返金APIは支払いIDが必要。この通知の契約に支払いIDが無い間は推測して実行しない。 */}
                        {canEdit && event.result === 'failed' && !event.bookingId && event.kind === 'paid' ? <span className={styles.eventFix}>
                          <Button size="compact" onClick={() => preparing.open('予約に結び付ける')}><Link2 size={14} aria-hidden="true" />予約に結び付ける</Button>
                          <Button size="compact" onClick={() => preparing.open('予約の無い支払いの返金')}>返金する</Button>
                        </span> : null}</span></Td>
                      <Td>{event.bookingId ? <RowNameLink href={`/booking/bookings?booking=${encodeURIComponent(event.bookingId)}`} title={event.bookingLabel ?? ''}>{event.bookingLabel ?? emptyValue('unknown')}</RowNameLink> : emptyValue('unknown')}</Td>
                      <Td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                      <ActionCell>{menu.length > 0 ? <RowMenu appearance="box" size="row" label={`${formatListTimestamp(event.receivedAt)}の知らせの操作`} open={openMenu === event.id} onOpenChange={(next) => setOpenMenu(next ? event.id : null)} items={menu} /> : null}</ActionCell>
                    </Tr>
                  )
                })}</tbody>
              </DataTable></Card>
            )}
      {preparing.dialog}
      <p className={styles.footNote}><Info size={14} aria-hidden="true" />失敗の行は「…」から［もう一度読む］。払ったのに予約が見つからない行は［予約に結び付ける］か［返金する］で手当てします。同じ知らせが二度届いても、二重には数えません。</p>
    </div>
  )
}
