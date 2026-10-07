'use client'

/*
 * ★V8 成果とアフィリエイト「支払い」（板 `aINnz`、期間を締めるの確かめは `usDpO`）。
 *
 * app/affiliates/v8-payment-tab.tsx から動きを写し、見た目を一覧の型（ListPage）で組み直した。
 * 決まりは今と同じ：
 * - 締めは日本時間の暦月で固定する
 * - 締め済みの台帳があれば settlementCurrent で再開する
 * - アカウント切替の遅い応答は世代番号で捨てる
 * - 明細発行・銀行用CSVは合言葉（冪等キー）つき、CSV 書き出しは本人確認を通してから
 * - 0円で外れた成果・持ち越し・取消の差し引きは案内に出す
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CalendarDays, FileText, Landmark, Lock, ReceiptText, TriangleAlert, Users, Wallet } from 'lucide-react'
import {
  api,
  type AffiliateAccountSettlementPreview,
  type AffiliateAccountSettlementResult,
  type AffiliatePaymentSummary,
  type AffiliatePayoutBatch,
  type AffiliateSettlementResume,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { ListPagePagination } from '@/components/templates'
import { currentSettlementPeriod, formatDate, formatMonthDay, formatYen, pageCountOf, pageOf, periodText } from './display'
import { AffiliatePaymentConfirmDialog } from './dialogs'
import { AffiliateFrame, useAffiliateShell } from './frame'
import { PayoutStepUpDialog, SettlementCloseDialog } from './payment-dialogs'
import { AffiliateToolbar, PerPageSelect, RetryButton, SavedSelect, StateCard, StatusPill, ToolbarNotices } from './parts'
import styles from './affiliates.module.css'

type PaymentFilter = 'all' | 'bank_missing' | 'bank_ok'

/** 締め日（periodTo の暦日・日本時間）までの残り日数。取れなければ null。 */
function daysUntilClose(periodTo: string | null | undefined): number | null {
  if (!periodTo) return null
  const end = new Date(periodTo)
  if (Number.isNaN(end.getTime())) return null
  const nowJst = new Date(Date.now() + 9 * 3600_000)
  const today = Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate())
  const endJst = new Date(end.getTime() + 9 * 3600_000)
  const closing = Date.UTC(endJst.getUTCFullYear(), endJst.getUTCMonth(), endJst.getUTCDate())
  return Math.round((closing - today) / 86_400_000)
}

const SAVED_VIEWS = [
  { value: '', label: 'よく使う絞り込み' },
  { value: 'all', label: '今回払う人' },
  { value: 'bank_missing', label: '振込先が足りない' },
  { value: 'bank_ok', label: '振込先の登録済み' },
]

export default function PaymentTab() {
  const { readonly, narrow, accountId } = useAffiliateShell()
  const period = useMemo(() => currentSettlementPeriod(), [])
  const [items, setItems] = useState<AffiliatePaymentSummary[]>([])
  const [preview, setPreview] = useState<AffiliateAccountSettlementPreview | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PaymentFilter>('all')
  const [saved, setSaved] = useState('')
  /* 「今回払う人」の札を押したか（絞りは全員のまま。押した形だけ残す）。 */
  const [allPicked, setAllPicked] = useState(false)
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [closed, setClosed] = useState<AffiliateAccountSettlementResult | null>(null)
  const [resumed, setResumed] = useState<AffiliateSettlementResume | null>(null)
  const [batch, setBatch] = useState<AffiliatePayoutBatch | null>(null)
  const [operationError, setOperationError] = useState('')
  const [operationBusy, setOperationBusy] = useState(false)
  const [payoutKey, setPayoutKey] = useState('')
  const statementKeys = useRef(new Map<string, string>())
  /* アカウント切替で遅れて戻った前アカウントの応答を捨てる。 */
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    if (!accountId) {
      setLoadState('error')
      return
    }
    setLoadState('loading')
    setPreview(null)
    setClosed(null)
    setResumed(null)
    setBatch(null)
    setPayoutKey('')
    setOperationError('')
    try {
      const [settlement, summaries, current] = await Promise.all([
        api.affiliates.settlementPreview(accountId, period),
        api.affiliates.paymentSummaries(accountId).catch(() => null),
        api.affiliates.settlementCurrent(accountId, period).catch(() => null),
      ])
      if (seq !== loadSeq.current) return
      if (!settlement.success || !Array.isArray(settlement.data.affiliates)) throw new Error('payment data malformed')
      setItems(summaries?.success && Array.isArray(summaries.data) ? summaries.data : [])
      setPreview(settlement.data)
      const found = current?.success && current.data && typeof current.data === 'object' && 'settlementId' in current.data ? current.data : null
      setResumed(found)
      if (found) {
        setClosed({
          kind: 'created',
          settlementId: found.settlementId,
          totalAmount: found.totalAmount,
          conversionCount: found.conversionCount,
          version: found.version,
          closedAt: found.closedAt ?? '',
        })
      }
      setLoadState('ready')
    } catch {
      if (seq !== loadSeq.current) return
      setItems([])
      setPreview(null)
      setLoadState('error')
    }
  }, [accountId, period])

  useEffect(() => { void load() }, [load])

  const summaries = useMemo(() => new Map(items.map((item) => [item.affiliateId, item])), [items])
  const rows = useMemo(() => preview?.affiliates ?? [], [preview])
  const missingBanks = rows.filter((item) => !item.bankProfileRegistered)
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja-JP')
    return rows.filter((item) => {
      if (needle && !`${item.affiliateName} ${item.code}`.toLocaleLowerCase('ja-JP').includes(needle)) return false
      if (filter === 'bank_missing') return !item.bankProfileRegistered
      if (filter === 'bank_ok') return item.bankProfileRegistered
      return true
    })
  }, [filter, query, rows])

  /* 締め済み台帳から再開したときは、明細の対象を台帳の内訳から取る。 */
  const statementTargets = useMemo<Array<{ affiliateId: string; affiliateName: string }>>(() => {
    if (resumed) {
      return resumed.affiliates.filter((item) => !item.statementIssued).map((item) => ({ affiliateId: item.affiliateId, affiliateName: item.affiliateName }))
    }
    return rows.map((item) => ({ affiliateId: item.affiliateId, affiliateName: item.affiliateName }))
  }, [rows, resumed])

  const issueStatements = async () => {
    if (!closed || !accountId || operationBusy || statementTargets.length === 0) return
    setOperationBusy(true)
    setOperationError('')
    try {
      const settled = await Promise.allSettled(statementTargets.map((item) => {
        const key = statementKeys.current.get(item.affiliateId) ?? crypto.randomUUID()
        statementKeys.current.set(item.affiliateId, key)
        return api.affiliates.createStatement({ lineAccountId: accountId, settlementId: closed.settlementId, affiliateId: item.affiliateId, expectedVersion: closed.version }, key)
      }))
      const failedNames: string[] = []
      let succeeded = 0
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) succeeded += 1
        else failedNames.push(statementTargets[index].affiliateName)
      })
      if (failedNames.length === 0) {
        notifyToast(`${formatNumber(statementTargets.length)}人分の支払明細を発行し、LINE通知を依頼しました。`)
      } else {
        if (succeeded > 0) notifyToast(`${formatNumber(succeeded)}人分の支払明細を発行しました。`)
        const names = failedNames.slice(0, 5).join('、')
        const rest = failedNames.length > 5 ? `ほか${failedNames.length - 5}人` : ''
        setOperationError(`${failedNames.length}人分を発行できませんでした（${names}${rest}）。もう一度押すと失敗分を試し直せます。`)
      }
      if (resumed && succeeded > 0) void load()
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '支払明細を発行できませんでした')
    } finally {
      setOperationBusy(false)
    }
  }

  const preparePayout = async () => {
    if (!closed || !accountId || operationBusy) return
    const key = payoutKey || crypto.randomUUID()
    setPayoutKey(key)
    setOperationBusy(true)
    setOperationError('')
    try {
      const response = await api.affiliates.createPayoutBatch({ lineAccountId: accountId, settlementId: closed.settlementId, expectedVersion: closed.version, bankFormat: 'zengin_csv' }, key)
      if (!response.success) throw new Error(response.error)
      setBatch(response.data)
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '振込先を確認できませんでした')
    } finally {
      setOperationBusy(false)
    }
  }

  const download = (downloadUrl: string) => {
    const anchor = document.createElement('a')
    anchor.href = `${process.env.NEXT_PUBLIC_API_URL ?? ''}${downloadUrl}`
    anchor.download = ''
    anchor.click()
    notifyToast('銀行用CSVを書き出しました。ファイルは15分で期限切れになります。')
  }

  const ready = loadState === 'ready'
  const pageCount = pageCountOf(shown.length, pageSize)
  const currentPage = Math.min(page, pageCount)
  const paged = pageOf(shown, currentPage, pageSize)
  const closeInDays = daysUntilClose(preview?.periodTo)
  const issuedCount = resumed?.affiliates.filter((item) => item.statementIssued).length ?? 0
  const unsettledYen = items.reduce((sum, item) => sum + (item.unsettledReward ?? 0), 0)

  const loadingWord = '読み込んでいます'
  const errorWord = '読み込めませんでした'
  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="今回 払う額"
        icon={<Wallet size={14} aria-hidden="true" />}
        value={null}
        valueText={ready && preview ? formatYen(preview.totalAmount) : '—'}
        unit=""
        detail={ready && preview ? `${formatNumber(rows.length)}人・${formatNumber(preview.conversionCount)}件` : loadState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="次の締め"
        icon={<CalendarDays size={14} aria-hidden="true" />}
        value={null}
        valueText={ready && preview ? formatMonthDay(preview.periodTo) : '—'}
        unit=""
        detail={ready ? (closeInDays == null ? '締めると金額が固定されます' : closeInDays < 0 ? '締め日を過ぎています' : `あと ${formatNumber(closeInDays)}日`) : loadState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="次の支払日"
        icon={<CalendarClock size={14} aria-hidden="true" />}
        value={null}
        valueText="—"
        unit=""
        detail="支払日はアフィリエイターごとの取り決めです"
      />
      <KpiCard
        presentation="band"
        title="今年 払った合計"
        icon={<ReceiptText size={14} aria-hidden="true" />}
        value={null}
        valueText="—"
        unit=""
        detail={ready && items.length > 0 ? `まだ払っていない ${formatYen(unsettledYen)}` : '振込の記録がつながると出ます'}
      />
    </KpiBand>
  )

  const closeBox = preview ? (
    <div className={styles.closeBox}>
        <div className={styles.closeCell}>
          <span className={styles.closeTitle}>今回の締め</span>
          <span className={closed ? styles.closeDone : styles.closeYet}>{closed ? '締めました' : 'まだ締めていません'}</span>
        </div>
        <div className={styles.closeCell}>
          <span className={styles.closeLabel}>期間</span>
          <span className={styles.closeValue}>{periodText(preview)}</span>
        </div>
        <div className={styles.closeCell}>
          <span className={styles.closeLabel}>対象</span>
          <span className={styles.closeValue}>{`${formatNumber(rows.length)}人・${formatNumber(preview.conversionCount)}件`}</span>
        </div>
        <div className={styles.closeCell}>
          <span className={styles.closeLabel}>合計</span>
          <span className={styles.closeValue}>{formatYen(preview.totalAmount)}</span>
        </div>
        <p className={styles.closeNote}>締めると金額が固定されます。締めたあとの取消は、次の支払いで差し引きます。</p>
        {readonly ? null : (
          <Button
            type="button"
            variant="primary"
            onClick={() => setCloseOpen(true)}
            disabled={!preview.conversionCount || Boolean(closed)}
            title={closed ? 'この期間は締めました' : !preview.conversionCount ? '締められる成果がありません' : undefined}
          >
            <Lock size={15} aria-hidden="true" /> 期間を締める…
          </Button>
        )}
    </div>
  ) : null

  const notices = (
    <>
      <ToolbarNotices error={operationError || undefined}>
        {preview?.carriedOver && preview.carriedOver.count > 0 ? (
          <div className={styles.fullRow}><Notice tone="info">{`前の締めから持ち越した分 ${formatNumber(preview.carriedOver.count)}件・${formatYen(preview.carriedOver.amount)} を含んでいます。締める期間は ${formatDate(preview.periodFrom)}〜${formatDate(preview.periodTo)} です。`}</Notice></div>
        ) : null}
        {(preview?.totalDeduction ?? 0) > 0 || (preview?.carriedDeduction?.amount ?? 0) > 0 ? (
          <div className={styles.fullRow}><Notice tone="info">{`締めたあとに取り消された分 ${formatYen(preview?.totalDeduction ?? 0)} を差し引いています。${(preview?.carriedDeduction?.amount ?? 0) > 0 ? `今回引ききれない ${formatYen(preview?.carriedDeduction?.amount ?? 0)} は次回へ繰り越し、正の振込はその分だけ減ります。` : ''}`}</Notice></div>
        ) : null}
        {preview?.excludedZeroAmount && preview.excludedZeroAmount.count > 0 ? (
          <div className={styles.fullRow}><Notice tone="warn">{`報酬が0円の成果 ${formatNumber(preview.excludedZeroAmount.count)}件は、支払えないため今回の締め対象から外れています。対象は「期間を締める」の確かめで見られます。`}</Notice></div>
        ) : null}
        {closed ? (
          <div className={styles.fullRow}>
            <Notice tone="success">
              {resumed
                ? `${formatDate(closed.closedAt)} に締めた記録を読み出しました。${issuedCount > 0 ? `明細は ${formatNumber(resumed.affiliates.length)}人中 ${formatNumber(issuedCount)}人分が発行済みです。` : ''}${resumed.batch ? '振込用CSVの準備も作成済みです。' : '明細と銀行用CSVの準備を続けられます。'}`
                : `${formatDate(closed.closedAt)} に ${formatYen(closed.totalAmount)}・${formatNumber(closed.conversionCount)}件を締めました。明細と銀行用CSVを準備できます。`}
            </Notice>
          </div>
        ) : null}
      </ToolbarNotices>
      <div className={styles.fullRow}>
        <div className={styles.noticeStack}>
          {ready && missingBanks.length > 0 ? (
            <Notice tone="warn">
              {`振込先が登録されていない人が ${formatNumber(missingBanks.length)} 人います（${missingBanks.slice(0, 3).map((item) => item.affiliateName).join('・')}${missingBanks.length > 3 ? ` ほか${formatNumber(missingBanks.length - 3)}人` : ''}）。締める前に、本人に登録をお願いしてください。`}
            </Notice>
          ) : null}
          {closeBox}
        </div>
      </div>
    </>
  )

  const chips = (
    <div role="group" aria-label="振込先で絞り込む" className={styles.chipGroup}>
      <FilterChip selected={filter === 'bank_missing'} icon={<TriangleAlert size={13} aria-hidden="true" />} onChange={(on) => { setSaved(''); setAllPicked(false); setFilter(on ? 'bank_missing' : 'all'); setPage(1) }}>
        {ready ? `振込先が足りない ${formatNumber(missingBanks.length)}` : '振込先が足りない'}
      </FilterChip>
      <FilterChip selected={filter === 'all' && allPicked} icon={<Users size={13} aria-hidden="true" />} onChange={(on) => { setSaved(''); setFilter('all'); setAllPicked(on); setPage(1) }}>
        {ready ? `今回払う人 ${formatNumber(rows.length)}` : '今回払う人'}
      </FilterChip>
    </div>
  )

  const trailing = (
    <>
      <SavedSelect value={saved} options={SAVED_VIEWS} onChange={(value) => { setSaved(value); if (value) { setFilter(value as PaymentFilter); setPage(1) } }} />
      <PerPageSelect value={pageSize} onChange={(value) => { setPageSize(value); setPage(1) }} />
    </>
  )

  const toolbar = (
    <AffiliateToolbar
      narrow={narrow}
      notices={notices}
      search={{ placeholder: '名前・振込先で探す', value: query, onChange: (value) => { setQuery(value); setPage(1) } }}
      chips={chips}
      trailing={trailing}
    />
  )

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={`${styles.table} ${styles.tablePayment}`}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colName}>払う相手</Th>
            <Th className={`${styles.colPayAmount} ${styles.num}`}>今回 払う額</Th>
            <Th className={`${styles.colPayCount} ${styles.num}`}>中身</Th>
            <Th className={styles.colPayBank}>振込先</Th>
            <Th className={styles.colPayState}>状態</Th>
            <Th className={styles.colPayOps}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {paged.map((item) => {
            const summary = summaries.get(item.affiliateId)
            const gross = item.grossAmount ?? item.amount + (item.deduction ?? 0)
            return (
              <Tr key={item.affiliateId} className={styles.row} data-table-layout="columns">
                <Td className={styles.colName}>
                  <span className={styles.stack}>
                    <button type="button" className={styles.rowName} title={item.affiliateName} onClick={() => setConfirmTarget({ id: item.affiliateId, name: item.affiliateName })}>{item.affiliateName}</button>
                    <span className={styles.rowPlan}>{`コード ${item.code}`}</span>
                  </span>
                </Td>
                <Td className={`${styles.colPayAmount} ${styles.num}`}>
                  <span className={styles.stackEnd}>
                    <span className={styles.cellNum}>{formatYen(item.amount)}</span>
                    <span className={styles.rowWrapEnd}>{`元の報酬 ${formatYen(gross)} − 取消 ${formatYen(item.deduction ?? 0)}`}</span>
                  </span>
                </Td>
                <Td className={`${styles.colPayCount} ${styles.num}`}><span className={styles.cellNum}>{`${formatNumber(item.conversionCount)}件`}</span></Td>
                <Td className={styles.colPayBank}>
                  {item.bankProfileRegistered ? (
                    <span className={styles.stack}>
                      <span className={styles.cellNum}>登録済み</span>
                      <span className={styles.rowPlan}>口座番号は本人だけに表示</span>
                    </span>
                  ) : <StatusPill tone="danger">未登録</StatusPill>}
                </Td>
                <Td className={styles.colPayState}>
                  <span className={styles.stack}>
                    <StatusPill tone={item.bankProfileRegistered ? 'active' : 'warn'}>{item.bankProfileRegistered ? '確定できる' : '振込先待ち'}</StatusPill>
                    {item.bankProfileRegistered && summary?.holdDays ? <span className={styles.rowPlan}>{`認めてから ${formatNumber(summary.holdDays)}日保留`}</span> : null}
                  </span>
                </Td>
                <Td className={styles.colPayOps}>
                  <span className={styles.rowActions}>
                    <Button type="button" onClick={() => setConfirmTarget({ id: item.affiliateId, name: item.affiliateName })}>明細を見る</Button>
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )

  const body = loadState === 'loading' ? (
    <ListState kind="loading" title="支払いを読み込んでいます" />
  ) : loadState === 'error' ? (
    <StateCard tone="error" title="支払いの集計を読み込めませんでした" description="数の帯は「—」にしています。道具はそのまま使えます。" action={<RetryButton onRetry={() => { void load() }} />} />
  ) : rows.length === 0 ? (
    <StateCard icon={<Wallet size={16} aria-hidden="true" />} title="今回締められる報酬はありません" description="保留期間を過ぎた承認済みの成果があると出ます" />
  ) : shown.length === 0 ? (
    <StateCard title="条件に合うものはありません" description="検索や絞り込みを外すと、すべて出ます" action={<Button type="button" onClick={() => { setQuery(''); setFilter('all'); setSaved('') }}>条件を外す</Button>} />
  ) : (
    <>
      {table}
      <p className={styles.footNote}>口座番号は本人だけに表示します。銀行用 CSV（口座情報を含む）は、6桁コードかパスワードで本人確認したときだけ書き出せます（15分で期限切れ）。</p>
    </>
  )

  const pager = ready && shown.length > 0 && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>{`${formatNumber(shown.length)}人中 ${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, shown.length)}人`}</span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </ListPagePagination>
  ) : undefined

  const actions = readonly ? undefined : (
    <span className={styles.headActions}>
      <Button
        type="button"
        onClick={() => { void preparePayout() }}
        disabled={!closed || operationBusy || Boolean(resumed?.batch)}
        title={!closed ? '期間を締めると書き出せます' : resumed?.batch ? '銀行用CSVの準備は作成済みです' : undefined}
      >
        <Landmark size={15} aria-hidden="true" /> 銀行用 CSV…
      </Button>
      <Button
        type="button"
        onClick={() => { void issueStatements() }}
        disabled={!closed || operationBusy || statementTargets.length === 0}
        title={!closed ? '期間を締めると出せます' : undefined}
      >
        <FileText size={15} aria-hidden="true" /> {resumed && issuedCount > 0 ? `支払明細をまとめて出す（残り${formatNumber(statementTargets.length)}人）` : '支払明細をまとめて出す'}
      </Button>
    </span>
  )

  return (
    <AffiliateFrame
      actions={actions}
      stats={stats}
      toolbar={toolbar}
      pagination={pager}
      overlays={accountId ? <>
        <SettlementCloseDialog
          preview={closeOpen ? preview : null}
          accountId={accountId}
          onClose={() => setCloseOpen(false)}
          onClosed={(result) => {
            setClosed(result)
            setPayoutKey(crypto.randomUUID())
            statementKeys.current.clear()
            notifyToast('締めの記録を追記しました。')
          }}
        />
        <PayoutStepUpDialog batch={batch} accountId={accountId} onClose={() => setBatch(null)} onExported={download} />
        <AffiliatePaymentConfirmDialog
          target={confirmTarget}
          accountId={accountId}
          settlement={preview?.affiliates.find((item) => item.affiliateId === confirmTarget?.id) ?? null}
          periodTo={preview?.periodTo ?? null}
          onClose={() => setConfirmTarget(null)}
          onConfirmed={() => { void load() }}
        />
      </> : null}
    >
      {body}
    </AffiliateFrame>
  )
}
