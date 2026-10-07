'use client'

/*
 * 支払いのタブの窓。
 * - 期間を締める（確かめ）：★V8-B `usDpO`（520幅）。締めの口・合言葉（冪等キー）・0円で外れた成果の
 *   知らせは app/affiliates/payment-tab.tsx の SettlementCloseDialog と同じ。見た目だけ絵どおりに
 *   （対象・合計・振込先が未登録の人の知らせ・やめる／締める）。払う相手ごとの内訳は表のタブに出ている。
 * - 銀行用 CSV の本人確認：PayoutStepUpDialog を写した（`CVz5d`。この担当の板ではない）。
 */
import { useEffect, useState } from 'react'
import { CircleHelp, Lock } from 'lucide-react'
import {
  api,
  type AffiliateAccountSettlementPreview,
  type AffiliateAccountSettlementResult,
  type AffiliatePayoutBatch,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { formatDate, formatYen, periodText } from './display'
import styles from './affiliates.module.css'

export function SettlementCloseDialog({
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

  const excludedZero = preview?.excludedZeroAmount ?? null
  const missing = preview?.affiliates.filter((item) => !item.bankProfileRegistered) ?? []

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
      designNode="usDpO"
      designWidth={520}
      confirmation
      designHeaderPadding="29px 24px 0"
      designHeaderHeight={52}
      title={preview ? `${periodText(preview)} を締めますか？` : '期間を締めますか？'}
      busy={busy}
      error={error}
      onCancel={onClose}
    >
      {preview ? (
        <div className={styles.closeBody}>
          {/* 絵 usDpO：説明・対象・合計・注意・ボタンを間 12 で縦に並べる。ボタンは窓の帯ではなく本文の続き（真ん中）。 */}
          <p className={styles.closeDesc}>締めると、この期間に認めた成果の金額が固定されます。締めたあとに成果を取り消すと、次の支払いで差し引きます。</p>
          <dl className={styles.closeLines}>
            <div><dt>対象</dt><dd>{`${formatNumber(preview.affiliates.length)}人・${formatNumber(preview.conversionCount)}件`}</dd></div>
            <div>
              <dt>合計</dt>
              <dd>
                {formatYen(preview.totalAmount)}
                {(preview.totalDeduction ?? 0) > 0 ? (
                  <span className={styles.closeSub}>{`元の報酬 ${formatYen(preview.totalAmount + (preview.totalDeduction ?? 0))} − 取消の差し引き ${formatYen(preview.totalDeduction ?? 0)}`}</span>
                ) : null}
              </dd>
            </div>
          </dl>
          {missing.length > 0 ? (
            <p className={styles.closeWarn} role="note">
              <CircleHelp size={14} aria-hidden="true" />
              <span>
                {`振込先が未登録の人が ${formatNumber(missing.length)} 人います（${missing.slice(0, 3).map((item) => `${item.affiliateName} ${formatYen(item.amount)}`).join('・')}${missing.length > 3 ? ` ほか${formatNumber(missing.length - 3)}人` : ''}）。締めても、登録されるまで振り込めません。`}
              </span>
            </p>
          ) : null}
          {excludedZero && excludedZero.count > 0 ? (
            <div className={styles.closeExcluded}>
              <p>{`報酬が0円の成果 ${formatNumber(excludedZero.count)}件は、支払えないため今回の締め対象から外れています。`}</p>
              <ul>
                {excludedZero.rows.map((row) => (
                  <li key={row.conversionEventId}>{`${row.affiliateName}（${row.code}）・${formatDate(row.approvedAt)}に承認・${formatYen(row.rewardAmount)}`}</li>
                ))}
              </ul>
              {excludedZero.count > excludedZero.rows.length ? <p>{`ほか ${formatNumber(excludedZero.count - excludedZero.rows.length)}件`}</p> : null}
            </div>
          ) : null}
          <div className={styles.closeFooter}>
            <Button type="button" onClick={onClose} disabled={busy}>やめる</Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { if (preview.conversionCount) void closeSettlement() }}
              disabled={busy || !preview.conversionCount}
              busy={busy}
              busyLabel="締めています"
            >
              <Lock size={15} aria-hidden="true" />
              締める
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

export function PayoutStepUpDialog({
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
  /* 2段階認証を使っている人は6桁、無い人はパスワードで確認する。 */
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
      const exported = await api.affiliates.exportPayoutBatch(batch.id, { lineAccountId: accountId, expectedVersion: batch.version }, verified.data.token, exportKey)
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
      designNode="CVz5d"
      title={usePassword ? 'パスワードで本人確認' : '認証アプリで本人確認'}
      description={usePassword
        ? '口座情報を含む銀行用CSVは、パスワードで再認証したときだけ書き出せます。'
        : '口座情報を含む銀行用CSVは、6桁コードで再認証したときだけ書き出せます。'}
      busy={busy}
      error={stepUpMethod === 'none' ? 'この操作には二段階認証またはパスワードの設定が必要です。' : error}
      onCancel={onClose}
      footer={(
        <div className={styles.dialogActions}>
          <Button type="button" onClick={onClose} disabled={busy}>戻る</Button>
          {stepUpMethod !== 'none' ? (
            <Button type="button" variant="primary" onClick={() => { void exportCsv() }} disabled={busy || !ready} busy={busy} busyLabel="確認しています">
              本人確認してCSVを書き出す
            </Button>
          ) : null}
        </div>
      )}
    >
      {batch ? <p className={styles.closeSub}>{`書き出す中身：${formatNumber(batch.lineCount)}件・${formatYen(batch.totalAmount)}`}</p> : null}
      {usePassword ? (
        <label className={styles.stepField} htmlFor="affiliate-payout-step-up">
          パスワード
          <input
            id="affiliate-payout-step-up"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
            autoComplete="current-password"
            className={styles.stepInput}
          />
        </label>
      ) : stepUpMethod === 'totp' ? (
        <label className={styles.stepField} htmlFor="affiliate-payout-step-up">
          認証アプリの6桁コード
          <input
            id="affiliate-payout-step-up"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoFocus
            className={styles.stepInput}
            placeholder="000000"
          />
        </label>
      ) : null}
    </Dialog>
  )
}
