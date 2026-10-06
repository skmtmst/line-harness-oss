'use client'

/*
 * ★V8 マイル「マイルを手で増やす・減らす」（板 `M8zhjL`）。
 * app/mileage/friends/detail/v8-mileage-adjust-dialog.tsx から写し、直書きの style を外した。
 *
 * 口と約束（理由必須・追記だけ・再送しても二重反映しない・
 * 境界以上は別のオーナー承認・通知の再送）は v7
 * （mileage-adjustment-dialog.tsx）と同じ。見せ方だけ V8——
 * 対象の人・増やす／減らす／0にする・マイル数・有効期限・
 * 理由区分・調整元ID・詳しい理由・知らせる・この変更で起きること・
 * 境界の注記・実行ボタン。起きることが見えた上で押すので、
 * 実行前の確認段はこの1画面にまとめる。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import DateField from '@/components/shared/date-field'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { ApiError, api, type MileageAdjustmentPolicy } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import styles from './mileage.module.css'

/** 手でマイルを動かすときの失敗の言葉（app/mileage/friends/detail/mileage-adjustment-dialog.tsx から写した）。 */
export function mileageAdjustmentErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.message
    if (error.status === 403) return 'マイルを変更する権限がありません。'
    if (error.status === 404) return '対象の友だちまたはLINEアカウントを確認できませんでした。'
    if (error.status === 405) return 'この環境ではマイル変更を実行できません。'
    if (error.status === 409) return '同じ操作との競合を確認しました。画面を読み直してからやり直してください。'
    if (error.status === 428) return '確認手順が完了していません。画面を閉じずに、もう一度内容を確認してください。'
    return 'マイルを変更できませんでした。時間をおいてもう一度お試しください。'
  }
  return error instanceof Error ? '通信に失敗しました。接続を確認してもう一度お試しください。' : '通信に失敗しました。'
}

type Direction = 'increase' | 'decrease' | 'zero'
type ReasonCategory = 'customer_support' | 'order_correction' | 'grant_correction' | 'campaign' | 'other'

const REASON_OPTIONS = [
  { value: 'customer_support', label: '問い合わせ対応' },
  { value: 'order_correction', label: '注文の訂正' },
  { value: 'grant_correction', label: '付与の訂正' },
  { value: 'campaign', label: 'キャンペーン対応' },
  { value: 'other', label: 'その他' },
]

export default function MileageAdjustDialog({
  open,
  accountId,
  friendId,
  friendName,
  friendRank,
  currentBalance,
  onCancel,
  onCompleted,
  canConfigurePolicy,
  initialDirection,
}: {
  open: boolean
  accountId: string
  friendId: string
  friendName: string
  friendRank: string | null
  currentBalance: number
  onCancel: () => void
  onCompleted: () => Promise<void>
  canConfigurePolicy: boolean
  initialDirection?: 'increase' | 'decrease'
}) {
  const [direction, setDirection] = useState<Direction>(initialDirection ?? 'increase')
  const [amountText, setAmountText] = useState('100')
  const [reasonCategory, setReasonCategory] = useState<ReasonCategory>('customer_support')
  const [reason, setReason] = useState('')
  const [sourceReferenceId, setSourceReferenceId] = useState('')
  const [notifyFriend, setNotifyFriend] = useState(true)
  const [expiresOn, setExpiresOn] = useState('')
  const [policy, setPolicy] = useState<MileageAdjustmentPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(false)
  const [policyThresholdText, setPolicyThresholdText] = useState('')
  const [step, setStep] = useState<'input' | 'requested' | 'completed'>('input')
  const [completedResult, setCompletedResult] = useState<{
    entryId: string
    balanceAfter: number
    notificationStatus: string | null
    notificationErrorCode: string | null
  } | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef('')

  const zeroing = direction === 'zero'
  const amount = zeroing ? currentBalance : Number(amountText)
  const delta = direction === 'decrease' || zeroing ? -amount : amount
  const balanceAfter = currentBalance + (Number.isInteger(amount) && amount > 0 ? delta : 0)
  const highValue = Boolean(policy?.configured && policy.approvalThreshold !== null && amount >= policy.approvalThreshold)

  useEffect(() => {
    if (!open) return
    setDirection(initialDirection ?? 'increase')
    setAmountText('100')
    setReasonCategory('customer_support')
    setReason('')
    setSourceReferenceId('')
    setNotifyFriend(true)
    setExpiresOn('')
    setStep('input')
    setError('')
    setBusy(false)
    setCompletedResult(null)
    setRetrying(false)
    setPolicy(null)
    setPolicyThresholdText('')
    idempotencyKey.current = crypto.randomUUID()
    setPolicyLoading(true)
    void api.mileage.adjustmentPolicy(accountId)
      .then((response) => {
        if (response.success) setPolicy(response.data)
      })
      .catch((caught) => setError(mileageAdjustmentErrorMessage(caught)))
      .finally(() => setPolicyLoading(false))
  }, [accountId, initialDirection, open])

  const inputError = useMemo(() => {
    if (zeroing && currentBalance <= 0) return '残高が0のため、0にすることはできません'
    if (!Number.isInteger(amount) || amount <= 0) return '1以上の整数でマイル数を入力してください'
    if (amount > 1_000_000_000) return 'マイル数が大きすぎます'
    if (delta < 0 && amount > currentBalance) return '利用可能な残高を超えて減らすことはできません'
    if (!reason.trim()) return '詳しい理由を入力してください'
    if (reason.trim().length > 500) return '詳しい理由は500文字以内で入力してください'
    if (sourceReferenceId.trim().length > 128) return '調整元IDは128文字以内で入力してください'
    if (expiresOn && direction !== 'increase') return '有効期限はマイルを増やすときだけ指定できます'
    if (expiresOn && new Date(`${expiresOn}T23:59:59+09:00`).getTime() <= Date.now()) return '有効期限は明日以降を選んでください'
    if (!policyLoading && !policy?.configured) {
      return canConfigurePolicy
        ? '高額調整の承認境界が未設定です。下の欄で承認境界を設定してください。'
        : '高額調整の承認境界が未設定です。オーナーへ設定を依頼してください。'
    }
    return null
  }, [amount, canConfigurePolicy, currentBalance, delta, direction, expiresOn, policy, policyLoading, reason, sourceReferenceId, zeroing])

  const valid = inputError === null

  const submit = async () => {
    if (inputError) {
      setError(inputError)
      return
    }
    if (!idempotencyKey.current) {
      setError('操作をやり直してください')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await api.mileage.adjust({
        accountId,
        friendId,
        direction: zeroing ? 'decrease' : direction,
        amount,
        reasonCategory,
        reason: reason.trim(),
        sourceReferenceId: sourceReferenceId.trim() || undefined,
        expiresAt: expiresOn && direction === 'increase' ? new Date(`${expiresOn}T23:59:59+09:00`).toISOString() : undefined,
        notifyFriend,
      }, idempotencyKey.current)
      if (!response.success) throw new Error(response.error)
      if ('approvalRequired' in response.data) {
        setStep('requested')
        return
      }
      const notification = 'notification' in response.data ? response.data.notification : null
      if (notification && notification.status === 'failed') {
        setCompletedResult({
          entryId: response.data.entryId,
          balanceAfter: response.data.balanceAfter,
          notificationStatus: notification.status,
          notificationErrorCode: notification.errorCode,
        })
        setStep('completed')
        await onCompleted()
        return
      }
      await onCompleted()
      onCancel()
    } catch (caught) {
      setError(mileageAdjustmentErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const retryNotification = async () => {
    if (!completedResult) return
    setRetrying(true)
    setError('')
    try {
      const response = await api.mileage.retryMileageNotification(completedResult.entryId, { accountId })
      if (!response.success) throw new Error(response.error)
      const status = response.data.notification?.status ?? null
      setCompletedResult({
        ...completedResult,
        notificationStatus: status,
        notificationErrorCode: response.data.notification?.errorCode ?? null,
      })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '通知を再送できませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setRetrying(false)
    }
  }

  const configurePolicy = async () => {
    const threshold = Number(policyThresholdText)
    if (!Number.isInteger(threshold) || threshold <= 0) {
      setError('別のオーナー承認が必要になるマイル数を、1以上の整数で入力してください')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await api.mileage.setAdjustmentPolicy({ accountId, approvalThreshold: threshold })
      if (response.success) setPolicy(response.data)
    } catch (caught) {
      setError(mileageAdjustmentErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const confirmLabel = !valid
    ? 'マイルを変更する'
    : highValue
      ? 'この内容で承認を依頼する'
      : delta < 0
        ? `${formatNumber(Math.abs(delta))} マイル減らす`
        : `${formatNumber(delta)} マイル増やす`

  return (
    <Dialog
      open={open}
      title="マイルを手で増やす・減らす"
      description="記録に残ります。あとから理由をたどれるようにしてください。"
      busy={busy || policyLoading}
      error={error}
      confirmLabel={step === 'input' ? confirmLabel : undefined}
      cancelLabel={step === 'input' ? 'キャンセル' : undefined}
      onConfirm={() => { if (step === 'input') void submit() }}
      onCancel={() => { if (!busy) onCancel() }}
      footer={step === 'requested' ? (
        <div className={styles.dlgFooterEnd}>
          <Button onClick={onCancel}>閉じる</Button>
        </div>
      ) : step === 'completed' ? (
        <div className={styles.dlgFooterEnd}>
          {completedResult?.notificationStatus === 'failed' ? (
            <Button variant="secondary" disabled={retrying} onClick={() => void retryNotification()} busy={retrying} busyLabel="通知を送り直しています…">
              通知をもう一度送る
            </Button>
          ) : null}
          <Button onClick={onCancel}>閉じる</Button>
        </div>
      ) : undefined}
    >
      {step === 'completed' ? (
        <section aria-label="変更結果">
          {completedResult?.notificationStatus === 'failed' ? (
            <Notice tone="warn">
              {delta < 0 ? '減らした' : '増やした'}マイルは残高に反映済みです。
              友だちへのLINE通知は送れませんでした
              {completedResult.notificationErrorCode === 'delivery_unknown' ? '（送信したか確認できませんでした）' : ''}
              。残高をもう一度動かさずに、通知だけを送り直せます。
            </Notice>
          ) : (
            <Notice tone="success">友だちへの通知を送り直しました。</Notice>
          )}
          <div className={`${styles.delta3} ${styles.dlgSpaced}`}>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>内容</p>
              <p className={styles.deltaValueSmall}>
                {delta < 0 ? '減らす' : '増やす'} {formatNumber(Math.abs(delta))} マイル
              </p>
            </div>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>変更後の残高</p>
              <p className={styles.deltaValueSmall}>{formatNumber(completedResult?.balanceAfter)} マイル</p>
            </div>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>LINE通知</p>
              <p className={styles.deltaValueSmall}>
                {completedResult?.notificationStatus === 'sent' ? '送信済み' : completedResult?.notificationStatus === 'pending' ? '送信中' : '未送信'}
              </p>
            </div>
          </div>
          {completedResult?.notificationStatus === 'failed' ? (
            <p className={styles.dlgPersonSub}>閉じたあとも、履歴の行から通知だけを送り直せます。</p>
          ) : null}
        </section>
      ) : step === 'requested' ? (
        <section aria-label="承認の依頼が完了しました">
          <Notice tone="info">
            別のオーナーへの承認を依頼しました。この変更はまだ残高へ反映されていません。
            承認されると記録され、依頼の内容は取り下げるまで残ります。
          </Notice>
          <div className={`${styles.delta3} ${styles.dlgSpaced}`}>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>内容</p>
              <p className={styles.deltaValueSmall}>
                {delta < 0 ? '減らす' : '増やす'} {formatNumber(Math.abs(delta))} マイル
              </p>
            </div>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>理由</p>
              <p className={styles.deltaValueSmall}>{reason.trim()}</p>
            </div>
          </div>
        </section>
      ) : (
        <div className={styles.dlgBody}>
          <p className={styles.dlgCaption}>だれのマイルを動かしますか</p>
          <div className={styles.dlgPerson}>
            <span className={styles.dlgAvatar} aria-hidden="true">{friendName.slice(0, 1)}</span>
            <div className={styles.dlgPersonText}>
              <p className={styles.dlgPersonName}>{friendName}</p>
              <p className={styles.dlgPersonSub}>
                使える残高 {formatNumber(currentBalance)} マイル{friendRank ? `・会員ランク ${friendRank}` : ''}
              </p>
            </div>
          </div>

          <p className={styles.dlgCaption}>増やすか減らすか</p>
          <div className={styles.seg} role="group" aria-label="増やすか減らすか">
            {([
              { value: 'increase' as const, label: '増やす' },
              { value: 'decrease' as const, label: '減らす' },
              { value: 'zero' as const, label: '0にする' },
            ]).map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.segButton}
                aria-pressed={direction === option.value}
                disabled={option.value === 'zero' && currentBalance <= 0}
                onClick={() => setDirection(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className={styles.dlgGrid2}>
            <div>
              <p className={styles.dlgCaption}>マイル数</p>
              <input
                className={styles.dlgInput}
                inputMode="numeric"
                value={zeroing ? String(currentBalance) : amountText}
                disabled={zeroing}
                onChange={(event) => setAmountText(event.target.value.replace(/[^0-9]/g, ''))}
                aria-label="マイル数"
              />
            </div>
            <div>
              <p className={styles.dlgCaption}>この分の有効期限</p>
              <DateField
                value={expiresOn}
                disabled={direction !== 'increase'}
                onChange={setExpiresOn}
                aria-label="この分の有効期限"
              />
            </div>
          </div>

          <div className={styles.dlgGrid2}>
            <div>
              <p className={styles.dlgCaption}>理由区分</p>
              <Select
                aria-label="理由区分"
                size="full"
                value={reasonCategory}
                options={REASON_OPTIONS}
                onChange={(value) => setReasonCategory(value as ReasonCategory)}
              />
            </div>
            <div>
              <p className={styles.dlgCaption}>問い合わせ・注文・調整元ID <span className={styles.dlgPersonSub}>任意</span></p>
              <input
                className={styles.dlgInput}
                value={sourceReferenceId}
                onChange={(event) => setSourceReferenceId(event.target.value)}
                placeholder="例：注文番号など"
                aria-label="問い合わせ・注文・調整元ID"
              />
            </div>
          </div>

          <p className={styles.dlgCaption}>詳しい理由</p>
          <textarea
            className={styles.dlgTextarea}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="詳しい理由"
          />

          <div>
            <Checkbox
              checked={notifyFriend}
              onCheckedChange={setNotifyFriend}
              description="増減したマイルと変更後の残高をLINEで知らせます。"
            >
              友だちに知らせる（LINE通知）
            </Checkbox>
          </div>

          {!policyLoading && !policy?.configured && canConfigurePolicy ? (
            <section className={styles.dlgWarn} aria-label="高額調整の承認境界を設定">
              <p className={styles.dlgPersonName}>高額調整の承認境界が未設定です</p>
              <p className={styles.dlgPersonSub}>この値以上は、この画面では実行せず、別のオーナー承認を必要とします。</p>
              <div className={styles.policyRow}>
                <input
                  className={styles.dlgInput}
                  inputMode="numeric"
                  value={policyThresholdText}
                  onChange={(event) => setPolicyThresholdText(event.target.value.replace(/[^0-9]/g, ''))}
                  aria-label="別のオーナー承認が必要になるマイル数"
                />
                <Button onClick={() => void configurePolicy()} disabled={busy}>承認境界を保存する</Button>
              </div>
            </section>
          ) : null}

          <p className={styles.dlgCaption}>この変更で起きること</p>
          <div className={styles.delta3}>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>変更前</p>
              <p className={styles.deltaValue}>{formatNumber(currentBalance)}</p>
            </div>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>変更量</p>
              <p className={styles.deltaValue}>
                {valid ? `${delta > 0 ? '+' : ''}${formatNumber(delta)}` : '—'}
              </p>
            </div>
            <div className={styles.deltaCell}>
              <p className={styles.deltaLabel}>変更後の残高</p>
              <p className={styles.deltaValue}>{valid ? formatNumber(balanceAfter) : '—'}</p>
            </div>
          </div>

          {policy?.configured && policy.approvalThreshold !== null ? (
            <p className={styles.dlgPersonSub}>
              {formatNumber(policy.approvalThreshold)} マイル以上は、この画面では実行せず、別のオーナー承認を必要とします。
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
