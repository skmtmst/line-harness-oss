'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  api,
  type AffiliateAccountSettlementPreview,
  type AffiliateAccountSettlementResult,
  type AffiliatePaymentSummary,
  type AffiliatePayoutBatch,
  type AffiliateSettlementResume,
} from '@/lib/api'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import { AffiliatePaymentConfirmDialog } from './action-dialogs'
import { formatDay, formatNumber } from '@/lib/format'

type PaymentFilter = 'all' | 'bank_missing' | 'bank_ok'

function yen(value: number): string {
  return `¥${formatNumber(Math.round(value))}`
}

function dateLabel(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDay(date)
}

function monthDay(value: string | null): { month: number | null; dayUnit: string } {
  if (!value) return { month: null, dayUnit: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { month: null, dayUnit: '' }
  // 期間の表示は締めの時差(Asia/Tokyo)に揃える。端末の現地時間で
  // 月名がずれると「何月の締めか」を誤認する。
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return { month: jst.getUTCMonth() + 1, dayUnit: `/${jst.getUTCDate()}` }
}

/**
 * 締め期間は業務上の時差(Asia/Tokyo)の暦月で固定する(R45)。
 * 端末のタイムゾーンで月初を取ると、見る場所で締めの範囲が変わる。
 */
export function currentAffiliateSettlementPeriod(now = new Date()): { periodFrom: string; periodTo: string } {
  const jstParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric',
  }).formatToParts(now)
  const year = Number(jstParts.find((part) => part.type === 'year')?.value)
  const month = Number(jstParts.find((part) => part.type === 'month')?.value)
  const JST_MS = 9 * 60 * 60 * 1000
  return {
    periodFrom: new Date(Date.UTC(year, month - 1, 1) - JST_MS).toISOString(),
    periodTo: new Date(Date.UTC(year, month, 1) - JST_MS - 1).toISOString(),
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

  // 0円で締め対象から外れた成果。古いWorkerでは項目自体が無いので、
  // 無いときは何も出さず今までどおりの確認画面にする(N-219)。
  const excludedZero = preview?.excludedZeroAmount ?? null

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
          <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => { void closeSettlement() }} disabled={busy || !preview?.conversionCount}>
            {busy ? '締めています…' : `${yen(preview?.totalAmount ?? 0)} で締める`}
          </Button>
        </div>
      )}
    >
      {preview ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="bg-canvas-sunken rounded-control p-3">
              <dt className="text-ink-faint text-xs">締める額</dt>
              <dd className="text-ink mt-1 text-lg font-bold">{yen(preview.totalAmount)}</dd>
              {(preview.totalDeduction ?? 0) > 0 ? (
                <p className="text-ink-faint mt-1 text-xs">
                  元の報酬 {yen(preview.totalAmount + (preview.totalDeduction ?? 0))} − 取消の差し引き {yen(preview.totalDeduction ?? 0)}
                </p>
              ) : null}
            </div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">払う相手</dt><dd className="text-ink mt-1 text-lg font-medium">{formatNumber(preview.affiliates.length)}人</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">成果</dt><dd className="text-ink mt-1 text-lg font-medium">{formatNumber(preview.conversionCount)}件</dd></div>
          </dl>
          <div className="border-hairline overflow-hidden rounded-control border">
            <table className="w-full text-sm">
              <thead><TableHeadRow><Th>払う相手</Th><Th align="right">成果</Th><Th align="right">金額</Th><Th>振込先</Th></TableHeadRow></thead>
              <tbody className="divide-hairline divide-y">
                {preview.affiliates.map((item) => (
                  <tr key={item.affiliateId}>
                    <td className="text-ink px-3 py-2 font-medium">{item.affiliateName}</td>
                    <td className="text-ink-secondary px-3 py-2 text-right tabular-nums">{formatNumber(item.conversionCount)}件</td>
                    <td className="text-ink px-3 py-2 text-right font-semibold tabular-nums">{yen(item.amount)}</td>
                    <td className="px-3 py-2">{item.bankProfileRegistered ? '登録済み' : <span className="text-warning">未登録</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {excludedZero && excludedZero.count > 0 ? (
            <div className="border-hairline rounded-control border p-3">
              <p className="text-ink-secondary text-xs leading-5">
                報酬が0円の成果 {formatNumber(excludedZero.count)}件は、支払えないため今回の締め対象から外れています。
              </p>
              <ul className="text-ink-faint mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                {excludedZero.rows.map((row) => (
                  <li key={row.conversionEventId}>
                    {row.affiliateName}（{row.code}）・{dateLabel(row.approvedAt)}に承認・{yen(row.rewardAmount)}
                  </li>
                ))}
              </ul>
              {excludedZero.count > excludedZero.rows.length ? (
                <p className="text-ink-faint mt-1 text-xs">
                  ほか {formatNumber((excludedZero.count - excludedZero.rows.length))}件
                </p>
              ) : null}
            </div>
          ) : null}
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
  /* V-1: 2段階認証を使っている人は6桁、無い人はパスワードで確認する。 */
  const stepUpMethod = readSessionSnapshot()?.stepUpMethod ?? 'totp'
  const usePassword = stepUpMethod === 'password'
  const ready = usePassword ? code.length > 0 : /^\d{6}$/.test(code)

  useEffect(() => {
    if (!batch) return
    setCode('')
    setError('')
    setExportKey(crypto.randomUUID())
  }, [batch])

  const exportCsv = async () => {
    if (!batch || !ready || busy || stepUpMethod === 'none') return
    setBusy(true)
    setError('')
    try {
      const verified = await api.affiliates.payoutStepUp({ method: usePassword ? 'password' : 'totp', value: code })
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
      title={usePassword ? 'パスワードで本人確認' : '認証アプリで本人確認'}
      description={usePassword
        ? '口座情報を含む銀行用CSVは、パスワードで再認証したときだけ書き出せます。'
        : '口座情報を含む銀行用CSVは、6桁コードで再認証したときだけ書き出せます。'}
      busy={busy}
      error={stepUpMethod === 'none' ? 'この操作には二段階認証またはパスワードの設定が必要です。' : error}
      onCancel={onClose}
      footer={(
        <div className="border-hairline flex justify-end gap-2 border-t pt-4">
          <Button type="button" onClick={onClose} disabled={busy}>戻る</Button>
          {stepUpMethod !== 'none' && (
            <Button type="button" variant="primary" onClick={() => { void exportCsv() }} disabled={busy || !ready}>
              {busy ? '確認中…' : '本人確認してCSVを書き出す'}
            </Button>
          )}
        </div>
      )}
    >
      {usePassword ? (
        <label className="text-ink block text-sm font-semibold" htmlFor="affiliate-payout-step-up">
          パスワード
          <input
            id="affiliate-payout-step-up"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
            autoComplete="current-password"
            className="border-shell-gray rounded-control mt-2 min-h-11 w-full border bg-canvas px-3 text-sm font-normal text-ink outline-none focus:border-action"
          />
        </label>
      ) : stepUpMethod === 'totp' ? (
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
      ) : null}
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
  const [resumed, setResumed] = useState<AffiliateSettlementResume | null>(null)
  const [batch, setBatch] = useState<AffiliatePayoutBatch | null>(null)
  const [operationError, setOperationError] = useState('')
  const [operationBusy, setOperationBusy] = useState(false)
  const [payoutKey, setPayoutKey] = useState('')
  const statementKeysRef = useRef(new Map<string, string>())
  // R46: アカウント切替で前のアカウントの応答が遅れて戻っても、
  // 選択中の表示を上書きしないよう世代番号で捨てる。
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(false)
    // 切替直後の表示は前アカウントの残りで進まないよう状態を戻す。
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
        // R43: この期間に締め済みの台帳があれば、明細・CSVの続きを再開する。
        api.affiliates.settlementCurrent(accountId, period).catch(() => null),
      ])
      if (seq !== loadSeq.current) return // 遅れて戻った前アカウントの応答は捨てる
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
      // R47: 「振込先登録済み」は独立の条件。今回の締め(対象全員)とは分ける。
      if (filter === 'bank_ok') return item.bankProfileRegistered
      return true
    })
  }, [filter, query, rows])

  // R43: 締め済み台帳から再開したときはプレビューが空になるため、
  // 明細の対象は台帳の内訳(再開情報)から取る。
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
      // 1人失敗で全体失敗にしない。人ごとに結果を分けて出す。
      // 合言葉は人ごとに使い回すので、押し直しは失敗分だけ試せる。
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
      // 発行済みの人を再送対象から外すため、再開情報を取り直す。
      if (resumed && succeeded > 0) void load()
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '支払明細を発行できませんでした')
    } finally {
      setOperationBusy(false)
    }
  }

  const preparePayout = async () => {
    if (!closed || operationBusy) return
    // 合言葉（再実行キー）は締め直後だけでなく再開時も必要。
    // 画面を離れて戻った場合はここで払い出す（二重発行の不安を残さない）。
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
  const closeDate = monthDay(preview?.periodTo ?? null)
  const rowCountLabel = loading || error ? '—' : formatNumber(rows.length)
  const bankOkCount = rows.filter((item) => item.bankProfileRegistered).length
  const bankOkLabel = loading || error ? '—' : formatNumber(bankOkCount)
  const missingBankLabel = loading || error ? '—' : formatNumber(missingBanks)
  const issuedCount = resumed?.affiliates.filter((item) => item.statementIssued).length ?? 0

  return (
    <div className="space-y-4" data-payment-ledger="settlement-connected">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="まだ払っていない"
          value={summaryUnavailable ? null : preview?.totalAmount ?? 0}
          unit="円"
          detail={summaryUnavailable ? '読み込めませんでした' : `${formatNumber(rows.length)}人ぶん・締める前の報酬`}
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

      <Notice tone="info" message="締める前なら、成果を却下すると今回の支払いから外れます。締めたあとの取消は次の支払いで差し引きます。" />

      {/* R44: 前の締めに間に合わなかった分が含まれることを明記する。 */}
      {preview?.carriedOver && preview.carriedOver.count > 0 ? (
        <Notice tone="info">
          前の締めから持ち越した分 {formatNumber(preview.carriedOver.count)}件・{yen(preview.carriedOver.amount)} を含んでいます。締める期間は {dateLabel(preview.periodFrom)}〜{dateLabel(preview.periodTo)} です。
        </Notice>
      ) : null}

      {/* R288: 取消の差し引きと、引ききれず次回へ繰り越す分を明記する。 */}
      {(preview?.totalDeduction ?? 0) > 0 || (preview?.carriedDeduction?.amount ?? 0) > 0 ? (
        <Notice tone="info">
          締めたあとに取り消された分 {yen(preview?.totalDeduction ?? 0)} を差し引いています。
          {(preview?.carriedDeduction?.amount ?? 0) > 0
            ? `今回引ききれない ${yen(preview?.carriedDeduction?.amount ?? 0)} は次回へ繰り越し、正の振込はその分だけ減ります。`
            : ''}
        </Notice>
      ) : null}

      {preview?.excludedZeroAmount && preview.excludedZeroAmount.count > 0 ? (
        <Notice tone="warn">
          報酬が0円の成果 {formatNumber(preview.excludedZeroAmount.count)}件は、支払えないため今回の締め対象から外れています。対象は「{dateLabel(preview.periodTo)} で締める」の確認画面で見られます。
        </Notice>
      ) : null}

      {closed ? (
        <Notice tone="success">
          {resumed
            ? `${dateLabel(closed.closedAt)} に締めた記録を読み出しました。${issuedCount > 0 ? `明細は ${formatNumber(resumed!.affiliates.length)}人中 ${formatNumber(issuedCount)}人分が発行済みです。` : ''}${resumed!.batch ? ' 振込用CSVの準備も作成済みです。' : ' 明細と銀行用CSVの準備を続けられます。'}`
            : `${dateLabel(closed.closedAt)} に ${yen(closed.totalAmount)}・${formatNumber(closed.conversionCount)}件を締めました。明細と銀行用CSVを準備できます。`}
        </Notice>
      ) : null}
      {operationError ? <Notice tone="danger" message={operationError} onClose={() => setOperationError('')} /> : null}

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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => setCloseOpen(true)}
          disabled={loading || error || !preview?.conversionCount || Boolean(closed)}
        >
          {preview ? `${dateLabel(preview.periodTo)} で締める` : '期間を締める'}
        </Button>
        <Button onClick={() => { void issueStatements() }} disabled={!closed || operationBusy || statementTargets.length === 0}>
          {resumed && issuedCount > 0 ? `支払明細をまとめて出す（残り${formatNumber(statementTargets.length)}人）` : '支払明細をまとめて出す'}
        </Button>
        <Button onClick={() => { void preparePayout() }} disabled={!closed || operationBusy || Boolean(resumed?.batch)} title={resumed?.batch ? '振込用CSVの準備は作成済みです' : missingBanks > 0 ? '振込先が未登録の人がいる場合は、誰に依頼するかを確認できます' : undefined}>
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
        {/* 選べる件数が1つだけで何も変わらない飾りは置かない（★V7の決まり）。絞り込みの札は共通 FilterChip（本線）。 */}
        {/* R47: 「今回の締め」は締め対象の全員を指す。口座登録の有無で数を絞らない。 */}
        <FilterChip selected={filter === 'all'} onChange={() => setFilter('all')} count={`${rowCountLabel}人`}>今回の締め</FilterChip>
        <FilterChip selected={filter === 'bank_ok'} onChange={(on) => setFilter(on ? 'bank_ok' : 'all')} count={`${bankOkLabel}人`}>振込先登録済み</FilterChip>
        <FilterChip selected={false} onChange={() => {}} disabled title="支払履歴APIが未接続です">過去の支払い</FilterChip>
        <FilterChip selected={filter === 'bank_missing'} onChange={(on) => setFilter(on ? 'bank_missing' : 'all')} count={`${missingBankLabel}人`}>振込先が未登録</FilterChip>
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
                  <Td align="right" className="font-semibold tabular-nums">
                    {yen(item.amount)}
                    {(item.deduction ?? 0) > 0 ? (
                      <span className="text-ink-faint mt-0.5 block text-xs font-normal">
                        元の報酬 {yen(item.grossAmount ?? item.amount + (item.deduction ?? 0))} − 取消の差し引き {yen(item.deduction ?? 0)}
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right" className="tabular-nums">認めた {formatNumber(item.conversionCount)}件</Td>
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
