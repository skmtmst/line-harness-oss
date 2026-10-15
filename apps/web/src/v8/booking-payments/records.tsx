'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Download, FileText, Info, RotateCcw, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import TruncatedText from '@/components/shared/truncated-text'
import { RowMenu } from '@/components/shared/row-actions'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import { ActionCell, DataTable, RowNameLink, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import NumberInput from '@/components/shared/number-field'
import { notifySaved, notifyToast } from '@/components/shared/toast'
import { emptyValue } from '@/components/shared/empty-value'
import { formatListTimestamp, formatYen } from '@/lib/format'
import { ApiError } from '@/lib/api'
import { bookingPaymentAdminApi, isNotReadyError, type PaymentRecord, type PaymentRecordsPage } from '@/lib/api-booking-payment-admin'
import { NOT_READY, RECORD_STATUS } from './labels'
import styles from './payments.module.css'

/* お支払いの記録（FY8HC）。返金は 2 段の確かめ（確かめの窓 → 金額を入れる）。 */

const TABLE_LAYOUT = { headHeight: 'var(--polish-table-head)', rowHeight: 'var(--polish-table-row)', gap: 'var(--polish-space-card)', padding: '0 var(--polish-space-section)', bodyTextSize: 'var(--polish-text-body)', collapseScope: 'page' as const }
const STATUS_FILTER = [
  { value: '', label: '状態：すべて' },
  { value: 'paid', label: '状態：支払い済み' },
  { value: 'pending', label: '状態：支払い待ち' },
  { value: 'refunded', label: '状態：返金済み' },
  { value: 'expired', label: '状態：期限切れ' },
  { value: 'onsite', label: '状態：お店で払う' },
]
const METHOD_FILTER = [
  { value: '', label: '方法：すべて' },
  { value: 'online', label: '方法：オンライン' },
  { value: 'onsite', label: '方法：店頭' },
]
const PERIOD_FILTER = [
  { value: 'month', label: '期間：今月' },
  { value: '7d', label: '期間：過去7日' },
  { value: '30d', label: '期間：過去30日' },
  { value: '90d', label: '期間：過去90日' },
]

type Load = { state: 'loading' } | { state: 'ready'; page: PaymentRecordsPage } | { state: 'not-ready' } | { state: 'error' }

export default function PaymentRecords({ accountId, canEdit }: { accountId: string; canEdit: boolean }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [method, setMethod] = useState('')
  const [period, setPeriod] = useState('month')
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [refundTarget, setRefundTarget] = useState<PaymentRecord | null>(null)
  const [refundStep, setRefundStep] = useState<1 | 2>(1)
  const [refundAmount, setRefundAmount] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++generation.current
    setLoad({ state: 'loading' })
    try {
      const response = await bookingPaymentAdminApi.records(accountId, { q: query.trim(), status, method, period, limit: 20 })
      if (mine === generation.current) setLoad({ state: 'ready', page: response.data })
    } catch (cause) {
      if (mine === generation.current) setLoad({ state: isNotReadyError(cause) ? 'not-ready' : 'error' })
    }
  }, [accountId, query, status, method, period])

  useEffect(() => { void reload() }, [reload])

  const summary = load.state === 'ready' ? load.page.summary : null
  const items = load.state === 'ready' ? load.page.items : []

  function menuFor(record: PaymentRecord): ActionMenuItem[] {
    return [
      ...(record.bookingId ? [{ id: 'open', label: '予約を開く', icon: <CalendarDays size={15} aria-hidden="true" />, href: `/booking/bookings?booking=${encodeURIComponent(record.bookingId)}` }] : []),
      ...(canEdit && (record.status === 'pending' || record.status === 'expired') ? [{ id: 'link', label: '支払いのリンクを送る', icon: <Send size={15} aria-hidden="true" />, onSelect: () => notifyToast(`${NOT_READY}支払いのリンクを LINE で送る操作は、もうすぐ使えます。`) }] : []),
      ...(record.receiptUrl ? [{ id: 'receipt', label: '領収書を見る', icon: <FileText size={15} aria-hidden="true" />, href: record.receiptUrl, external: true }] : []),
      ...(canEdit && record.status === 'paid' ? [{ id: 'refund', label: '返金する', tone: 'danger' as const, icon: <RotateCcw size={15} aria-hidden="true" />, onSelect: () => { setRefundTarget(record); setRefundStep(1); setRefundAmount(''); setRefundError(null) } }] : []),
    ]
  }

  async function refund() {
    if (!refundTarget) return
    setRefunding(true)
    setRefundError(null)
    try {
      await bookingPaymentAdminApi.refund(refundTarget.id)
      setRefundTarget(null)
      notifySaved(`${refundTarget.friendName ?? 'お客さま'}さんに ${formatYen(refundTarget.amount)} を返金しました`)
      void reload()
    } catch (cause) {
      setRefundError(cause instanceof ApiError && cause.status === 409 ? 'この支払いは返金できません（支払い済みのものだけ返金できます）。'
        : cause instanceof ApiError && cause.status === 403 ? '返金する権限がありません。'
          : '返金できませんでした。Stripe の管理画面で状態を確かめてください。')
    } finally {
      setRefunding(false)
    }
  }

  const amountMatches = useMemo(() => refundTarget !== null && Number(refundAmount) === refundTarget.amount, [refundAmount, refundTarget])

  return (
    <div className={styles.records} data-design="PaymentRecords">
      <div className={styles.recordsHead}>
        <h2 className={styles.recordsTitle}>お支払いの記録<HelpTip label="お支払いの記録の数え方">入金は今月に支払いが済んだ合計、返金は今月に返金した合計です。未払いで流れた枠は、お支払いを待つ時間を過ぎて取り消した仮の予約です。</HelpTip></h2>
        {load.state === 'ready' ? <Button onClick={() => notifyToast(`${NOT_READY}CSVで書き出す操作は、もうすぐ使えます。`)}><Download size={15} aria-hidden="true" />CSVで書き出す</Button> : null}
      </div>

      {load.state === 'not-ready' ? (
        <Notice tone="info" icon={<Info size={16} aria-hidden="true" />}>{NOT_READY}お支払いの記録は、データの準備が済むと見られます。返金は予約の画面からできます。</Notice>
      ) : (
        <>
          <KpiBand>
            <KpiCard icon={null} title="今月の入金" value={summary?.paidAmount} unit="円" detail={summary ? `${summary.paidCount} 件` : undefined} loading={load.state === 'loading'} />
            <KpiCard icon={null} title="返金" value={summary?.refundedAmount} unit="円" detail={summary ? `${summary.refundedCount} 件` : undefined} loading={load.state === 'loading'} />
            <KpiCard icon={null} title="未払いで流れた枠" value={summary?.expiredCount} unit="件" detail={summary ? `${summary.holdMinutes} 分を過ぎた` : undefined} loading={load.state === 'loading'} />
            <KpiCard icon={null} title="支払い待ち" value={summary?.pendingCount} unit="件" detail="いま取り置き中" loading={load.state === 'loading'} />
          </KpiBand>
          <div data-template-region="toolbar"><ListToolbar
            search={{ placeholder: '名前・タグ・メモで探す', value: query, onChange: setQuery, width: 260 }}
            filters={<>
              <Select aria-label="状態" value={status} onChange={setStatus} options={STATUS_FILTER} />
              <Select aria-label="方法" value={method} onChange={setMethod} options={METHOD_FILTER} />
              <Select aria-label="期間" value={period} onChange={setPeriod} options={PERIOD_FILTER} />
            </>}
            trailing={<span className={styles.count}>{load.state === 'ready' ? `${load.page.total}件表示` : ''}</span>}
          /></div>
          {load.state === 'loading' ? <ListState kind="loading" title="お支払いの記録を読み込んでいます" />
            : load.state === 'error' ? <ListState kind="error" title="お支払いの記録を表示できませんでした" onRetry={() => void reload()} />
              : items.length === 0 ? <ListState kind="empty" title="この条件のお支払いはありません" description="期間や状態を変えてください。" />
                : (
                  <Card overflow="hidden"><DataTable aria-label="お支払いの記録" columnSizing="content" columnLayout={TABLE_LAYOUT}>
                    <thead><TableHeadRow data-table-layout="columns"><Th truncate>日時</Th><Th grow truncate>お客さま</Th><Th grow truncate>予約</Th><Th align="right" truncate>金額</Th><Th truncate>状態</Th><Th truncate>方法</Th><Th showActionLabel>操作</Th></TableHeadRow></thead>
                    <tbody>{items.map((record) => {
                      const badge = RECORD_STATUS[record.status]
                      const menu = menuFor(record)
                      return (
                        <Tr key={record.id} data-table-layout="columns">
                          <Td><TruncatedText value={formatListTimestamp(record.createdAt)} /></Td>
                          <Td grow>{record.friendId ? <RowNameLink href={`/friends/detail?id=${encodeURIComponent(record.friendId)}`} title={record.friendName ?? ''}>{record.friendName ?? emptyValue('unknown')}</RowNameLink> : <TruncatedText value={record.friendName ?? emptyValue('unknown')} />}</Td>
                          <Td grow><span className={styles.cellStack}><TruncatedText value={record.bookingLabel ?? emptyValue('unknown')} />{record.bookingNote ? <span className={styles.cellSub}>{record.bookingNote}</span> : null}</span></Td>
                          <Td align="right"><TruncatedText value={formatYen(record.amount)} /></Td>
                          <Td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></Td>
                          <Td><TruncatedText value={record.method ?? emptyValue('unknown')} /></Td>
                          <ActionCell>{menu.length > 0 ? <RowMenu appearance="box" size="row" label={`${record.friendName ?? 'お支払い'}の操作`} open={openMenu === record.id} onOpenChange={(next) => setOpenMenu(next ? record.id : null)} items={menu} /> : null}</ActionCell>
                        </Tr>
                      )
                    })}</tbody>
                  </DataTable></Card>
                )}
          <p className={styles.footNote}><Info size={14} aria-hidden="true" />返金は確かめの窓のあとに 2 回目の確かめ（金額を入れる）で行います。数え方は「？」の中。</p>
        </>
      )}

      <ConfirmDialog
        open={refundTarget !== null && refundStep === 1}
        title={`${refundTarget?.friendName ?? 'お客さま'}さんに返金しますか？`}
        description={`${refundTarget?.bookingLabel ?? ''}の ${formatYen(refundTarget?.amount)} を、払ったカードへ返します。返金は取り消せません。`}
        confirmLabel="次へ"
        destructive
        onCancel={() => setRefundTarget(null)}
        onConfirm={() => setRefundStep(2)}
      />
      <ConfirmDialog
        open={refundTarget !== null && refundStep === 2}
        title="返金する金額を入れてください"
        description={`まちがいを防ぐため、${formatYen(refundTarget?.amount)} と同じ金額を入れると返金できます。`}
        confirmLabel="返金する"
        destructive
        busy={refunding}
        confirmDisabled={!amountMatches}
        error={refundError ?? undefined}
        onCancel={() => { if (!refunding) setRefundTarget(null) }}
        onConfirm={() => void refund()}
      >
        <NumberInput aria-label="返金する金額" unit="円" type="number" min={0} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} />
      </ConfirmDialog>
    </div>
  )
}
