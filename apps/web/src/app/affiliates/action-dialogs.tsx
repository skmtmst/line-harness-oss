'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  api,
  type AffiliateAccountSettlementPreview,
  type AffiliateArchiveImpact,
  type AffiliateSettlementPreview,
} from '@/lib/api'

type LoadPhase = 'loading' | 'ready' | 'empty' | 'error'

function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

function dateLabel(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

export function AffiliateArchiveDialog({
  target,
  onClose,
  onChanged,
}: {
  target: { id: string; name: string } | null
  onClose: () => void
  onChanged: () => void
}) {
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [impact, setImpact] = useState<AffiliateArchiveImpact | null>(null)
  const [choice, setChoice] = useState<'pause' | 'pay_first' | 'archive'>('pause')
  const [confirmationName, setConfirmationName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!target) return
    setPhase('loading')
    setImpact(null)
    setError('')
    try {
      const response = await api.affiliates.archiveImpact(target.id)
      if (!response.success) throw new Error(response.error)
      setImpact(response.data)
      setPhase('ready')
    } catch {
      setPhase('error')
    }
  }, [target])

  useEffect(() => {
    if (!target) return
    setChoice('pause')
    setConfirmationName('')
    void load()
  }, [load, target])

  const apply = async () => {
    if (!target || choice === 'pay_first') return
    setBusy(true)
    setError('')
    try {
      const response = await api.affiliates.archive(target.id, {
        mode: choice,
        confirmationName: choice === 'archive' ? confirmationName : undefined,
      })
      if (!response.success) {
        setError(response.error)
        return
      }
      onChanged()
      onClose()
    } catch {
      setError('紹介を止められませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const archiveDisabled = choice === 'archive' && confirmationName !== target?.name

  return (
    <Dialog
      open={Boolean(target)}
      designNode="QX70l"
      title={`「${target?.name ?? ''}」をアーカイブしますか？`}
      description="いま使われている場所を確認してから、紹介だけを止めるか、一覧からアーカイブするかを選びます。"
      busy={busy}
      error={error}
      onCancel={onClose}
      footer={(
        <div className="border-hairline flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
          {choice === 'pay_first' ? (
            <Button type="button" variant="primary" href="/conversions?tab=payment">
              支払いの画面へ
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={busy || phase !== 'ready' || archiveDisabled}
              onClick={() => { void apply() }}
            >
              {busy ? '処理中…' : choice === 'pause' ? '紹介を止める' : 'アーカイブする'}
            </Button>
          )}
        </div>
      )}
    >
      {phase === 'loading' ? (
        <ListState kind="loading" title="使われている場所を確認しています" />
      ) : phase === 'error' ? (
        <ListState
          kind="error"
          title="使われている場所を確認できませんでした"
          description="件数を0とは扱いません。読み直してから選んでください。"
          action={<Button onClick={() => { void load() }}>再読み込み</Button>}
        />
      ) : impact ? (
        <div className="space-y-4">
          <section className="rounded-control border border-warning bg-warning-bg p-4">
            <h3 className="text-warning text-sm font-bold">アーカイブすると、次の3つが変わります</h3>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-ink-faint text-xs">発行ずみの紹介リンク</dt><dd className="text-ink mt-1 font-bold">{impact.activeLinks.toLocaleString('ja-JP')}本</dd></div>
              <div><dt className="text-ink-faint text-xs">支払いを確定していない報酬</dt><dd className="text-ink mt-1 font-bold">{yen(impact.unsettledReward)}</dd></div>
              <div><dt className="text-ink-faint text-xs">認めるのを待っている成果</dt><dd className="text-ink mt-1 font-bold">{impact.pendingConversions.toLocaleString('ja-JP')}件</dd></div>
            </dl>
            <p className="text-warning mt-3 text-xs leading-5">
              紹介リンクは開けなくなります。過去の成果・報酬・支払いの記録は消えません。
            </p>
          </section>

          <fieldset className="space-y-2">
            <legend className="text-ink mb-2 text-sm font-bold">どうしますか？</legend>
            {([
              ['pause', '紹介だけを止める（おすすめ）', 'あとから再開できます。過去の記録は残ります。'],
              ['pay_first', `先に ${yen(impact.unsettledReward)} を確定してから、また考える`, '支払いの画面へ移ります。アーカイブはしません。'],
              ['archive', 'このままアーカイブする', '管理一覧から外します。過去の記録は残ります。'],
            ] as const).map(([value, label, description]) => (
              <label key={value} className={`block cursor-pointer rounded-control border p-3 ${choice === value ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'}`}>
                <span className="flex gap-3">
                  <input type="radio" name="archive-choice" value={value} checked={choice === value} onChange={() => setChoice(value)} />
                  <span><span className="text-ink block text-sm font-semibold">{label}</span><span className="text-ink-faint mt-0.5 block text-xs">{description}</span></span>
                </span>
              </label>
            ))}
          </fieldset>

          {choice === 'archive' ? (
            <label className="text-ink block text-sm font-semibold">
              確認のため「{target?.name}」と打ってください
              <input
                type="text"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                className="border-hairline rounded-control mt-2 w-full border px-3 py-2 font-normal"
                autoComplete="off"
              />
            </label>
          ) : null}
        </div>
      ) : (
        <ListState kind="empty" title="確認できる情報がありません" />
      )}
    </Dialog>
  )
}

export function AffiliatePaymentConfirmDialog({
  target,
  accountId,
  settlement,
  periodTo,
  onClose,
  onConfirmed,
}: {
  target: { id: string; name: string } | null
  accountId: string
  settlement: AffiliateAccountSettlementPreview['affiliates'][number] | null
  periodTo: string | null
  onClose: () => void
  onConfirmed: () => void
}) {
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [preview, setPreview] = useState<AffiliateSettlementPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const load = useCallback(async () => {
    if (!target) return
    setPhase('loading')
    setPreview(null)
    setError('')
    try {
      const response = await api.affiliates.paymentPreview(target.id, accountId)
      if (!response.success) throw new Error(response.error)
      setPreview(response.data)
      setPhase(response.data.conversionCount === 0 ? 'empty' : 'ready')
    } catch {
      setPhase('error')
    }
  }, [accountId, target])

  useEffect(() => {
    if (!target) return
    setIdempotencyKey(crypto.randomUUID())
    void load()
  }, [load, target])

  const confirmPayment = async () => {
    if (!target || !preview || phase !== 'ready') return
    setBusy(true)
    setError('')
    try {
      const response = await api.affiliates.confirmPayment(target.id, {
        lineAccountId: accountId,
        expectedAmount: preview.amount,
        idempotencyKey,
      })
      if (!response.success) {
        setError(response.error)
        return
      }
      onConfirmed()
      onClose()
    } catch {
      setError('支払いを確定できませんでした。内容を読み直してください。')
    } finally {
      setBusy(false)
    }
  }

  const title = useMemo(
    () => `${target?.name ?? ''} への支払いを確定しますか？`,
    [target],
  )

  return (
    <Dialog
      open={Boolean(target)}
      designNode="GqFTV"
      title={title}
      description="確定すると金額が固定され、締めたあとの成果取消は次の支払いで差し引きます。"
      busy={busy}
      error={error}
      onCancel={onClose}
      footer={(
        <div className="border-hairline flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <Button type="button" onClick={onClose} disabled={busy}>やめる</Button>
          {phase === 'ready' && preview ? (
            <Button type="button" variant="primary" disabled={busy} onClick={() => { void confirmPayment() }}>
              {busy ? '処理中…' : `${yen(preview.amount)} で確定する`}
            </Button>
          ) : null}
        </div>
      )}
    >
      {phase === 'loading' ? (
        <ListState kind="loading" title="確定する内容を読み込んでいます" />
      ) : phase === 'error' ? (
        <ListState
          kind="error"
          title="確定する内容を表示できませんでした"
          description="金額を0とは扱いません。読み直してから確定してください。"
          action={<Button onClick={() => { void load() }}>再読み込み</Button>}
        />
      ) : phase === 'empty' ? (
        <ListState
          kind="empty"
          title="確定できる報酬はありません"
          description="保留期間を過ぎた承認済み成果があると、ここに内訳が表示されます。"
        />
      ) : preview ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">確定する額</dt><dd className="text-ink mt-1 text-lg font-bold">{yen(preview.amount)}</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">成果の件数</dt><dd className="text-ink mt-1 text-lg font-bold">{preview.conversionCount.toLocaleString('ja-JP')}件</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">締め日</dt><dd className="text-ink mt-1 text-lg font-bold">{dateLabel(periodTo ?? preview.closeDate)}</dd><p className="text-ink-faint mt-1 text-xs">今回の締め期間</p></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">支払日</dt><dd className="text-ink mt-1 text-lg font-bold">{dateLabel(preview.paymentDate)}</dd><p className="text-ink-faint mt-1 text-xs">設定は未接続</p></div>
          </dl>

          <div className="border-hairline overflow-hidden rounded-control border">
            <table className="w-full text-sm">
              <thead><TableHeadRow><Th>案件</Th><Th align="right">認めた</Th><Th align="right">1件の報酬</Th><Th align="right">小計</Th></TableHeadRow></thead>
              <tbody className="divide-hairline divide-y">
                {preview.breakdown.map((line) => (
                  <tr key={line.offerName}><td className="text-ink px-3 py-2 font-medium">{line.offerName}</td><td className="text-ink-secondary px-3 py-2 text-right">{line.conversions.toLocaleString('ja-JP')}件</td><td className="text-ink-secondary px-3 py-2 text-right">{line.unitReward == null ? '—' : yen(line.unitReward)}</td><td className="text-ink px-3 py-2 text-right font-semibold">{yen(line.subtotal)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-control border border-info bg-info-bg p-3 text-sm text-info">
            <p className="font-semibold">振込先　{settlement?.bankProfileRegistered ? '登録済み' : '登録されていません'}</p>
            <p className="mt-1 text-xs">口座番号は本人だけに表示します。振込そのものはここでは行いません。</p>
          </div>
          <p className="text-ink-secondary text-xs leading-5">
            確定したあとに成果を却下しても、この支払いからは外れません。次の未確定期間へマイナス調整として残します。
          </p>
          <p className="text-ink-secondary text-xs">期間を締めたあとに支払明細を発行すると、PDFを作り、この方のLINEへ通知します。</p>
        </div>
      ) : null}
    </Dialog>
  )
}
