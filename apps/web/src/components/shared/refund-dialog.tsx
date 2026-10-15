'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Info, RotateCcw } from 'lucide-react'
import Dialog, { DialogSteps } from './dialog'
import { Field } from './form-controls'
import NumberInput from './number-field'
import Radio from './radio'
import Checkbox from './checkbox'
import { TextField } from './text-field'
import Notice from './notice'
import { TestModeBadge } from './payment-badges'
import styles from './refund-dialog.module.css'

/*
 * 返金の確かめの窓（★V8 PpBzn＝手順 1/2・v6mT4f＝手順 2/2、B-338）。どの画面の返金もこれを使う
 * （予約設定 › お支払いの記録・飲食の返金 Y8MWGs など）。画面ごとに手で書かない。
 * 手順 1：返金する額（全額／一部）・理由（必須・記録に残る）・LINE で知らせるか。
 * 手順 2：返金する額・返金先・返金のあと・理由・記録の確かめと、お客さまに送る LINE の文。
 * 送るのは onSubmit（呼び出し側が口を呼ぶ）。返金は取り消せないので、押す所は赤。
 */

export type RefundInput = { amount: number; partial: boolean; reason: string; notifyCustomer: boolean }

const yen = (value: number) => `¥${Math.round(value).toLocaleString('ja-JP')}`

export default function RefundDialog({ open, customerName, bookingLabel, paidAmount, refundedAmount = 0, methodLabel = 'カード', destinationLabel, cancelRule, testMode = false, actorLabel, onSubmit, onClose }: {
  open: boolean
  customerName: string
  bookingLabel: string
  paidAmount: number
  /** これまでに返金した額。 */
  refundedAmount?: number
  methodLabel?: string
  /** 返金先（例「カード（•••• 4242）」）。分からなければ methodLabel。 */
  destinationLabel?: string | null
  /** キャンセルの決まり（例「前日 18:00 までは全額。過ぎたら返金なし」）。分からなければ出さない。 */
  cancelRule?: string | null
  testMode?: boolean
  /** 記録に残る名前（例「河野 健太（オーナー）」）。 */
  actorLabel?: string | null
  onSubmit: (input: RefundInput) => Promise<void>
  onClose: () => void
}) {
  const refundable = Math.max(0, paidAmount - refundedAmount)
  const [step, setStep] = useState<1 | 2>(1)
  const [partial, setPartial] = useState(false)
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep(1); setPartial(false); setAmountText(''); setReason(''); setNotify(true); setSubmitted(false); setError(null)
  }, [open])

  const amount = partial ? Number(amountText) : refundable
  const amountValid = Number.isInteger(amount) && amount >= 1 && amount <= refundable
  const valid = amountValid && reason.trim() !== ''
  const rest = refundable - (amountValid ? amount : 0)
  const subtitle = `${customerName}さま・${bookingLabel}`
  const steps = <DialogSteps steps={[
    { label: '金額と理由', done: step === 2, current: step === 1, onSelect: step === 2 && !busy ? () => setStep(1) : undefined },
    { label: '確かめ', current: step === 2 },
  ]} />

  async function confirm() {
    setBusy(true); setError(null)
    try {
      await onSubmit({ amount, partial, reason: reason.trim(), notifyCustomer: notify })
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '返金できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  if (step === 1) {
    return (
      <Dialog open={open} title="返金する" titleNote={subtitle} steps={steps} stepKey={1} size="medium"
        footerLead={<span className={styles.lead}>手順 1 / 2</span>}
        cancelLabel="キャンセル" onCancel={onClose}
        confirmLabel="次へ" confirmIcon={<ArrowRight size={15} aria-hidden="true" />}
        onConfirm={() => { setSubmitted(true); if (valid) setStep(2) }}>
        <div className={styles.body}>
          <dl className={styles.summary}>
            <div className={styles.row}><dt>支払った額</dt><dd>{`${yen(paidAmount)}（${methodLabel}）`}</dd></div>
            <div className={styles.row}><dt>これまでの返金</dt><dd>{refundedAmount > 0 ? yen(refundedAmount) : 'なし'}</dd></div>
            {cancelRule ? <div className={styles.row}><dt>キャンセルの決まり</dt><dd>{cancelRule}</dd></div> : null}
            {testMode ? <div className={styles.testRow}><TestModeBadge /><span>本当の返金は起きません</span></div> : null}
          </dl>
          <fieldset className={styles.amount}>
            <legend className={styles.label}>返金する額</legend>
            <div className={styles.choices}>
              <Radio name="refund-amount" value="full" checked={!partial} onChange={() => setPartial(false)}>{`全額（${yen(refundable)}）`}</Radio>
              <Radio name="refund-amount" value="partial" checked={partial} onChange={() => setPartial(true)}>一部を返金する</Radio>
            </div>
            {partial ? (
              <NumberInput aria-label="返金する額" unit="円" type="number" min={1} max={refundable} value={amountText}
                aria-invalid={submitted && !amountValid} onChange={(event) => setAmountText(event.target.value)} />
            ) : null}
            <p className={submitted && !amountValid ? styles.error : styles.hint}>
              {submitted && !amountValid ? `1 円から ${yen(refundable)} までで入れてください。` : `${yen(refundable)} まで。${partial && amountValid ? `残りの ${yen(rest)} は支払い済みのまま残ります。` : ''}`}
            </p>
          </fieldset>
          <Field label="返金の理由" required htmlFor="refund-reason" error={submitted && !reason.trim() ? '理由を入れてください（記録に残ります）' : undefined}>
            <TextField id="refund-reason" value={reason} maxLength={500} placeholder="例：日程が合わなくなった（お客さまから電話）" onChange={(event) => setReason(event.target.value)} />
          </Field>
          <p className={styles.hint}>理由は記録に残ります（だれが・いつ・理由）。お客さまには出ません。</p>
          <Checkbox checked={notify} onCheckedChange={setNotify}>LINE でお客さまに返金を知らせる</Checkbox>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} title={`${yen(amount)} を返金しますか？`} titleNote={subtitle} steps={steps} stepKey={2} size="medium"
      footerLead={<span className={styles.lead}>手順 2 / 2</span>}
      cancelLabel="戻る" onCancel={() => { if (!busy) setStep(1) }}
      confirmLabel={`${yen(amount)} を返金する`} confirmIcon={<RotateCcw size={15} aria-hidden="true" />} tone="destructive"
      busy={busy} error={error ?? undefined} onConfirm={() => void confirm()}>
      <div className={styles.body}>
        <dl className={styles.summary}>
          <div className={styles.row}><dt>返金する額</dt><dd>{`${yen(amount)}（${partial ? '一部' : '全額'}）`}</dd></div>
          <div className={styles.row}><dt>返金先</dt><dd>{destinationLabel ?? methodLabel}</dd></div>
          <div className={styles.row}><dt>返金のあと</dt><dd>{rest > 0 ? `支払い済み ${yen(rest)} が残ります` : '返金済みになります'}</dd></div>
          <div className={styles.row}><dt>理由</dt><dd>{reason.trim()}</dd></div>
          {actorLabel ? <div className={styles.row}><dt>記録</dt><dd>{`${actorLabel} として残ります`}</dd></div> : null}
          {testMode ? <div className={styles.testRow}><TestModeBadge /><span>本当の返金は起きません</span></div> : null}
        </dl>
        {notify ? (
          <div className={styles.lineBlock}>
            <p className={styles.label}>お客さまに送る LINE</p>
            <p className={styles.linePreview}>{`${customerName}さま　${bookingLabel}のご予約のお支払いのうち ${yen(amount)} を返金しました。${methodLabel === 'カード' ? 'カードへの反映は数日かかることがあります。' : ''}`}</p>
          </div>
        ) : null}
        <Notice tone="info" icon={<Info size={16} aria-hidden="true" />}>返金は取り消せません。カードへの反映は 5〜10 日かかります。</Notice>
      </div>
    </Dialog>
  )
}
