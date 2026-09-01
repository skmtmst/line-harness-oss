'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import { ChoiceCard } from '@/components/shared/create-page'
import Dialog from '@/components/shared/dialog'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'
import Select from '@/components/shared/select'
import { ApiError, api, type MileageAdjustmentPolicy } from '@/lib/api'

type Direction = 'increase' | 'decrease'
type ReasonCategory = 'customer_support' | 'order_correction' | 'grant_correction' | 'campaign' | 'other'

const REASON_OPTIONS = [
  { value: 'customer_support', label: '問い合わせ対応' },
  { value: 'order_correction', label: '注文の訂正' },
  { value: 'grant_correction', label: '付与の訂正' },
  { value: 'campaign', label: 'キャンペーン対応' },
  { value: 'other', label: 'その他' },
]

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.message
    if (error.status === 403) return 'マイルを変更する権限がありません。'
    if (error.status === 404) return '対象の友だちまたはLINEアカウントを確認できませんでした。'
    if (error.status === 405) return 'この環境ではマイル変更を実行できません。'
    if (error.status === 409) return '同じ操作との競合を確認しました。画面を読み直してからやり直してください。'
    return 'マイルを変更できませんでした。時間をおいてもう一度お試しください。'
  }
  return error instanceof Error ? '通信に失敗しました。接続を確認してもう一度お試しください。' : '通信に失敗しました。'
}

export default function MileageAdjustmentDialog({
  open,
  accountId,
  friendId,
  friendName,
  currentBalance,
  onCancel,
  onCompleted,
  canConfigurePolicy,
}: {
  open: boolean
  accountId: string
  friendId: string
  friendName: string
  currentBalance: number
  onCancel: () => void
  onCompleted: () => Promise<void>
  canConfigurePolicy: boolean
}) {
  const [direction, setDirection] = useState<Direction>('increase')
  const [amountText, setAmountText] = useState('')
  const [reasonCategory, setReasonCategory] = useState<ReasonCategory>('customer_support')
  const [reason, setReason] = useState('')
  const [sourceReferenceId, setSourceReferenceId] = useState('')
  const [policy, setPolicy] = useState<MileageAdjustmentPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(false)
  const [policyThresholdText, setPolicyThresholdText] = useState('')
  const [step, setStep] = useState<'input' | 'confirm'>('input')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef('')
  const amount = Number(amountText)
  const delta = direction === 'decrease' ? -amount : amount
  const balanceAfter = currentBalance + (Number.isInteger(amount) && amount > 0 ? delta : 0)
  const highValue = Boolean(policy?.configured && policy.approvalThreshold !== null && amount >= policy.approvalThreshold)

  useEffect(() => {
    if (!open) return
    setDirection('increase')
    setAmountText('')
    setReasonCategory('customer_support')
    setReason('')
    setSourceReferenceId('')
    setStep('input')
    setError('')
    setBusy(false)
    setPolicy(null)
    setPolicyThresholdText('')
    idempotencyKey.current = crypto.randomUUID()
    setPolicyLoading(true)
    void api.mileage.adjustmentPolicy(accountId)
      .then((response) => {
        if (response.success) setPolicy(response.data)
      })
      .catch((caught) => setError(messageOf(caught)))
      .finally(() => setPolicyLoading(false))
  }, [accountId, open])

  const inputError = useMemo(() => {
    if (!Number.isInteger(amount) || amount <= 0) return '1以上の整数でマイル数を入力してください'
    if (amount > 1_000_000_000) return 'マイル数が大きすぎます'
    if (direction === 'decrease' && amount > currentBalance) return '利用可能な残高を超えて減らすことはできません'
    if (!reason.trim()) return '詳しい理由を入力してください'
    if (reason.trim().length > 500) return '詳しい理由は500文字以内で入力してください'
    if (sourceReferenceId.trim().length > 128) return '調整元IDは128文字以内で入力してください'
    if (!policyLoading && !policy?.configured) return '高額調整の承認境界が未設定です。オーナーが先に設定してください。'
    if (highValue) return `${policy?.approvalThreshold?.toLocaleString('ja-JP')} mile以上は別のオーナー承認が必要です。`
    return null
  }, [amount, currentBalance, direction, highValue, policy, policyLoading, reason, sourceReferenceId])

  const submit = async () => {
    if (step === 'input') {
      if (inputError) return setError(inputError)
      setError('')
      setStep('confirm')
      return
    }
    if (inputError || !idempotencyKey.current) return setError(inputError || '操作をやり直してください')
    setBusy(true)
    setError('')
    try {
      await api.mileage.adjust({
        accountId,
        friendId,
        direction,
        amount,
        reasonCategory,
        reason: reason.trim(),
        sourceReferenceId: sourceReferenceId.trim() || undefined,
      }, idempotencyKey.current)
      await onCompleted()
      onCancel()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
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
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  const reasonLabel = REASON_OPTIONS.find((option) => option.value === reasonCategory)?.label ?? reasonCategory

  return (
      <Dialog
        open={open}
        designNode="vz0Ji"
        title="マイルを手で増やす・減らす"
        description="記録に残ります。あとから理由をたどれるようにしてください。"
        busy={busy || policyLoading}
        error={error}
        confirmLabel={step === 'input' ? '変更内容を確認' : `この内容で${direction === 'increase' ? '増やす' : '減らす'}`}
        cancelLabel={step === 'confirm' ? '入力に戻る' : 'キャンセル'}
        onConfirm={() => void submit()}
        onCancel={() => {
          if (step === 'confirm' && !busy) {
            setStep('input')
            setError('')
          } else {
            onCancel()
          }
        }}
      >
        <div className="space-y-5">
          <section className="rounded-control bg-canvas-sunken p-4">
            <p className="text-xs font-semibold text-ink-faint">だれのマイルを動かしますか</p>
            <p className="mt-2 font-bold text-ink">{friendName}</p>
            <p className="mt-1 text-sm text-ink-secondary">いまの残高 {currentBalance.toLocaleString('ja-JP')} mile</p>
          </section>

          {step === 'input' ? (
            <>
              <div className="grid grid-cols-2 gap-3" aria-label="増やすか減らすか">
                {(['increase', 'decrease'] as const).map((value) => (
                  <ChoiceCard
                    key={value}
                    selected={direction === value}
                    onClick={() => setDirection(value)}
                    title={value === 'increase' ? '増やす' : '減らす'}
                    note={value === 'increase' ? '残高に足します' : '残高から引きます'}
                  />
                ))}
              </div>
              {direction === 'decrease' ? (
                <p className="rounded-control bg-warning-bg p-3 text-xs leading-5 text-warning">
                  残高より多くは減らせません。変更後の残高が0未満になる操作は実行しません。
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="マイル数" htmlFor="mileage-adjustment-amount" required>
                  <TextInput id="mileage-adjustment-amount" inputMode="numeric" value={amountText} onChange={(event) => setAmountText(event.target.value.replace(/[^0-9]/g, ''))} />
                </Field>
                <Field label="理由区分" htmlFor="mileage-adjustment-reason-category" required>
                  <Select id="mileage-adjustment-reason-category" aria-label="理由区分" size="full" value={reasonCategory} options={REASON_OPTIONS} onChange={(value) => setReasonCategory(value as ReasonCategory)} />
                </Field>
              </div>
              <Field label="詳しい理由" htmlFor="mileage-adjustment-reason" required note="履歴に残り、あとから実行者と一緒に確認できます。">
                <TextArea id="mileage-adjustment-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <Field label="問い合わせ・注文・調整元ID" htmlFor="mileage-adjustment-reference" note="分かる場合だけ入力してください。">
                <TextInput id="mileage-adjustment-reference" value={sourceReferenceId} onChange={(event) => setSourceReferenceId(event.target.value)} />
              </Field>
              {!policyLoading && !policy?.configured && canConfigurePolicy ? (
                <section className="rounded-control border border-warning bg-warning-bg p-3" aria-label="高額調整の承認境界を設定">
                  <p className="text-sm font-bold text-ink">高額調整の承認境界が未設定です</p>
                  <p className="mt-1 text-xs leading-5 text-ink-secondary">この値以上は、この画面では実行せず、別のオーナー承認を必要とします。</p>
                  <div className="mt-3 flex items-end gap-2">
                    <Field label="別のオーナー承認が必要になるマイル数" htmlFor="mileage-adjustment-threshold" required>
                      <TextInput id="mileage-adjustment-threshold" inputMode="numeric" value={policyThresholdText} onChange={(event) => setPolicyThresholdText(event.target.value.replace(/[^0-9]/g, ''))} />
                    </Field>
                    <Button onClick={() => void configurePolicy()} disabled={busy}>承認境界を保存</Button>
                  </div>
                </section>
              ) : null}
              <p className="rounded-control bg-info-bg p-3 text-xs leading-5 text-ink-secondary">
                LINE通知と有効期限の指定は、送信・失効台帳が接続されるまで実行しません。画面だけで「通知済み」「1年後に失効」とは表示しません。
              </p>
            </>
          ) : (
            <section aria-label="変更内容の確認" className="space-y-3">
              <h3 className="text-sm font-bold text-ink">この変更で起きること</h3>
              <dl className="overflow-hidden rounded-card border border-hairline text-sm">
                <div className="flex justify-between border-b border-hairline px-4 py-3"><dt className="text-ink-faint">変更前</dt><dd className="font-semibold text-ink">{currentBalance.toLocaleString('ja-JP')} mile</dd></div>
                <div className="flex justify-between border-b border-hairline px-4 py-3"><dt className="text-ink-faint">変更量</dt><dd className={delta < 0 ? 'font-bold text-danger' : 'font-bold text-accent'}>{delta > 0 ? '+' : ''}{delta.toLocaleString('ja-JP')} mile</dd></div>
                <div className="flex justify-between px-4 py-3"><dt className="text-ink-faint">変更後</dt><dd className="font-bold text-ink">{balanceAfter.toLocaleString('ja-JP')} mile</dd></div>
              </dl>
              <dl className="grid gap-2 rounded-control bg-canvas-sunken p-4 text-sm">
                <div className="grid grid-cols-3 gap-3"><dt className="text-ink-faint">理由区分</dt><dd className="col-span-2 text-ink">{reasonLabel}</dd></div>
                <div className="grid grid-cols-3 gap-3"><dt className="text-ink-faint">詳しい理由</dt><dd className="col-span-2 whitespace-pre-wrap text-ink">{reason.trim()}</dd></div>
                <div className="grid grid-cols-3 gap-3"><dt className="text-ink-faint">調整元ID</dt><dd className="col-span-2 break-all text-ink">{sourceReferenceId.trim() || '入力なし'}</dd></div>
              </dl>
              <div className="rounded-control bg-warning-bg p-3 text-xs leading-5 text-warning">
                既存の履歴は書き換えず、理由と実行者を持つ新しい調整行を追加します。同じ操作を再送しても二重反映しません。
              </div>
            </section>
          )}
        </div>
      </Dialog>
  )
}
