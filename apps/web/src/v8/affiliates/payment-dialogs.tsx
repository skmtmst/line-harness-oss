'use client'

/*
 * 支払いのタブの窓。
 * - 期間を締める（確かめ）：★V8-B `usDpO`（520幅）。締めの口・合言葉（冪等キー）・0円で外れた成果の
 *   知らせは app/affiliates/payment-tab.tsx の SettlementCloseDialog と同じ。見た目だけ絵どおりに
 *   （対象・合計・振込先が未登録の人の知らせ・やめる／締める）。払う相手ごとの内訳は表のタブに出ている。
 * - 銀行用 CSV の本人確認：PayoutStepUpDialog を写した（`CVz5d`。この担当の板ではない）。
 */
import { useEffect, useState } from 'react'
import { CircleHelp, Download, Lock } from 'lucide-react'
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
import OtpInput from '@/components/shared/otp-input'
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
  /* 2段階認証を使っている人は6桁、無い人はパスワードで確認する。6桁の人も「パスワードで本人確認」に切り替えられる（絵 CVz5d）。 */
  const stepUpMethod = readSessionSnapshot()?.stepUpMethod ?? 'totp'
  const [preferPassword, setPreferPassword] = useState(false)
  const usePassword = stepUpMethod === 'password' || (stepUpMethod === 'totp' && preferPassword)
  const ready = usePassword ? code.length > 0 : /^\d{6}$/.test(code)

  useEffect(() => {
    if (!batch) return
    setCode('')
    setError('')
    setPreferPassword(false)
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

  const summary = batch ? `書き出す中身：${formatNumber(batch.lineCount)}件・${formatYen(batch.totalAmount)}` : undefined

  return (
    <Dialog
      open={Boolean(batch)}
      designNode="CVz5d"
      designWidth={520}
      confirmation
      designHeaderPadding="29px 24px 0"
      designHeaderHeight={52}
      title="本人確認をしてください"
      busy={busy}
      error={stepUpMethod === 'none' ? 'この操作には二段階認証またはパスワードの設定が必要です。' : error}
      onCancel={onClose}
    >
      {/* 絵 CVz5d：説明・6桁の欄・切り替えのリンク・ボタン（本文の続き・真ん中）を間 12 で縦に並べる。 */}
      <div className={styles.closeBody}>
        <p className={styles.closeDesc} title={summary}>
          {usePassword
            ? '銀行用 CSV には口座情報が入ります。パスワードで本人確認したときだけ書き出せます。ファイルは 15 分で期限切れになります。'
            : '銀行用 CSV には口座情報が入ります。認証アプリの 6 桁コードで本人確認したときだけ書き出せます。ファイルは 15 分で期限切れになります。'}
        </p>
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
          <OtpInput
            id="affiliate-payout-step-up"
            visualLabel="認証コード（6桁）"
            label="認証アプリの6桁コード"
            value={code}
            onChange={setCode}
            invalid={Boolean(error)}
            disabled={busy}
            autoFocus
          />
        ) : null}
        {stepUpMethod === 'totp' ? (
          <p className={styles.stepSwitch}>
            {usePassword ? '認証アプリが使えるときは ' : '認証アプリが使えないときは '}
            <button type="button" className={styles.linkButton} onClick={() => { setPreferPassword((current) => !current); setCode(''); setError('') }}>
              {usePassword ? '6 桁コードで本人確認' : 'パスワードで本人確認'}
            </button>
          </p>
        ) : null}
        <div className={styles.closeFooter}>
          <Button type="button" onClick={onClose} disabled={busy}>やめる</Button>
          {stepUpMethod !== 'none' ? (
            <Button type="button" variant="primary" title={summary} onClick={() => { void exportCsv() }} disabled={busy || !ready} busy={busy} busyLabel="確認しています">
              <Download size={15} aria-hidden="true" />
              確認して書き出す
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
