'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, CreditCard, ExternalLink, Plug, Split, Store } from 'lucide-react'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { notifySaved } from '@/components/shared/toast'
import { formatListTimestamp } from '@/lib/format'
import { ApiError, bookingApi, type BookingPaymentAdminConfig } from '@/lib/api'
import { bookingPaymentAdminApi, type BookingPaymentMode, type StripeConnection } from '@/lib/api-booking-payment-admin'
import { AccountIcon, SkeletonRows, StateCard, useV8TabEdit } from '../booking-menus/tabs/shared'
import settings from '../booking-menus/settings.module.css'
import { providerFor } from './labels'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { TestModeBadge } from '@/components/shared/payment-badges'
import PaymentRecords from './records'
import PaymentEvents from './events'
import styles from './payments.module.css'

/*
 * 予約設定 › お支払い（B-305・B-308 追記 3 の案A：お支払いの設定はこのタブ 1 つ）。
 * 絵：T91bV（つないだ後・試験モード）・UteeA（つなぐ前の状態と Stripe から届いた知らせ）・FY8HC（お支払いの記録）。
 * 読む：今ある口 getPaymentConfig／savePaymentConfig。つなぎの状態・記録・知らせは口待ち（無ければ準備中）。
 * 受け付ける指定：?tab=payments&view=records|events。
 */

type View = 'settings' | 'records' | 'events'
const HOLD_CHOICES = [5, 10, 15, 30, 60]
const METHOD_CHOICES: Array<{ value: BookingPaymentMode; title: string; note: string; icon: ReactNode }> = [
  { value: 'onsite', title: 'お店で払う', note: '来店したときに払う', icon: <Store size={16} aria-hidden="true" /> },
  { value: 'online', title: 'オンラインで先払い', note: '予約のときにカードで払う', icon: <CreditCard size={16} aria-hidden="true" /> },
]
/* 「お客さまが選ぶ」は絵（T91bV・B-338）のいつもの方法には置かない。すでに選んでいる店だけ 3 つ目に出す。 */
const CHOICE_CUSTOMER = { value: 'customer_choice' as BookingPaymentMode, title: 'お客さまが選ぶ', note: '先払いか、お店で払うか', icon: <Split size={16} aria-hidden="true" /> }
const METHOD_NOTE = '店のいつもはお店で払う。コースなど先に払ってほしい物だけ、メニューの「お支払い」で先払いにします。'

function normalMode(mode: BookingPaymentMode | undefined): BookingPaymentMode {
  return !mode || mode === 'none' ? 'onsite' : mode
}

/** つなぎの状態：口が無い店では、決済サービスが Stripe かどうかで読む。 */
function connectionFrom(config: BookingPaymentAdminConfig | null, connection: StripeConnection | null): StripeConnection {
  if (connection) return connection
  const stripe = config?.provider === 'stripe'
  return { connected: stripe, testMode: config?.testMode ?? true, accountIdTail: null, connectedAt: null, dashboardUrl: null }
}

export function PaymentsTabV8({ accountId, canEdit, onConnectedChange }: { accountId: string; canEdit: boolean; onConnectedChange?: (connected: boolean) => void }) {
  const searchParams = useSearchParams()
  const rawView = searchParams.get('view')
  const view: View = rawView === 'records' || rawView === 'events' ? rawView : 'settings'
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [config, setConfig] = useState<BookingPaymentAdminConfig | null>(null)
  const [connection, setConnection] = useState<StripeConnection | null>(null)
  const [mode, setMode] = useState<BookingPaymentMode>('onsite')
  const [hold, setHold] = useState(10)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const generation = useRef(0)
  const preparing = usePreparingDialog()

  const load = useCallback(async () => {
    const mine = ++generation.current
    setStatus('loading')
    const [configResult, connectionResult] = await Promise.allSettled([
      bookingApi.getPaymentConfig(accountId),
      bookingPaymentAdminApi.connection(accountId),
    ])
    if (mine !== generation.current) return
    if (configResult.status === 'rejected') { setStatus('error'); return }
    const next = configResult.value.data
    setConfig(next)
    setMode(normalMode(next.mode))
    setHold(next.holdMinutes)
    setConnection(connectionResult.status === 'fulfilled' ? connectionResult.value.data : null)
    setSaveError(null)
    setStatus('ready')
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const savedMode = normalMode(config?.mode)
  const dirty = status === 'ready' && config !== null && (mode !== savedMode || hold !== config.holdMinutes)
  const link = connectionFrom(config, connection)
  useEffect(() => { if (status === 'ready') onConnectedChange?.(link.connected) }, [status, link.connected, onConnectedChange])

  async function save() {
    if (!config) return
    setSaving(true)
    setSaveError(null)
    try {
      const response = await bookingApi.savePaymentConfig(accountId, { mode, provider: providerFor(mode), holdMinutes: hold })
      setConfig({ ...config, ...response.data })
      notifySaved('お支払いの設定を保存しました')
    } catch (cause) {
      setSaveError(cause instanceof ApiError && cause.status === 403
        ? 'この設定を変える権限がありません。'
        : mode === 'customer_choice' && cause instanceof ApiError && cause.status === 400
          ? '「お客さまが選ぶ」は、データの準備が済むと保存できます。'
          : '保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  useV8TabEdit({
    dirty,
    saving,
    subject: 'お支払いの設定への変更',
    saveDisabled: !canEdit || view !== 'settings',
    onSave: () => void save(),
    onReset: () => { if (config) { setMode(savedMode); setHold(config.holdMinutes); setSaveError(null) } },
  })

  if (view === 'records') return <PaymentRecords accountId={accountId} canEdit={canEdit} />
  if (view === 'events') return <PaymentEvents accountId={accountId} canEdit={canEdit} />
  if (status === 'loading') return <SkeletonRows rows={6} />
  if (status === 'error') {
    return <StateCard icon={<AccountIcon />} title="お支払いの設定を読み込めませんでした" description="通信状態を確認して、もう一度お試しください。" action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />
  }

  const testMode = link.testMode
  const connected = link.connected
  const choices = connected ? [...METHOD_CHOICES, ...(savedMode === 'customer_choice' ? [CHOICE_CUSTOMER] : [])] : METHOD_CHOICES.slice(0, 1)
  return (
    <div className={settings.tabStack} data-design={connected ? 'Payments' : 'PaymentsNotConnected'}>
      {saveError ? <Notice tone="danger" role="alert">{saveError}</Notice> : null}
      <section className={settings.section} aria-labelledby="payments-provider-heading">
        <div className={styles.headRow}>
          <h2 id="payments-provider-heading" className={settings.sectionTitle}>決済サービス</h2>
          <HelpTip label="決済サービスの説明">お客さまのカード番号は Stripe の画面で入れてもらいます。お店にも musubo にも残りません。</HelpTip>
        </div>
        <div className={styles.providerRow}>
          <span className={styles.providerMark} aria-hidden="true">S</span>
          <div className={styles.providerText}>
            <span className={styles.providerName}>
              Stripe
              {connected ? <StatusBadge tone="success" size="compact">つながっている</StatusBadge> : null}
              {connected && testMode ? <TestModeBadge /> : null}
            </span>
            <span className={styles.providerMeta}>
              {connected
                ? <>{link.accountIdTail ? `アカウント acct_••••${link.accountIdTail}` : 'アカウント：決済サービスの設定から読みます'}{link.connectedAt ? `・${formatListTimestamp(link.connectedAt)} につないだ` : ''}</>
                : 'まだつないでいません。つなぐと、予約のときにカードで先に払ってもらえます'}
            </span>
          </div>
          <div className={styles.providerActions}>
            {connected ? <Button href={link.dashboardUrl ?? (testMode ? 'https://dashboard.stripe.com/test/payments' : 'https://dashboard.stripe.com/payments')} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />Stripe の管理画面を開く</Button> : null}
            {canEdit ? (connected
              ? <Button onClick={() => preparing.open('Stripe のつなぎ直し')}>つなぎ直す</Button>
              : <Button variant="primary" onClick={() => preparing.open('Stripe をつなぐ')}><Plug size={15} aria-hidden="true" />Stripe をつなぐ</Button>) : null}
          </div>
        </div>
        {connected
          ? (testMode ? <Notice tone="warn" icon={<AlertTriangle size={16} aria-hidden="true" />}>試験モードです。本当の請求は起きません。本番に切り替えるのは、本部の承認のあとです。</Notice> : null)
          : <Notice tone="warn" icon={<AlertTriangle size={16} aria-hidden="true" />}>つなぐまでは、お客さまはお店で払うだけです。つないだ後も最初は試験モードで、本番は本部の承認のあとです。</Notice>}
      </section>

      <section className={settings.section} aria-labelledby="payments-method-heading">
        <div className={styles.headRow}>
          <h2 id="payments-method-heading" className={settings.sectionTitle}>いつもの支払い方法</h2>
          <HelpTip label="いつもの支払い方法の説明">メニュー・コース・クラスで「このメニューだけ変える」を選んでいないときに使う方法です。</HelpTip>
        </div>
        {canEdit ? (
          <RadioCardGroup legend="いつもの支払い方法" columns={choices.length > 2 ? 3 : choices.length === 2 ? 2 : undefined}>
            {choices.map((choice) => (
              <RadioCard key={choice.value} name="payments-default-method" value={choice.value} title={choice.title} note={choice.note}
                icon={choice.icon} checked={mode === choice.value} onChange={(value) => setMode(value as BookingPaymentMode)} />
            ))}
          </RadioCardGroup>
        ) : <p className={styles.readValue}>{[...METHOD_CHOICES, CHOICE_CUSTOMER].find((choice) => choice.value === mode)?.title}</p>}
        <p className={styles.minor}>{METHOD_NOTE}</p>
      </section>

      {connected ? (
      <section className={settings.section} aria-labelledby="payments-hold-heading">
        <div className={styles.headRow}>
          <h2 id="payments-hold-heading" className={settings.sectionTitle}>お支払いを待つ時間</h2>
          <HelpTip label="お支払いを待つ時間の説明">先払いの予約は、払い終わるまで仮の予約として枠を取っておきます。</HelpTip>
        </div>
        <div className={styles.holdRow}>
          <span className={styles.holdSelect}>
            {canEdit ? <Select aria-label="お支払いを待つ時間" value={String(hold)}
              onChange={(value) => setHold(Number(value))}
              options={HOLD_CHOICES.map((minutes) => ({ value: String(minutes), label: `${minutes} 分` }))} /> : <span className={styles.readValue}>{`${hold} 分`}</span>}
          </span>
          <span className={styles.minor}>この時間を過ぎても払われないときは、仮の予約を取り消して枠を空けます。</span>
        </div>
        <div className={styles.refundRow}>
          <span className={styles.refundLabel}>返金</span>
          <span className={styles.minor}>キャンセルの期限までに取り消されたときは、自動で返金します。期限を過ぎた取り消しは返金しません。</span>
        </div>
      </section>
      ) : null}
      {preparing.dialog}
    </div>
  )
}
