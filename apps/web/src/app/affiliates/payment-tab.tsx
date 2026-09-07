'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KpiCard from '@/components/dashboard/kpi-card'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  api,
  type AffiliateAccountSettlementPreview,
  type AffiliateAccountSettlementResult,
  type AffiliatePaymentSummary,
  type AffiliatePayoutBatch,
} from '@/lib/api'
import { AffiliatePaymentConfirmDialog } from './action-dialogs'

type PaymentFilter = 'all' | 'bank_missing' | 'ready'

function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

function dateLabel(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

function monthDay(value: string | null): { month: number | null; dayUnit: string } {
  if (!value) return { month: null, dayUnit: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { month: null, dayUnit: '' }
  return { month: date.getMonth() + 1, dayUnit: `/${date.getDate()}` }
}

/** ブラウザの現地月を、Workerが比較できるISO期間へする。 */
export function currentAffiliateSettlementPeriod(now = new Date()): { periodFrom: string; periodTo: string } {
  return {
    periodFrom: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString(),
    periodTo: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString(),
  }
}

function SettlementCloseDialog({
  preview,
  accountId,
  onClose,
  onClosed,
}: {
  preview: AffiliateAccountSettlementPreview | null
  accountId: string
  onClose: () => void
  onClosed: (result: AffiliateAccountSettlementResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')

  useEffect(() => {
    if (!preview) return
    setError('')
    setIdempotencyKey(crypto.randomUUID())
  }, [preview])

  const closeSettlement = async () => {
    if (!preview || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await api.affiliates.closeSettlement({
        lineAccountId: accountId,
        periodFrom: preview.periodFrom,
        periodTo: preview.periodTo,
        expectedPreviewVersion: preview.previewVersion,
      }, idempotencyKey)
      if (!response.success) throw new Error(response.error)
      onClosed(response.data)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '締め処理を完了できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={Boolean(preview)}
      title={`${dateLabel(preview?.periodTo ?? null)} で締めますか？`}
      description="この期間に認めた成果を固定します。締めたあとの取消は次の支払いで差し引かれます。"
      busy={busy}
      error={error}
      onCancel={onClose}
      footer={(
        <div className="border-hairline flex justify-end gap-2 border-t pt-4">
          <Button type="button" onClick={onClose} disabled={busy}>やめる</Button>
          <Button type="button" variant="primary" onClick={() => { void closeSettlement() }} disabled={busy || !preview?.conversionCount}>
            {busy ? '締めています…' : `${yen(preview?.totalAmount ?? 0)} で締める`}
          </Button>
        </div>
      )}
    >
      {preview ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">締める額</dt><dd className="text-ink mt-1 text-lg font-bold">{yen(preview.totalAmount)}</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">払う相手</dt><dd className="text-ink mt-1 text-lg font-bold">{preview.affiliates.length.toLocaleString('ja-JP')}人</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">成果</dt><dd className="text-ink mt-1 text-lg font-bold">{preview.conversionCount.toLocaleString('ja-JP')}件</dd></div>
          </dl>
          <div className="border-hairline overflow-hidden rounded-control border">
            <table className="w-full text-sm">
              <thead><TableHeadRow><Th>払う相手</Th><Th align="right">成果</Th><Th align="right">金額</Th><Th>振込先</Th></TableHeadRow></thead>
              <tbody className="divide-hairline divide-y">
                {preview.affiliates.map((item) => (
                  <tr key={item.affiliateId}>
                    <td className="text-ink px-3 py-2 font-medium">{item.affiliateName}</td>
                    <td className="text-ink-secondary px-3 py-2 text-right tabular-nums">{item.conversionCount.toLocaleString('ja-JP')}件</td>
                    <td className="text-ink px-3 py-2 text-right font-semibold tabular-nums">{yen(item.amount)}</td>
                    <td className="px-3 py-2">{item.bankProfileRegistered ? '登録済み' : <span className="text-warning">未登録</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-ink-secondary text-xs leading-5">振込そのものは行いません。締めたあとに明細を発行し、本人確認をして銀行用CSVを書き出します。</p>
        </div>
      ) : null}
    </Dialog>
  )
}

function PayoutStepUpDialog({
  batch,
  accountId,
  onClose,
  onExported,
}: {
  batch: AffiliatePayoutBatch | null
  accountId: string
  onClose: () => void
  onExported: (downloadUrl: string) => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exportKey, setExportKey] = useState('')

  useEffect(() => {
    if (!batch) return
    setCode('')
    setError('')
    setExportKey(crypto.randomUUID())
  }, [batch])

  const exportCsv = async () => {
    if (!batch || !/^\d{6}$/.test(code) || busy) return
    setBusy(true)
    setError('')
    try {
      const verified = await api.affiliates.payoutStepUp(code)
      if (!verified.success) throw new Error(verified.error)
      const exported = await api.affiliates.exportPayoutBatch(
        batch.id,
        { lineAccountId: accountId, expectedVersion: batch.version },
        verified.data.token,
        exportKey,
      )
      if (!exported.success) throw new Error(exported.error)
      onExported(exported.data.downloadUrl)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '銀行用CSVを出力できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={Boolean(batch)}
      title="認証アプリで本人確認"
      description="口座情報を含む銀行用CSVは、6桁コードで再認証したときだけ書き出せます。"
      busy={busy}
      error={error}
      onCancel={onClose}
      footer={(
        <div className="border-hairline flex justify-end gap-2 border-t pt-4">
          <Button type="button" onClick={onClose} disabled={busy}>戻る</Button>
          <Button type="button" variant="primary" onClick={() => { void exportCsv() }} disabled={busy || !/^\d{6}$/.test(code)}>
            {busy ? '確認中…' : '本人確認してCSVを書き出す'}
          </Button>
        </div>
      )}
    >
      <label className="text-ink block text-sm font-semibold" htmlFor="affiliate-payout-step-up">
        認証アプリの6桁コード
        <input
          id="affiliate-payout-step-up"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoFocus
          className="border-hairline rounded-control mt-2 min-h-11 w-full border px-3 text-center text-lg font-bold tracking-widest"
          placeholder="000000"
        />
      </label>
    </Dialog>
  )
}

/* どのLINEアカウントの支払いかを必ず渡し、ほかの店の額を混ぜない。 */
export default function AffiliatePaymentTab({ accountId }: { accountId: string }) {
  const period = useMemo(() => currentAffiliateSettlementPeriod(), [])
  const [items, setItems] = useState<AffiliatePaymentSummary[]>([])
  const [preview, setPreview] = useState<AffiliateAccountSettlementPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PaymentFilter>('all')
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [closed, setClosed] = useState<AffiliateAccountSettlementResult | null>(null)
  const [batch, setBatch] = useState<AffiliatePayoutBatch | null>(null)
  const [notice, setNotice] = useState('')
  const [operationError, setOperationError] = useState('')
  const [operationBusy, setOperationBusy] = useState(false)
  const [payoutKey, setPayoutKey] = useState('')
  const statementKeysRef = useRef(new Map<string, string>())

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [settlement, summaries] = await Promise.all([
        api.affiliates.settlementPreview(accountId, period),
        api.affiliates.paymentSummaries(accountId).catch(() => null),
      ])
      if (!settlement.success || !Array.isArray(settlement.data.affiliates)) {
        throw new Error('payment data malformed')
      }
      setItems(summaries?.success && Array.isArray(summaries.data) ? summaries.data : [])
      setPreview(settlement.data)
    } catch {
      setItems([])
      setPreview(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [accountId, period])

  useEffect(() => { void load() }, [load])

  const summaries = useMemo(
    () => new Map(items.map((item) => [item.affiliateId, item])),
    [items],
  )
  const rows = useMemo(() => preview?.affiliates ?? [], [preview])
  const missingBanks = rows.filter((item) => !item.bankProfileRegistered).length
  const shown = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP')
    return rows.filter((item) => {
      if (normalized && !`${item.affiliateName} ${item.code}`.toLocaleLowerCase('ja-JP').includes(normalized)) return false
      if (filter === 'bank_missing') return !item.bankProfileRegistered
      if (filter === 'ready') return item.bankProfileRegistered
      return true
    })
  }, [filter, query, rows])

  const issueStatements = async () => {
    if (!closed || !preview || operationBusy) return
    setOperationBusy(true)
    setOperationError('')
    setNotice('')
    try {
      const statements = await Promise.all(preview.affiliates.map((item) => {
        const key = statementKeysRef.current.get(item.affiliateId) ?? crypto.randomUUID()
        statementKeysRef.current.set(item.affiliateId, key)
        return api.affiliates.createStatement({
          lineAccountId: accountId,
          settlementId: closed.settlementId,
          affiliateId: item.affiliateId,
          expectedVersion: closed.version,
        }, key)
      }))
      const failed = statements.find((statement) => !statement.success)
      if (failed && !failed.success) throw new Error(failed.error)
      setNotice(`${preview.affiliates.length.toLocaleString('ja-JP')}人分の支払明細を発行し、LINE通知を依頼しました。`)
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '支払明細を発行できませんでした')
    } finally {
      setOperationBusy(false)
    }
  }

  const preparePayout = async () => {
    if (!closed || operationBusy) return
    setOperationBusy(true)
    setOperationError('')
    setNotice('')
    try {
      const response = await api.affiliates.createPayoutBatch({
        lineAccountId: accountId,
        settlementId: closed.settlementId,
        expectedVersion: closed.version,
        bankFormat: 'zengin_csv',
      }, payoutKey)
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
    setNotice('銀行用CSVを書き出しました。ファイルは15分で期限切れになります。')
  }

  const summaryUnavailable = error && !loading
  const closeDate = monthDay(preview?.periodTo ?? null)
  const rowCountLabel = loading || error ? '—' : rows.length.toLocaleString('ja-JP')
  const missingBankLabel = loading || error ? '—' : missingBanks.toLocaleString('ja-JP')

  return (
    <div className="space-y-4" data-payment-ledger="settlement-connected">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="まだ払っていない"
          value={summaryUnavailable ? null : preview?.totalAmount ?? 0}
          unit="円"
          detail={summaryUnavailable ? '読み込めませんでした' : `${rows.length.toLocaleString('ja-JP')}人ぶん・締める前の報酬`}
          loading={loading}
        />
        <KpiCard
          title="次の締め"
          value={summaryUnavailable ? null : closeDate.month}
          unit={closeDate.dayUnit}
          detail={summaryUnavailable ? '読み込めませんでした' : '締めると金額が固定されます'}
          badge={!summaryUnavailable && preview ? '近い' : undefined}
          badgeTone="accent"
          loading={loading}
        />
        <KpiCard
          title="次の支払日"
          value={null}
          unit=""
          detail="支払日の設定APIが接続されると表示します"
          loading={loading}
        />
        <KpiCard
          title="今年 払った合計"
          value={null}
          unit=""
          detail="支払履歴APIが接続されると表示します"
          loading={loading}
        />
      </div>

      <div className="rounded-control border border-info bg-info-bg px-4 py-3 text-sm text-info">
        締める前なら、成果を却下すると今回の支払いから外れます。締めたあとの取消は次の支払いで差し引きます。
      </div>

      {closed ? (
        <div className="rounded-control border border-success bg-success-bg px-4 py-3 text-sm text-success">
          {dateLabel(closed.closedAt)} に {yen(closed.totalAmount)}・{closed.conversionCount.toLocaleString('ja-JP')}件を締めました。明細と銀行用CSVを準備できます。
        </div>
      ) : null}
      {notice ? <div className="rounded-control border border-success bg-success-bg px-4 py-3 text-sm text-success">{notice}</div> : null}
      {operationError ? <div role="alert" className="rounded-control border border-danger bg-danger-bg px-4 py-3 text-sm text-danger">{operationError}</div> : null}

      <SettlementCloseDialog
        preview={closeOpen ? preview : null}
        accountId={accountId}
        onClose={() => setCloseOpen(false)}
        onClosed={(result) => {
          setClosed(result)
          setPayoutKey(crypto.randomUUID())
          statementKeysRef.current.clear()
          setNotice('締めの記録を追記しました。')
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => setCloseOpen(true)}
          disabled={loading || error || !preview?.conversionCount || Boolean(closed)}
        >
          {preview ? `${dateLabel(preview.periodTo)} で締める` : '期間を締める'}
        </Button>
        <Button onClick={() => { void issueStatements() }} disabled={!closed || operationBusy}>
          支払明細をまとめて出す
        </Button>
        <Button onClick={() => { void preparePayout() }} disabled={!closed || operationBusy} title={missingBanks > 0 ? '振込先が未登録の人がいる場合は、誰に依頼するかを確認できます' : undefined}>
          振込用CSVを書き出す
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="アフィリエイター名・振込先で探す"
          aria-label="アフィリエイター名・振込先で探す"
          className="border-hairline rounded-control min-w-0 flex-1 border px-3 py-2 text-sm"
          style={{ maxWidth: 460 }}
        />
        <select aria-label="支払い一覧の表示件数" className="border-hairline rounded-control border px-3 py-2 text-sm" defaultValue="20">
          <option value="20">20件表示</option>
        </select>
        <Button onClick={() => setFilter(filter === 'all' ? 'ready' : 'all')} aria-pressed={filter === 'ready'}>今回の締め {rowCountLabel}人</Button>
        <Button disabled title="支払履歴APIが未接続です">過去の支払い —</Button>
        <Button onClick={() => setFilter(filter === 'bank_missing' ? 'all' : 'bank_missing')} aria-pressed={filter === 'bank_missing'}>振込先が未登録 {missingBankLabel}人</Button>
      </div>

      {loading ? (
        <ListState kind="loading" />
      ) : error ? (
        <ListState
          kind="error"
          title="支払いの集計を表示できませんでした"
          description="締め対象や金額を0とは扱っていません。状態を読み直してください。"
          action={<Button onClick={() => { void load() }}>再読み込み</Button>}
        />
      ) : rows.length === 0 ? (
        <ListState
          kind="empty"
          title="今回締められる報酬はありません"
          description="保留期間を過ぎた承認済み成果があると、ここに支払対象が表示されます。"
        />
      ) : shown.length === 0 ? (
        <ListState kind="empty" title="条件に合う人はいません" description="検索または絞り込みを変えてください。" />
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th style={{ width: '24%' }}>払う相手</Th>
              <Th style={{ width: '14%' }} align="right">今回 払う額</Th>
              <Th style={{ width: '13%' }} align="right">中身</Th>
              <Th style={{ width: '17%' }}>振込先</Th>
              <Th style={{ width: '14%' }}>状態</Th>
              <Th style={{ width: '18%' }} align="center">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {shown.map((item) => {
              const summary = summaries.get(item.affiliateId)
              return (
                <Tr key={item.affiliateId}>
                  <NameCell name={item.affiliateName} sub={`コード ${item.code}`} />
                  <Td align="right" className="font-semibold tabular-nums">{yen(item.amount)}</Td>
                  <Td align="right" className="tabular-nums">認めた {item.conversionCount.toLocaleString('ja-JP')}件</Td>
                  <Td>
                    {item.bankProfileRegistered
                      ? <><span className="block font-medium">登録済み</span><span className="text-ink-faint block text-xs">口座番号は本人だけに表示</span></>
                      : <span className="text-warning">登録されていません</span>}
                  </Td>
                  <Td>
                    <span className={item.bankProfileRegistered ? 'text-ink-secondary' : 'text-warning'}>{item.bankProfileRegistered ? 'まだ締めていません' : '振込先が足りません'}</span>
                    {summary?.holdDays ? <span className="text-ink-faint mt-1 block text-xs">認めてから{summary.holdDays}日保留</span> : null}
                  </Td>
                  <Td align="center">
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button onClick={() => setConfirmTarget({ id: item.affiliateId, name: item.affiliateName })}>明細を見る</Button>
                      {item.bankProfileRegistered ? (
                        <Button
                          aria-label={`${item.affiliateName}の支払いを確定する`}
                          onClick={() => setConfirmTarget({ id: item.affiliateId, name: item.affiliateName })}
                        >
                          この人を確定
                        </Button>
                      ) : <span className="text-warning self-center text-xs">本人に登録を依頼</span>}
                    </div>
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
