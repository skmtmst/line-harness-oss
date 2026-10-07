'use client'

/*
 * ★V8 統括の請求（Pencil `JB8V1`）。
 *
 * v7 の画面（app/hq/billing/page.tsx）と読み書きの口・権限・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左の「統括の設定」の列
 * （型のフォルダの列）・契約の帯・周期の切り替えと「支払い方法を管理」・プラン3枚・
 * 支払い履歴の表。
 */
import { Check, CreditCard, Download } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SegmentedControl from '@/components/shared/segmented'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { api, ApiError } from '@/lib/api'
import { useStaffRole } from '@/lib/staff-role'
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
import { billingFailureMessage } from './billing-failure'
import HqSettingsNavV8 from './settings-nav'
import styles from './billing.module.css'

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/** 絵の言葉。まだ払われていない請求は「請求中」。 */
const INVOICE_WORDS: Record<string, string> = { ...INVOICE_STATUS_LABELS, open: '請求中' }

const TITLE = '請求'
const DESCRIPTION = 'プランと支払いの記録です。プランの申込はオーナーだけ、支払い方法の管理はオーナーか管理者ができます。'

export default function HqBillingV8() {
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  )
}

/** 支払い履歴の日付（絵は「2026/10/01」）。 */
function invoiceDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}/${pick('month')}/${pick('day')}`
}

function BillingInner() {
  // ★V8 上の帯のパンくずは「ホーム › 統括の設定 › 画面名」（絵 `V8-B/JB8V1`）。
  usePageTitle('請求')
  usePageCrumbs([{ label: '統括の設定', href: '/hq/settings' }])
  const params = useSearchParams()
  const checkoutResult = params.get('checkout')
  /* 役割はサーバ（/api/staff/me）から読む。手元の保存値は使わない。 */
  const role = useStaffRole() ?? ''

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null)
  /* R118: 履歴だけの取得失敗は概要と分けて持つ（失敗を `[]` に畳まない）。 */
  const [invoiceFailed, setInvoiceFailed] = useState(false)
  /* M023：履歴の 502（決済サービス不通）も決済サービスの案内にするための目安。 */
  const [invoiceError, setInvoiceError] = useState<unknown>(null)
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
        api.hqBilling.invoices().catch((caught: unknown) => {
          setInvoiceError(caught)
          return null
        }),
      ])
      if (!summaryRes.success) throw new Error(summaryRes.error)
      setSummary(summaryRes.data)
      setInvoices(invoiceRes?.success ? invoiceRes.data : null)
      setInvoiceFailed(!invoiceRes?.success)
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [])

  useEffect(() => {
    void load()
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
      setError(billingFailureMessage(caught, '支払い方法の管理画面の表示', '支払い方法の管理はオーナーか管理者だけができます。オーナーか管理者の方に操作してもらってください。'))
      setBusy(null)
    }
  }

  const invoiceUnreachable = invoiceError instanceof ApiError && invoiceError.status === 502

  const frame = (body: React.ReactNode) => (
    <ListPage boardId="JB8V1" title={TITLE} description={DESCRIPTION} folders={<HqSettingsNavV8 active="billing" />}>
      <div className={styles.body}>{body}</div>
    </ListPage>
  )

  if (status === 'loading') return frame(<ListState kind="loading" title="契約状況を読み込んでいます" />)
  // 担当者は見られない（権限表: 課金プランは担当者 不可。閲覧のみは閲覧できる）。
  if (status === 'forbidden' || role === 'staff') return frame(<ListState kind="forbidden" />)
  if (status === 'error' || !summary) {
    return frame(<ListState kind="error" title="契約状況を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />)
  }

  const banner = billingBanner(summary)
  const isOwner = role === 'owner'
  const canManagePayment = role === 'owner' || role === 'admin'
  const canChoose = isOwner && summary.state !== 'exempt' && summary.state !== 'active' && summary.state !== 'past_due'
  const yearlyMins = summary.plans
    .map((plan) => billingPlanPrice(plan, 'year').yearlyYen)
    .filter((yenValue): yenValue is number => yenValue !== null)
  const yearlyMin = yearlyMins.length > 0 ? Math.min(...yearlyMins) : null
  /* 申込の口が押せない理由（決済の設定がまだ・オーナー以外）は、押せないときだけ出す。 */
  const blockedNote = !summary.stripeReady
    ? `決済の接続設定がまだのため、申込ボタンは押せません。${billingPriceNote(summary.plans, interval)}`
    : !isOwner && role !== ''
      ? `プランの申込と変更はオーナーだけができます。${billingPriceNote(summary.plans, interval)}`
      : ''

  return frame(
    <>
      {checkoutResult === 'success' ? (
        <Notice tone="info" message="お申し込みを受け付けました。決済の確認が済むと「契約中」に変わります（数秒〜1分ほどかかります）。" />
      ) : null}
      {checkoutResult === 'cancel' ? (
        <Notice tone="info" message="お申し込みを中止しました。プランはいつでも選び直せます。" />
      ) : null}

      {banner.tone === 'info' ? (
        <p className={styles.contract} data-design="Status"><ContractText summary={summary} /></p>
      ) : (
        <div data-design="Status"><Notice tone={banner.tone} message={`${banner.title} ${banner.body}`} /></div>
      )}

      <div className={styles.intervalRow} data-design="Interval">
        <SegmentedControl<BillingInterval>
          aria-label="支払いの周期"
          size="small"
          className={styles.interval}
          value={interval}
          onChange={setInterval}
          options={[
            { value: 'month', label: '月払い' },
            { value: 'year', label: yearlyMin !== null ? `年払い（年 ${yen(yearlyMin)}〜）` : '年払い' },
          ]}
        />
        {summary.portalAvailable && canManagePayment ? (
          <Button onClick={() => void portal()} disabled={busy !== null} busy={busy === 'portal'} busyLabel="開いています…">
            <CreditCard aria-hidden="true" className={styles.buttonIcon} />支払い方法を管理
          </Button>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.plans} data-design="Plans">
        {summary.plans.map((plan) => {
          const price = billingPlanPrice(plan, interval)
          return (
            <section key={plan.key} className={plan.current ? `${styles.plan} ${styles.planCurrent}` : styles.plan}>
              <div className={styles.planHead}>
                <h2 className={styles.planName}>{plan.name}</h2>
                {plan.recommended ? <span className={styles.badge}>おすすめ</span> : null}
                {interval === 'year' ? <span className={styles.badge}>約15% OFF</span> : null}
                {plan.current ? <span className={`${styles.pill} ${styles.pillOk}`}><span className={styles.dot} aria-hidden="true" />利用中</span> : null}
              </div>
              <p className={styles.planDesc}>{plan.description}</p>
              <p className={styles.price} data-price-source={price.fromStripe ? 'stripe' : 'fallback'}>
                <span className={styles.priceValue}>{yen(price.monthlyYen)}</span>
                <span className={styles.priceUnit}>/月（税込）</span>
                {price.yearlyYen !== null ? <span className={styles.priceUnit}>年額 {yen(price.yearlyYen)}（税込）</span> : null}
                {!price.fromStripe ? <span className={styles.priceUnit}>仮の料金です</span> : null}
              </p>
              <ul className={styles.features}>
                {plan.features.map((feature) => (
                  <li key={feature} className={styles.feature}>
                    <Check aria-hidden="true" className={styles.check} />
                    {feature}
                  </li>
                ))}
              </ul>
              <div className={styles.planFoot}>
                {plan.current ? (
                  <Button disabled className={styles.planButton}>
                    <Check aria-hidden="true" className={styles.buttonIcon} />いまのプラン
                  </Button>
                ) : isOwner ? (
                  <Button
                    onClick={() => void checkout(plan, interval)}
                    disabled={busy !== null || !canChoose || !price.available}
                    className={styles.planButton}
                    busy={busy === plan.key}
                    busyLabel="申込画面へ移動中…"
                  >
                    このプランにする
                  </Button>
                ) : null}
                {!price.available && !plan.current ? <p className={styles.planNote}>価格がまだ設定されていません</p> : null}
              </div>
            </section>
          )
        })}
      </div>

      {blockedNote ? <p className={styles.note} data-design="Note">{blockedNote}</p> : null}

      <section className={styles.history} data-design="History">
        <h2 className={styles.historyTitle}>支払い履歴</h2>
        {invoiceFailed ? (
          <ListState
            kind="error"
            title={invoiceUnreachable ? '決済サービスにつながりませんでした' : '支払い履歴を読み込めませんでした'}
            description={invoiceUnreachable ? '少し待って、もう一度読み込んでください。' : undefined}
            error={invoiceError ?? undefined}
            onRetry={() => void load()}
          />
        ) : invoices === null || invoices.length === 0 ? (
          <p className={styles.empty}>まだ支払いはありません。プランを選ぶと、ここに請求と支払いの記録が並びます。</p>
        ) : (
          <div className={styles.table} role="table" aria-label="支払い履歴">
            <div className={styles.head} role="row">
              <span role="columnheader">日付</span>
              <span role="columnheader">内容</span>
              <span role="columnheader" className={styles.amount}>金額</span>
              <span role="columnheader">状態</span>
              <span role="columnheader">領収書</span>
            </div>
            {invoices.map((inv) => (
              <div key={inv.id} className={styles.row} role="row">
                <span role="cell">{invoiceDate(inv.createdAt)}</span>
                <span role="cell" className={styles.cell} title={inv.description ?? inv.number ?? ''}>{inv.description ?? inv.number ?? '—'}</span>
                <span role="cell" className={styles.amount}>{yen(inv.amountYen)}</span>
                <span role="cell">
                  <span className={inv.status === 'paid' ? `${styles.pill} ${styles.pillOk}` : inv.status === 'open' || inv.status === 'draft' ? `${styles.pill} ${styles.pillInfo}` : `${styles.pill} ${styles.pillIdle}`}><span className={styles.dot} aria-hidden="true" />{INVOICE_WORDS[inv.status ?? ''] ?? inv.status ?? '—'}</span>
                </span>
                <span role="cell">
                  {inv.hostedUrl ? (
                    <Button href={inv.hostedUrl} target="_blank" rel="noreferrer">
                      <Download aria-hidden="true" className={styles.buttonIcon} />領収書
                    </Button>
                  ) : (
                    <span className={styles.faint}>—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>,
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
      <>
        いまのプラン：{summary.planName}（{[basis, amount].filter(Boolean).join('')}）{summary.currentPeriodEndsLabel ? `・次回の更新日 ${summary.currentPeriodEndsLabel}` : ''}。プランを変えるときは、「支払い方法を管理」から開く Stripe の画面で、差額と適用日を確かめてから確定します。
      </>
    )
  }
  const banner = billingBanner(summary)
  return <>{banner.title} {banner.body}</>
}
