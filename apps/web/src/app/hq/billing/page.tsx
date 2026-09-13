'use client'

import { Check, CreditCard, Info } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import { api, ApiError } from '@/lib/api'
import { shortDateTime } from '@/lib/hq-banners'
import {
  INVOICE_STATUS_LABELS,
  billingBanner,
  yen,
  type BillingInvoice,
  type BillingPlanView,
  type BillingSummary,
} from '@/lib/hq-billing'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 課金プラン。★V6 36-2（`q7FP5k`）。
 *
 * 契約状況の帯 → プラン 3 枚 → 注記 → 支払い履歴。
 * 申込は Stripe Checkout（別画面）へ、支払い方法・解約は Stripe のポータルへ。
 * 金額は Stripe の価格が取れればそれを出し、取れなければ仮の表示（`priceFromStripe`）。
 */
export default function HqBillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  )
}

function BillingInner() {
  usePageTitle('課金プラン')
  const params = useSearchParams()
  const checkoutResult = params.get('checkout')

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null)
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [summaryRes, invoiceRes] = await Promise.all([api.hqBilling.summary(), api.hqBilling.invoices().catch(() => null)])
      if (!summaryRes.success) throw new Error(summaryRes.error)
      setSummary(summaryRes.data)
      setInvoices(invoiceRes?.success ? invoiceRes.data : [])
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
    try {
      setRole(localStorage.getItem('lh_staff_role') ?? '')
    } catch {
      // ストレージが使えなくても画面は出せる
    }
  }, [load])

  // Checkout から戻った直後は Webhook がまだ届いていないことがある。少し待って読み直す。
  useEffect(() => {
    if (checkoutResult !== 'success') return
    const timer = setTimeout(() => void load(), 4000)
    return () => clearTimeout(timer)
  }, [checkoutResult, load])

  const checkout = async (plan: BillingPlanView) => {
    setBusy(plan.key)
    setError('')
    try {
      const res = await api.hqBilling.checkout(plan.key)
      if (!res.success) throw new Error(res.error)
      window.location.href = res.data.url
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '申込画面へ進めませんでした。もう一度お試しください。')
      setBusy(null)
    }
  }

  const portal = async () => {
    setBusy('portal')
    setError('')
    try {
      const res = await api.hqBilling.portal()
      if (!res.success) throw new Error(res.error)
      window.location.href = res.data.url
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '支払い方法の管理画面へ進めませんでした。')
      setBusy(null)
    }
  }

  if (status === 'loading') return <ListState kind="loading" title="契約状況を読み込んでいます" />
  // 担当者は見られない（権限表: 課金プランは担当者 不可。閲覧のみは閲覧できる）。
  if (status === 'forbidden' || role === 'staff') return <ListState kind="forbidden" />
  if (status === 'error' || !summary) {
    return <ListState kind="error" title="契約状況を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
  }

  const banner = billingBanner(summary)
  const isOwner = role === 'owner'
  const canChoose = isOwner && summary.state !== 'exempt' && summary.state !== 'active' && summary.state !== 'past_due'

  return (
    <div data-design-node="q7FP5k" className="flex flex-col gap-4">
      {checkoutResult === 'success' ? (
        <div className="rounded-card bg-accent-soft px-4 py-3 text-label text-ink" role="status">
          お申し込みを受け付けました。決済の確認が済むと「契約中」に変わります（数秒〜1分ほどかかります）。
        </div>
      ) : null}
      {checkoutResult === 'cancel' ? (
        <div className="rounded-card bg-shell px-4 py-3 text-label text-ink-secondary" role="status">
          お申し込みを中止しました。プランはいつでも選び直せます。
        </div>
      ) : null}

      <div data-design-node="G8n7TD">
        <NoteBar
          tone={banner.tone}
          action={
            summary.portalAvailable ? (
              <Button onClick={() => void portal()} disabled={busy !== null}>
                <CreditCard aria-hidden="true" className="h-4 w-4" />
                {busy === 'portal' ? '開いています…' : '支払い方法を管理'}
              </Button>
            ) : undefined
          }
        >
          <span className="font-bold text-ink">{banner.title}</span>
          <span className="block text-caption text-ink-secondary">{banner.body}</span>
        </NoteBar>
      </div>

      {error ? <p className="text-label text-status-danger" role="alert">{error}</p> : null}

      <div data-design-node="na3K3" className="grid gap-4 md:grid-cols-3">
        {summary.plans.map((plan) => (
          <section
            key={plan.key}
            className={
              plan.recommended
                ? 'flex flex-col gap-4 rounded-card border-2 border-accent bg-canvas p-5'
                : 'flex flex-col gap-4 rounded-card border border-hairline bg-canvas p-5'
            }
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h2 className="text-heading font-bold text-ink">{plan.name}</h2>
                {plan.recommended ? (
                  <span className="inline-flex h-5 items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep">おすすめ</span>
                ) : null}
                {plan.current ? (
                  <span className="inline-flex h-5 items-center rounded-pill bg-status-info-soft px-2 text-nano font-bold text-status-info">利用中</span>
                ) : null}
              </div>
              <p className="text-caption text-ink-faint">{plan.description}</p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-display font-bold text-ink">{yen(plan.monthlyYen)}</span>
              <span className="text-caption text-ink-faint">/月（税込{plan.priceFromStripe ? '' : '・仮'}）</span>
            </div>
            <div className="border-t border-hairline" />
            <ul className="flex flex-1 flex-col gap-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-label text-ink">
                  <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent-deep" />
                  {feature}
                </li>
              ))}
            </ul>
            {plan.cta === 'contact' ? (
              <Button href="/hq/support" className="w-full">相談する</Button>
            ) : plan.current ? (
              <Button onClick={() => void portal()} disabled={busy !== null || !summary.portalAvailable} className="w-full">
                変更する
              </Button>
            ) : (
              <Button
                variant={plan.recommended ? 'primary' : 'secondary'}
                onClick={() => void checkout(plan)}
                disabled={busy !== null || !canChoose || !plan.available}
                className="w-full"
              >
                {busy === plan.key ? '申込画面へ移動中…' : 'このプランにする'}
              </Button>
            )}
          </section>
        ))}
      </div>

      <p data-design-node="Fopep" className="flex items-center gap-1.5 text-caption text-ink-faint">
        <Info aria-hidden="true" className="h-3.5 w-3.5" />
        {!summary.stripeReady
          ? '決済の接続設定がまだのため、申込ボタンは押せません。料金と内容は仮置きです。'
          : !isOwner
            ? 'プランの申込と変更はオーナーだけができます。料金と内容は仮置きです。'
            : '料金と内容は仮置きです。決済は Stripe で行い、請求書と領収書は支払い方法の管理画面から取得できます。'}
      </p>

      <section data-design-node="UhUtX" className="flex flex-col rounded-card border border-hairline bg-canvas">
        <h2 className="px-4 py-3 text-body font-bold text-ink">支払い履歴</h2>
        <div className="border-t border-hairline" />
        {invoices === null || invoices.length === 0 ? (
          <p className="px-4 py-5 text-caption text-ink-faint">まだ支払いはありません。プランを選ぶと、ここに請求と支払いの記録が並びます。</p>
        ) : (
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th className="w-40">日付</Th>
                <Th>内容</Th>
                <Th className="w-32" align="right">金額</Th>
                <Th className="w-28">状態</Th>
                <Th className="w-32" align="right">領収書</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <Tr key={inv.id}>
                  <Td><span className="text-label text-ink">{shortDateTime(inv.createdAt)}</span></Td>
                  <Td><span className="text-label text-ink">{inv.description ?? inv.number ?? '—'}</span></Td>
                  <Td align="right"><span className="text-label font-semibold text-ink">{yen(inv.amountYen)}</span></Td>
                  <Td><span className="text-label text-ink-secondary">{INVOICE_STATUS_LABELS[inv.status ?? ''] ?? inv.status ?? '—'}</span></Td>
                  <Td align="right">
                    {inv.hostedUrl ? (
                      <a href={inv.hostedUrl} target="_blank" rel="noreferrer" className="text-label font-semibold text-accent-deep hover:underline">
                        開く
                      </a>
                    ) : (
                      <span className="text-label text-ink-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  )
}
