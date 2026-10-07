'use client'

import HqSettingsNav from '@/app/hq/hq-settings-nav-v8'
import ReadonlyHeader from '@/app/hq/readonly-header-v8'
import '@/app/hq/readonly-v8.css'
import { Check, CreditCard, Download, Info } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SegmentedControl from '@/components/shared/segmented'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { usePageTitle } from '@/components/shell/page-chrome'
import { api, ApiError } from '@/lib/api'
import { shortDateTime } from '@/lib/hq-banners'
import { billingFailureMessage } from './failure-message'
import {
  INVOICE_STATUS_LABELS,
  billingBanner,
  billingPlanPrice,
  billingPriceNote,
  yen,
  type BillingInvoice,
  type BillingInterval,
  type BillingPlanView,
  type BillingSummary,
} from '@/lib/hq-billing'
import './hq-billing-v8.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import HqBillingV8 from '@/v8/hq/billing'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 請求。板 JB8V1（V8 のみ）。
 *
 * 左に「統括の設定」の中のメニュー、右に契約の帯 → 周期の切り替え →
 * プラン 3 枚 → 注記 → 支払い履歴。
 * 申込は Stripe Checkout（別画面）へ、支払い方法・解約は Stripe のポータルへ。
 * 金額は Stripe の価格が取れればそれを出し、取れなければ仮の表示（`priceFromStripe`）。
 */
export default function HqBillingPage() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <HqBillingV8 /> : <HqBillingPageV7 />
}

function HqBillingPageV7() {
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  )
}

function invoiceTone(status: BillingInvoice['status']): 'info' | 'ok' | 'neutral' {
  if (status === 'paid') return 'ok'
  if (status === 'open' || status === 'draft') return 'info'
  return 'neutral'
}

function BillingInner() {
  usePageTitle('課金プラン')
  const params = useSearchParams()
  const checkoutResult = params.get('checkout')

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null)
  /*
   * R118: 履歴だけの取得失敗は概要と分けて持つ。失敗を `[]` に畳むと
   * 「まだ支払いはありません」と出て、記録が無いと誤読される。
   * `null` は読み込み前の初期値なので、失敗は別の旗で見る。
   */
  const [invoiceFailed, setInvoiceFailed] = useState(false)
  // M023：履歴の 502（決済サービス不通）も決済サービスの案内にするための目安。
  const [invoiceError, setInvoiceError] = useState<unknown>(null)
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [interval, setInterval] = useState<BillingInterval>('month')

  const load = useCallback(async () => {
    setStatus('loading')
    setInvoiceFailed(false)
    setInvoiceError(null)
    try {
      const [summaryRes, invoiceRes] = await Promise.all([
        api.hqBilling.summary(),
        // M023：履歴の失敗理由を残す（502 は決済サービスの案内にする）。
        api.hqBilling.invoices().catch((caught: unknown) => {
          setInvoiceError(caught)
          return null
        }),
      ])
      if (!summaryRes.success) throw new Error(summaryRes.error)
      setSummary(summaryRes.data)
      // R118: 履歴の失敗は空配列にしない。概要は出して履歴欄だけ失敗表示にする。
      setInvoices(invoiceRes?.success ? invoiceRes.data : null)
      setInvoiceFailed(!invoiceRes?.success)
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

  const checkout = async (plan: BillingPlanView, selectedInterval: BillingInterval) => {
    setBusy(plan.key)
    setError('')
    try {
      const res = await api.hqBilling.checkout(plan.key, selectedInterval)
      if (!res.success) throw new Error(res.error)
      window.location.href = res.data.url
    } catch (caught) {
      // M023/M024：原文のまま出さず、共通の案内へ渡す（502 は決済サービスの案内）。
      setError(billingFailureMessage(caught, '申込画面の表示', 'プランの申込はオーナーだけができます。オーナーの方に操作してもらってください。'))
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
      // M023/M024：原文のまま出さず、共通の案内へ渡す（502 は決済サービスの案内）。
      setError(billingFailureMessage(caught, '支払い方法の管理画面の表示', '支払い方法の管理はオーナーか管理者だけができます。オーナーか管理者の方に操作してもらってください。'))
      setBusy(null)
    }
  }

  // M023：履歴の 502 は決済サービスの案内にする（それ以外は共通の失敗面のまま）。
  const invoiceUnreachable = invoiceError instanceof ApiError && invoiceError.status === 502

  if (status === 'loading') return <ListState kind="loading" title="契約状況を読み込んでいます" />
  // 担当者は見られない（権限表: 課金プランは担当者 不可。閲覧のみは閲覧できる）。
  if (status === 'forbidden' || role === 'staff') return <ListState kind="forbidden" />
  if (status === 'error' || !summary) {
    return <ListState kind="error" title="契約状況を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
  }

  const banner = billingBanner(summary)
  const isOwner = role === 'owner'
  const canChoose = isOwner && summary.state !== 'exempt' && summary.state !== 'active' && summary.state !== 'past_due'
  const yearlyMins = summary.plans
    .map((plan) => billingPlanPrice(plan, 'year').yearlyYen)
    .filter((yenValue): yenValue is number => yenValue !== null)
  const yearlyMin = yearlyMins.length > 0 ? Math.min(...yearlyMins) : null

  return (
    <div data-design-node="JB8V1" className="flex flex-col gap-4">
      <ReadonlyHeader title="請求" description="プランと支払いの記録です。プランの申込はオーナーだけ、支払い方法の管理はオーナーか管理者ができます。" />
      <div className="hq-billing-v8">
        <HqSettingsNav active="billing" />
        <div className="hq-billing-v8__main">
          {checkoutResult === 'success' ? (
            <Notice tone="info" message="お申し込みを受け付けました。決済の確認が済むと「契約中」に変わります（数秒〜1分ほどかかります）。" />
          ) : null}
          {checkoutResult === 'cancel' ? (
            <Notice tone="info" message="お申し込みを中止しました。プランはいつでも選び直せます。" />
          ) : null}

          {banner.tone === 'info' ? (
            <div data-design="Status" className="hq-billing-v8__contract">
              <ContractText summary={summary} />
            </div>
          ) : (
            <div data-design="Status">
              <Notice tone={banner.tone} message={`${banner.title} ${banner.body}`} />
            </div>
          )}

          <div data-design="Interval" className="hq-billing-v8__interval-row">
            <SegmentedControl<BillingInterval>
              aria-label="支払いの周期"
              value={interval}
              onChange={setInterval}
              options={[
                { value: 'month', label: '月払い' },
                { value: 'year', label: yearlyMin !== null ? `年払い（年 ${yen(yearlyMin)}〜）` : '年払い' },
              ]}
            />
            {summary.portalAvailable ? (
              <Button onClick={() => void portal()} disabled={busy !== null} busy={busy === 'portal'} busyLabel="開いています…">
                <CreditCard aria-hidden="true" className="h-4 w-4" />支払い方法を管理
              </Button>
            ) : null}
          </div>

          {error ? <p className="text-label text-danger" role="alert">{error}</p> : null}

          <div data-design="Plans" className="grid gap-4 md:grid-cols-3">
            {summary.plans.map((plan) => {
              const price = billingPlanPrice(plan, interval)
              return (
              <section
                key={plan.key}
                className={
                  plan.recommended
                    ? 'flex flex-col gap-4 rounded-card border-2 border-accent bg-canvas p-5'
                    : 'flex flex-col gap-4 rounded-card border border-hairline bg-canvas p-5'
                }
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-heading font-bold text-ink">{plan.name}</h2>
                    {plan.recommended ? <Chip tone="ok">おすすめ</Chip> : null}
                    {interval === 'year' ? <Chip tone="ok">約15% OFF</Chip> : null}
                    {plan.current ? <Chip tone="ok">利用中</Chip> : null}
                  </div>
                  <p className="text-caption text-ink-faint">{plan.description}</p>
                </div>
                <div className="flex flex-col gap-2" data-price-source={price.fromStripe ? 'stripe' : 'fallback'}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-hero text-ink">{yen(price.monthlyYen)}</span>
                    <span className="text-caption text-ink-faint">/月（税込）</span>
                  </div>
                  {price.yearlyYen !== null ? <p className="text-caption text-ink-faint">年額 {yen(price.yearlyYen)}（税込）</p> : null}
                  {!price.fromStripe ? <p className="text-caption text-ink-faint">仮の料金です</p> : null}
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
                {plan.current ? (
                  <Button disabled className="w-full">
                    <Check aria-hidden="true" className="h-4 w-4" />いまのプラン
                  </Button>
                ) : (
                  <Button
                    variant={plan.recommended ? 'primary' : 'secondary'}
                    onClick={() => void checkout(plan, interval)}
                    disabled={busy !== null || !canChoose || !price.available}
                    className="w-full" busy={busy === plan.key} busyLabel="申込画面へ移動中…">このプランにする
                  </Button>
                )}
                {!price.available && !plan.current ? <p className="text-caption text-ink-faint">価格がまだ設定されていません</p> : null}
              </section>
              )
            })}
          </div>

          <p data-design="Note" className="flex items-center gap-1.5 text-caption text-ink-faint">
            <Info aria-hidden="true" className="h-3.5 w-3.5" />
            {/* R607：料金の出所は選んだ周期で変わる。料金とプラン内容の確定度は分けて案内する。 */}
            {!summary.stripeReady
              ? `決済の接続設定がまだのため、申込ボタンは押せません。${billingPriceNote(summary.plans, interval)}`
              : !isOwner
                ? `プランの申込と変更はオーナーだけができます。${billingPriceNote(summary.plans, interval)}`
                : `${billingPriceNote(summary.plans, interval)}決済は Stripe で行い、請求書と領収書は支払い方法の管理画面から取得できます。`}
          </p>

          <section data-design="History" className="flex flex-col rounded-card border border-hairline bg-canvas">
            <h2 className="px-4 py-3 text-body font-bold text-ink">支払い履歴</h2>
            <div className="border-t border-hairline" />
            {invoiceFailed ? (
              <div className="px-4 py-5">
                <ListState
                  kind="error"
                  title={invoiceUnreachable ? '決済サービスにつながりませんでした' : '支払い履歴を読み込めませんでした'}
                  description={invoiceUnreachable ? '少し待って、もう一度読み込んでください。' : undefined}
                  error={invoiceError ?? undefined}
                  onRetry={() => void load()}
                />
              </div>
            ) : invoices === null || invoices.length === 0 ? (
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
                      <Td><Chip tone={invoiceTone(inv.status)}>{INVOICE_STATUS_LABELS[inv.status ?? ''] ?? inv.status ?? '—'}</Chip></Td>
                      <Td align="right">
                        {inv.hostedUrl ? (
                          <Button href={inv.hostedUrl} target="_blank" rel="noreferrer" size="compact">
                            <Download aria-hidden="true" className="h-3.5 w-3.5" />領収書
                          </Button>
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
      </div>
    </div>
  )
}

/** 契約の帯（板の灰色の箱）。契約中は絵の文面、ほかは帯の文面をそのまま出す。 */
function ContractText({ summary }: { summary: BillingSummary }) {
  if (summary.state === 'active' && summary.planName) {
    const current = summary.plans.find((plan) => plan.current)
    const basis = summary.planInterval === 'year' ? '年払い' : summary.planInterval === 'month' ? '月払い' : null
    const price = current ? billingPlanPrice(current, summary.planInterval === 'year' ? 'year' : 'month') : null
    const amount = price ? ` ${yen(summary.planInterval === 'year' && price.yearlyYen !== null ? price.yearlyYen : price.monthlyYen)}` : ''
    return (
      <span>
        いまのプラン：{summary.planName}（{[basis, amount].filter(Boolean).join(' ')}{summary.currentPeriodEndsLabel ? `・次回の更新日 ${summary.currentPeriodEndsLabel}` : ''}）。プランを変えるときは、「支払い方法を管理」から開く Stripe の画面で、差額と適用日を確かめてから確定します。
      </span>
    )
  }
  const banner = billingBanner(summary)
  return <span>{banner.title} {banner.body}</span>
}
