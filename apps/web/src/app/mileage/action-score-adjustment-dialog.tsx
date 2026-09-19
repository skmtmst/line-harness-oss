'use client'

import { useEffect, useRef, useState } from 'react'
import { ChoiceCard } from '@/components/shared/create-page'
import Dialog from '@/components/shared/dialog'
import { Field, TextArea, TextInput } from '@/components/shared/form-controls'
import { ApiError, api } from '@/lib/api'

type Direction = 'increase' | 'decrease'

/*
 * 失敗の理由を、そのまま出してよいものだけ通す。
 * `ApiError.message` は 400 以外だと `API error: <番号>` に落ちるため、
 * 番号ごとに日本語へ置き換える（`score-rules/page.tsx` の fieldError と同じ形）。
 */
export function actionScoreAdjustmentErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.message
    if (error.status === 403) return '点数を変更する権限がありません。'
    if (error.status === 404) return '対象の友だちまたはLINEアカウントを確認できませんでした。'
    if (error.status === 405) return 'この環境では点数を変更できません。'
    if (error.status === 409) return '同じ操作がすでに記録されています。画面を読み直してからやり直してください。'
    if (error.status === 422) return '点数は帯の下限〜上限の範囲でしか動かせません。点数を変えてやり直してください。'
    if (error.status === 428) return '確認手順が完了していません。画面を閉じずに、もう一度内容を確認してください。'
    return '点数を変更できませんでした。時間をおいてもう一度お試しください。'
  }
  return error instanceof Error ? '通信に失敗しました。接続を確認してもう一度お試しください。' : '通信に失敗しました。'
}

/*
 * N-235: 行動スコアの手動調整。
 * マイルの手動調整（`friends/detail/mileage-adjustment-dialog.tsx`）と同じ約束：
 * 理由必須・追記だけ・再送しても二重反映しない・確認段を挟む。
 * スコアはお客様に見せないので、通知や有効期限の欄は置かない。
 */
export default function ActionScoreAdjustmentDialog({
  open,
  accountId,
  friendId,
  friendName,
  currentScore,
  onCancel,
  onCompleted,
}: {
  open: boolean
  accountId: string
  friendId: string
  friendName: string
  currentScore: number
  onCancel: () => void
  onCompleted: () => Promise<void>
}) {
  const [direction, setDirection] = useState<Direction>('increase')
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [step, setStep] = useState<'input' | 'confirm'>('input')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef('')
  const amount = Number(amountText)
  const delta = direction === 'decrease' ? -amount : amount
  const scoreAfter = currentScore + (Number.isInteger(amount) && amount > 0 ? delta : 0)

  useEffect(() => {
    if (!open) return
    setDirection('increase')
    setAmountText('')
    setReason('')
    setStep('input')
    setError('')
    setBusy(false)
    // 開くたびに新しいキー。同じ操作を再送しても二重反映しないための札。
    idempotencyKey.current = crypto.randomUUID()
  }, [open])

  const inputError = (() => {
    if (!Number.isInteger(amount) || amount <= 0) return '1以上の整数で点数を入力してください'
    if (amount > 1_000_000) return '点数が大きすぎます'
    if (!reason.trim()) return '理由を入力してください'
    if (reason.trim().length > 500) return '理由は500文字以内で入力してください'
    return null
  })()

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
      const response = await api.actionScores.adjust(
        { accountId, friendId, direction, amount, reason: reason.trim() },
        idempotencyKey.current,
      )
      if (!response.success) throw new Error(response.error)
      await onCompleted()
      onCancel()
    } catch (caught) {
      setError(actionScoreAdjustmentErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="点数を手で直す"
      description="記録に残ります。お客様には見えない運用メモとして、あとから理由をたどれるようにしてください。"
      busy={busy}
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
          <p className="text-xs font-semibold text-ink-faint">だれの点数を動かしますか</p>
          <p className="mt-2 font-bold text-ink">{friendName}</p>
          <p className="mt-1 text-sm text-ink-secondary">いまの点数 {currentScore.toLocaleString('ja-JP')} 点</p>
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
                  note={value === 'increase' ? '点数に足します' : '点数から引きます'}
                />
              ))}
            </div>
            <Field label="点数" htmlFor="score-adjustment-amount" required>
              <TextInput
                id="score-adjustment-amount"
                inputMode="numeric"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </Field>
            <Field label="理由" htmlFor="score-adjustment-reason" required note="履歴に残り、あとから実行者と一緒に確認できます。">
              <TextArea id="score-adjustment-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <p className="rounded-control bg-info-bg p-3 text-xs leading-5 text-ink-secondary">
              点数は、設定された帯の下限〜上限の範囲でしか動かせません。範囲をまたぐ変更は実行されません。
            </p>
          </>
        ) : (
          <section aria-label="変更内容の確認" className="space-y-3">
            <h3 className="text-sm font-bold text-ink">この変更で起きること</h3>
            <dl className="overflow-hidden rounded-panel border border-hairline text-sm">
              <div className="flex justify-between border-b border-hairline px-4 py-3"><dt className="text-ink-faint">変更前</dt><dd className="font-semibold text-ink">{currentScore.toLocaleString('ja-JP')} 点</dd></div>
              <div className="flex justify-between border-b border-hairline px-4 py-3"><dt className="text-ink-faint">変更量</dt><dd className={delta < 0 ? 'font-bold text-danger' : 'font-bold text-accent'}>{delta > 0 ? '+' : ''}{delta.toLocaleString('ja-JP')} 点</dd></div>
              <div className="flex justify-between px-4 py-3"><dt className="text-ink-faint">変更後</dt><dd className="font-bold text-ink">{scoreAfter.toLocaleString('ja-JP')} 点</dd></div>
            </dl>
            <dl className="grid gap-2 rounded-control bg-canvas-sunken p-4 text-sm">
              <div className="grid grid-cols-3 gap-3"><dt className="text-ink-faint">理由</dt><dd className="col-span-2 whitespace-pre-wrap text-ink">{reason.trim()}</dd></div>
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
