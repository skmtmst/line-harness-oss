'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Landmark, TriangleAlert, X } from 'lucide-react'
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
  const [issueStatement, setIssueStatement] = useState(false)
  const [statementKey, setStatementKey] = useState('')

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
    setStatementKey(crypto.randomUUID())
    setIssueStatement(true)
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
      if (issueStatement) {
        try {
          const statement = await api.affiliates.createStatement({
            lineAccountId: accountId,
            settlementId: response.data.settlementId,
            affiliateId: target.id,
            expectedVersion: 1,
          }, statementKey)
          if (!statement.success) throw new Error(statement.error)
        } catch {
          onConfirmed()
          setError('支払いは確定しましたが、支払明細とLINE通知を作れませんでした。同じ画面でもう一度お試しください。')
          return
        }
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

  if (!target) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-ink/40 p-4" style={{ zIndex: 90 }} data-design-node="GqFTV">
      <section className="flex w-full flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-2xl" style={{ maxWidth: 800 }} role="dialog" aria-modal="true" aria-labelledby="affiliate-payment-title">
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4.5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-bg text-warning" aria-hidden="true"><Landmark size={20} /></span>
            <div>
              <h2 id="affiliate-payment-title" className="text-lead font-bold text-ink">{title}</h2>
              <p className="mt-0.5 text-xs text-ink-faint">確定すると金額が固定され、振込用のデータに入ります。</p>
            </div>
          </div>
          <button type="button" aria-label="閉じる" className="flex h-8 w-8 items-center justify-center rounded-control text-ink-faint hover:bg-canvas-sunken" onClick={onClose} disabled={busy}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="space-y-3 px-6 py-5">
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
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 rounded-control bg-canvas-sunken p-4 sm:grid-cols-4">
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">確定する額</dt><dd className="text-ink mt-1 text-lg font-bold">{yen(preview.amount)}</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">成果の件数</dt><dd className="text-ink mt-1 text-lg font-bold">{preview.conversionCount.toLocaleString('ja-JP')}件</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">締め日</dt><dd className="text-ink mt-1 text-lg font-bold">{dateLabel(periodTo ?? preview.closeDate)}</dd></div>
            <div className="bg-canvas-sunken rounded-control p-3"><dt className="text-ink-faint text-xs">支払日</dt><dd className="mt-1 text-lg font-bold text-success">{dateLabel(preview.paymentDate)}</dd></div>
          </dl>

          <div className="border-hairline overflow-hidden rounded-control border">
            <table className="w-full text-sm">
              <thead><TableHeadRow><Th>案件</Th><Th align="right">認めた</Th><Th align="right">1件の報酬</Th><Th align="right">小計</Th></TableHeadRow></thead>
              <tbody className="divide-hairline divide-y">
                {preview.breakdown.map((line) => (
                  <tr key={line.offerName}><td className="text-ink px-3 py-2 font-medium">{line.offerName}</td><td className="text-ink-secondary px-3 py-2 text-right">{line.conversions.toLocaleString('ja-JP')}件</td><td className="text-ink-secondary px-3 py-2 text-right">{line.unitReward == null ? '—' : yen(line.unitReward)}</td><td className="text-ink px-3 py-2 text-right font-semibold">{yen(line.subtotal)}</td></tr>
                ))}
                <tr><td className="text-ink-secondary px-3 py-2">（却下した2件は入れていません）</td><td className="text-ink-secondary px-3 py-2 text-right">2件</td><td className="text-ink-secondary px-3 py-2 text-right">—</td><td className="text-ink px-3 py-2 text-right font-semibold">¥0</td></tr>
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 rounded-control border border-hairline bg-canvas-sunken px-4 py-3 text-sm">
            <Landmark size={18} className="shrink-0 text-ink-faint" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">振込先　{settlement?.bankProfileRegistered ? '登録済み' : '登録されていません'}</p>
              <p className="mt-0.5 text-xs text-ink-faint">口座番号は本人だけに表示します。本人の登録内容を使います。</p>
            </div>
            <Button type="button">直す</Button>
          </div>
          <p className="flex items-start gap-2 rounded-control border border-warning bg-warning-bg px-4 py-3 text-xs font-semibold leading-5 text-warning">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            確定したあとに成果を却下しても、この支払いからは外れません。次の未確定期間へマイナス調整として残します。
          </p>
          <div className="space-y-2">
            <label className="flex items-start gap-3 text-xs text-ink-secondary">
              <input type="checkbox" className="sr-only" checked={issueStatement} onChange={(event) => setIssueStatement(event.target.checked)} />
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border border-accent-deep bg-accent-deep text-on-accent" style={{ borderRadius: 3 }}><Check size={12} /></span>
              <span><strong className="block text-sm text-ink">確定したことを、この方のLINEに知らせる</strong>「{dateLabel(preview.paymentDate)} に {yen(preview.amount)} をお振込みします」と届きます。</span>
            </label>
            <label className="flex items-start gap-3 text-xs text-ink-secondary">
              <input type="checkbox" className="sr-only" checked={issueStatement} onChange={(event) => setIssueStatement(event.target.checked)} />
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border border-accent-deep bg-accent-deep text-on-accent" style={{ borderRadius: 3 }}><Check size={12} /></span>
              <span><strong className="block text-sm text-ink">支払明細のPDFを作る</strong>内訳が入った明細を作ります。メールでも送れます。</span>
            </label>
          </div>
        </div>
      ) : null}
        </div>
        {error ? <p className="mx-6 mb-3 rounded-control bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">{error}</p> : null}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-4">
          <p className="min-w-0 flex-1 text-xs text-ink-faint">振込そのものはここでは行いません。振込用CSVを書き出して銀行で処理してください。</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" onClick={onClose} disabled={busy} className="gap-1.5"><X size={15} />やめる</Button>
            {phase === 'ready' && preview ? (
              <Button type="button" variant="primary" disabled={busy} onClick={() => { void confirmPayment() }} className="gap-1.5">
                <Check size={15} />{busy ? '処理中…' : `${yen(preview.amount)} で確定する`}
              </Button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  )
}
