'use client'

/*
 * ★V8-B 成果とアフィリエイト「支払い」タブ（板 `aINnz`）。
 *
 * 動作の契約は v7（payment-tab.tsx の AffiliatePaymentTab）と同じ：
 * - 締めは業務上の時差（Asia/Tokyo）の暦月で固定（R45）
 * - 締め済み台帳があれば settlementCurrent で再開する（R43）
 * - アカウント切替の遅い応答は世代番号で捨てる（R46）
 * - 明細発行・銀行用CSVは合言葉（冪等キー）つき、CSV書き出しは本人確認
 *   （2段階認証またはパスワード）を通してから（V-1）
 * - 0円で締め対象から外れた成果・持ち越し・取消差し引きは案内に出す
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Banknote, CalendarClock, Landmark, Wallet } from 'lucide-react'
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
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import Pagination from '@/components/shared/pagination'
import { notifyToast } from '@/components/shared/toast'
import { AffiliatePaymentConfirmDialog } from './action-dialogs'
import {
  PayoutStepUpDialog,
  SettlementCloseDialog,
  currentAffiliateSettlementPeriod,
} from './payment-tab'
import { KpiStrip, KpiCell, NoticeBar, EmptyState, ZeroResultState, LoadingRows, LoadError } from './v8-shared'
import styles from './list-v8.module.css'

type PaymentFilter = 'all' | 'bank_missing' | 'bank_ok'

function yen(value: number): string {
  return `¥${formatNumber(Math.round(value))}`
}

function dateLabel(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function monthDay(value: string | null): { month: number | null; dayUnit: string } {
  if (!value) return { month: null, dayUnit: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { month: null, dayUnit: '' }
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return { month: jst.getUTCMonth() + 1, dayUnit: `/${jst.getUTCDate()}` }
}

/** `accountId` は必須。どのLINEアカウントの支払いかで、ほかの店の額を混ぜない。 */
export default function PaymentTabV8({
  accountId,
  canEdit,
  registerHeaderActions,
}: {
  accountId: string
  canEdit: boolean
  registerHeaderActions: (node: ReactNode) => void
}) {
  const period = useMemo(() => currentAffiliateSettlementPeriod(), [])
  const [items, setItems] = useState<AffiliatePaymentSummary[]>([])
  const [preview, setPreview] = useState<AffiliateAccountSettlementPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PaymentFilter>('all')
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
  const statementKeysRef = useRef(new Map<string, string>())
  // R46: アカウント切替で遅れて戻った前アカウントの応答を捨てる。
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(false)
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
      if (!settlement.success || !Array.isArray(settlement.data.affiliates)) {
        throw new Error('payment data malformed')
      }
      setItems(summaries?.success && Array.isArray(summaries.data) ? summaries.data : [])
      setPreview(settlement.data)
      const found = current?.success ? current.data : null
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
    } catch {
      if (seq !== loadSeq.current) return
      setItems([])
      setPreview(null)
      setError(true)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [accountId, period])

  useEffect(() => { void load() }, [load])

  const summaries = useMemo(() => new Map(items.map((item) => [item.affiliateId, item])), [items])
  const rows = useMemo(() => preview?.affiliates ?? [], [preview])
  const missingBanks = rows.filter((item) => !item.bankProfileRegistered).length
  const shown = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP')
    return rows.filter((item) => {
      if (normalized && !`${item.affiliateName} ${item.code}`.toLocaleLowerCase('ja-JP').includes(normalized)) return false
      if (filter === 'bank_missing') return !item.bankProfileRegistered
      if (filter === 'bank_ok') return item.bankProfileRegistered
      return true
    })
  }, [filter, query, rows])

  // R43: 締め済み台帳から再開したときはプレビューが空になるため、
  // 明細の対象は台帳の内訳（再開情報）から取る。
  const statementTargets = useMemo<Array<{ affiliateId: string; affiliateName: string }>>(() => {
    if (resumed) {
      return resumed.affiliates
        .filter((item) => !item.statementIssued)
        .map((item) => ({ affiliateId: item.affiliateId, affiliateName: item.affiliateName }))
    }
    return (preview?.affiliates ?? []).map((item) => ({
      affiliateId: item.affiliateId, affiliateName: item.affiliateName,
    }))
  }, [preview, resumed])

  const issueStatements = async () => {
    if (!closed || operationBusy || statementTargets.length === 0) return
    setOperationBusy(true)
    setOperationError('')
    try {
      const settled = await Promise.allSettled(statementTargets.map((item) => {
        const key = statementKeysRef.current.get(item.affiliateId) ?? crypto.randomUUID()
        statementKeysRef.current.set(item.affiliateId, key)
        return api.affiliates.createStatement({
          lineAccountId: accountId,
          settlementId: closed.settlementId,
          affiliateId: item.affiliateId,
          expectedVersion: closed.version,
        }, key)
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
        const shown = failedNames.slice(0, 5).join('、')
        const rest = failedNames.length > 5 ? `ほか${failedNames.length - 5}人` : ''
        setOperationError(`${failedNames.length}人分を発行できませんでした（${shown}${rest}）。もう一度押すと失敗分を試し直せます。`)
      }
      if (resumed && succeeded > 0) void load()
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '支払明細を発行できませんでした')
    } finally {
      setOperationBusy(false)
    }
  }

  const preparePayout = async () => {
    if (!closed || operationBusy) return
    const key = payoutKey || crypto.randomUUID()
    setPayoutKey(key)
    setOperationBusy(true)
    setOperationError('')
    try {
      const response = await api.affiliates.createPayoutBatch({
        lineAccountId: accountId,
        settlementId: closed.settlementId,
        expectedVersion: closed.version,
        bankFormat: 'zengin_csv',
      }, key)
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

  const summaryUnavailable = error && !loading
  const shownPageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const shownPage = Math.min(page, shownPageCount)
  const paged = shown.slice((shownPage - 1) * pageSize, shownPage * pageSize)
  const closeDate = monthDay(preview?.periodTo ?? null)
  const issuedCount = resumed?.affiliates.filter((item) => item.statementIssued).length ?? 0
  const listState = loading ? 'loading' : error ? 'error' : rows.length === 0 ? 'empty' : shown.length === 0 ? 'zero' : 'ready'

  // 板の頭の右上：「支払明細をまとめて出す」＋「振込用CSVを書き出す」
  useEffect(() => {
    registerHeaderActions(
      <span key="payment-actions" style={{ display: 'inline-flex', gap: 8 }}>
        <Button
          type="button"
          onClick={() => { void issueStatements() }}
          disabled={!canEdit || !closed || operationBusy || statementTargets.length === 0}
          title={!canEdit ? '閲覧のみのため変更できません' : !closed ? '期間を締めると出せます' : undefined}
        >
          {resumed && issuedCount > 0 ? `支払明細をまとめて出す（残り${formatNumber(statementTargets.length)}人）` : '支払明細をまとめて出す'}
        </Button>
        <Button
          type="button"
          onClick={() => { void preparePayout() }}
          disabled={!canEdit || !closed || operationBusy || Boolean(resumed?.batch)}
          title={!canEdit ? '閲覧のみのため変更できません' : resumed?.batch ? '振込用CSVの準備は作成済みです' : missingBanks > 0 ? '振込先が未登録の人がいる場合は、誰に依頼するかを確認できます' : undefined}
        >
          振込用CSVを書き出す
        </Button>
      </span>,
    )
    return () => registerHeaderActions(null)
  })

  return (
    <>
      <KpiStrip>
        <KpiCell
          icon={<Wallet size={14} aria-hidden="true" />}
          label="まだ払っていない"
          value={summaryUnavailable ? null : preview?.totalAmount ?? 0}
          unit="円"
          sub={summaryUnavailable ? '読み込めませんでした' : `${formatNumber(rows.length)}人ぶん・締める前の報酬`}
          info="今回の締めで払う見込みの合計です。締める前なので、成果を却下すると減ります。"
        />
        <KpiCell
          icon={<CalendarClock size={14} aria-hidden="true" />}
          label="次の締め"
          value={summaryUnavailable ? null : closeDate.month}
          unit={closeDate.dayUnit}
          sub={summaryUnavailable ? '読み込めませんでした' : '締めると金額が固定されます'}
          info="この期間に認めた成果を固定して、支払いの台帳を作る日です。"
        />
        <KpiCell
          icon={<Banknote size={14} aria-hidden="true" />}
          label="次の支払日"
          value={null}
          unit=""
          sub="支払日の設定が接続されると表示します"
          info="支払日を管理する口がまだ無いため、いまは出せません。"
        />
        <KpiCell
          icon={<Landmark size={14} aria-hidden="true" />}
          label="今年 払った合計"
          value={null}
          unit=""
          sub="支払履歴が接続されると表示します"
          info="支払い履歴を集める口がまだ無いため、いまは出せません。"
        />
      </KpiStrip>

      <NoticeBar>締める前なら、成果を却下すると今回の支払いから外れます。締めたあとの取消は次の支払いで差し引きます。</NoticeBar>

      {preview?.carriedOver && preview.carriedOver.count > 0 ? (
        <NoticeBar>
          前の締めから持ち越した分 {formatNumber(preview.carriedOver.count)}件・{yen(preview.carriedOver.amount)} を含んでいます。締める期間は {dateLabel(preview.periodFrom)}〜{dateLabel(preview.periodTo)} です。
        </NoticeBar>
      ) : null}

      {(preview?.totalDeduction ?? 0) > 0 || (preview?.carriedDeduction?.amount ?? 0) > 0 ? (
        <NoticeBar>
          締めたあとに取り消された分 {yen(preview?.totalDeduction ?? 0)} を差し引いています。
          {(preview?.carriedDeduction?.amount ?? 0) > 0
            ? `今回引ききれない ${yen(preview?.carriedDeduction?.amount ?? 0)} は次回へ繰り越し、正の振込はその分だけ減ります。`
            : ''}
        </NoticeBar>
      ) : null}

      {preview?.excludedZeroAmount && preview.excludedZeroAmount.count > 0 ? (
        <NoticeBar tone="warn">
          報酬が0円の成果 {formatNumber(preview.excludedZeroAmount.count)}件は、支払えないため今回の締め対象から外れています。対象は「{dateLabel(preview.periodTo)} で締める」の確認画面で見られます。
        </NoticeBar>
      ) : null}

      {closed ? (
        <NoticeBar>
          {resumed
            ? `${dateLabel(closed.closedAt)} に締めた記録を読み出しました。${issuedCount > 0 ? `明細は ${formatNumber(resumed.affiliates.length)}人中 ${formatNumber(issuedCount)}人分が発行済みです。` : ''}${resumed.batch ? ' 振込用CSVの準備も作成済みです。' : ' 明細と銀行用CSVの準備を続けられます。'}`
            : `${dateLabel(closed.closedAt)} に ${yen(closed.totalAmount)}・${formatNumber(closed.conversionCount)}件を締めました。明細と銀行用CSVを準備できます。`}
        </NoticeBar>
      ) : null}
      {operationError ? <NoticeBar tone="warn">{operationError}</NoticeBar> : null}

      {missingBanks > 0 && !loading && !error ? (
        <NoticeBar tone="warn">
          振込先が登録されていない人が{formatNumber(missingBanks)}人います。締める前に、本人に登録をお願いしてください。
        </NoticeBar>
      ) : null}

      {/* 板 `aINnz`：期間のまとめ行（締めの入口はこの行の右端） */}
      {preview ? (
        <div className={styles.closeRow}>
          <div className={styles.closeCell}>
            <span className={styles.closeTitle}>今回の締め</span>
            <span className={`${styles.statusBadge} ${closed ? styles.statusOk : styles.statusWarn}`}>
              <span className={styles.statusDot} aria-hidden="true" />
              {closed ? '締め済み' : 'まだ締めていません'}
            </span>
          </div>
          <div className={styles.closeCell}>
            <span className={styles.closeLabel}>期間</span>
            <span className={styles.closeValue}>{dateLabel(preview.periodFrom)}〜{dateLabel(preview.periodTo)}</span>
          </div>
          <div className={styles.closeCell}>
            <span className={styles.closeLabel}>対象</span>
            <span className={styles.closeValue}>{formatNumber(rows.length)}人・{formatNumber(preview.conversionCount)}件</span>
          </div>
          <div className={styles.closeCell}>
            <span className={styles.closeLabel}>合計</span>
            <span className={styles.closeValue}>{yen(preview.totalAmount)}</span>
          </div>
          <p className={styles.closeNote}>締めると金額が固定されます。締めたあとの取消は、次の支払いで差し引きます。</p>
          <Button
            type="button"
            variant="primary"
            onClick={() => setCloseOpen(true)}
            disabled={!canEdit || loading || error || !preview.conversionCount || Boolean(closed)}
            title={!canEdit ? '閲覧のみのため変更できません' : undefined}
          >
            期間を締める…
          </Button>
        </div>
      ) : null}

      <div className={styles.tools}>
        <SearchField
          placeholder="名前・振込先で探す"
          aria-label="名前・振込先で探す"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          className={styles.toolsSearch}
        />
        <FilterChip
          selected={filter === 'bank_missing'}
          onChange={(on) => setFilter(on ? 'bank_missing' : 'all')}
          count={loading || error ? undefined : formatNumber(missingBanks)}
        >
          振込先が足りない
        </FilterChip>
        <FilterChip
          selected={filter === 'all'}
          onChange={() => setFilter('all')}
          count={loading || error ? undefined : formatNumber(rows.length)}
        >
          今回払う人
        </FilterChip>
        <span className={styles.toolsSpacer} />
        <Select
          aria-label="よく使う絞り込み"
          value=""
          options={[
            { value: '', label: 'よく使う絞り込み' },
            { value: 'all', label: '今回払う人' },
            { value: 'bank_missing', label: '振込先が足りない' },
            { value: 'bank_ok', label: '振込先の登録済み' },
          ]}
          onChange={(value) => { if (value) setFilter(value as PaymentFilter) }}
        />
        <Select
          aria-label="表示件数"
          value={String(pageSize)}
          options={[20, 50, 100].map((n) => ({ value: String(n), label: `${n}件表示` }))}
          onChange={(value) => { setPageSize(Number(value)); setPage(1) }}
          size="page-size"
        />
      </div>

      {listState === 'loading' ? (
        <LoadingRows />
      ) : listState === 'error' ? (
        <LoadError name="支払いの集計" onRetry={() => { void load() }} />
      ) : listState === 'empty' ? (
        <EmptyState
          icon={<Wallet size={20} aria-hidden="true" />}
          title="今回締められる報酬はありません"
          description="保留期間を過ぎた承認済み成果があると、ここに支払対象が表示されます。"
        />
      ) : listState === 'zero' ? (
        <ZeroResultState onReset={() => { setQuery(''); setFilter('all') }} />
      ) : (
        <div className={styles.tableWrap}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>払う相手</th>
                  <th className={styles.numRight}>今回 払う額</th>
                  <th className={styles.numRight}>中身</th>
                  <th>振込先</th>
                  <th>状態</th>
                  <th className={styles.numRight}>操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((item) => {
                  const summary = summaries.get(item.affiliateId)
                  return (
                    <tr key={item.affiliateId}>
                      <td>
                        <span className={styles.cellMain} style={{ fontWeight: 600, color: 'var(--color-accent-deep)' }}>{item.affiliateName}</span>
                        <span className={styles.cellSub}>コード {item.code}</span>
                      </td>
                      <td className={styles.numRight}>
                        <strong>{yen(item.amount)}</strong>
                        {(item.deduction ?? 0) > 0 ? (
                          <span className={styles.cellSub}>
                            元の報酬 {yen(item.grossAmount ?? item.amount + (item.deduction ?? 0))} − 取消の差し引き {yen(item.deduction ?? 0)}
                          </span>
                        ) : null}
                      </td>
                      <td className={styles.numRight}>認めた {formatNumber(item.conversionCount)}件</td>
                      <td>
                        {item.bankProfileRegistered ? (
                          <>
                            <span className={styles.cellMain}>登録済み</span>
                            <span className={styles.cellSub}>口座番号は本人だけに表示</span>
                          </>
                        ) : (
                          <span className={styles.cellMain} style={{ color: 'var(--color-warning)' }}>登録されていません</span>
                        )}
                      </td>
                      <td>
                        <span className={`${styles.statusBadge} ${item.bankProfileRegistered ? styles.statusNeutral : styles.statusWarn}`}>
                          <span className={styles.statusDot} aria-hidden="true" />
                          {item.bankProfileRegistered ? 'まだ締めていません' : '振込先が足りません'}
                        </span>
                        {summary?.holdDays ? (
                          <span className={styles.cellSub}>認めてから{summary.holdDays}日保留</span>
                        ) : null}
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <Button
                            type="button"
                            size="compact"
                            onClick={() => setConfirmTarget({ id: item.affiliateId, name: item.affiliateName })}
                          >
                            明細を見る
                          </Button>
                          {item.bankProfileRegistered ? (
                            <Button
                              type="button"
                              size="compact"
                              aria-label={`${item.affiliateName}の支払いを確定する`}
                              disabled={!canEdit}
                              title={!canEdit ? '閲覧のみのため変更できません' : undefined}
                              onClick={() => setConfirmTarget({ id: item.affiliateId, name: item.affiliateName })}
                            >
                              この人を確定
                            </Button>
                          ) : (
                            <span style={{ alignSelf: 'center', color: 'var(--color-warning)', fontSize: 12 }}>本人に登録を依頼</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {listState === 'ready' && shownPageCount > 1 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 24px 0' }}>
          <p className={styles.footNote} style={{ padding: 0 }}>
            {formatNumber(shown.length)}人
          </p>
          <Pagination page={shownPage} pageCount={shownPageCount} onPageChange={setPage} />
        </div>
      ) : null}

      <p className={styles.footNote}>
        「明細を見る」で今回の締めの内訳と連絡先を確かめられます。期間を締めると、右上から支払明細の発行と銀行用CSVの書き出しに進めます。
      </p>

      <SettlementCloseDialog
        preview={closeOpen ? preview : null}
        accountId={accountId}
        onClose={() => setCloseOpen(false)}
        onClosed={(result) => {
          setClosed(result)
          setPayoutKey(crypto.randomUUID())
          statementKeysRef.current.clear()
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
    </>
  )
}
