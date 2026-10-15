'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, Check, CreditCard, ExternalLink, Link2, Split, Store } from 'lucide-react'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { notifySaved, notifyToast } from '@/components/shared/toast'
import { formatListTimestamp } from '@/lib/format'
import { ApiError, bookingApi, type BookingPaymentAdminConfig } from '@/lib/api'
import { bookingPaymentAdminApi, isNotReadyError, type BookingPaymentMode, type StripeConnection } from '@/lib/api-booking-payment-admin'
import { AccountIcon, SkeletonRows, StateCard, useV8TabEdit } from '../booking-menus/tabs/shared'
import settings from '../booking-menus/settings.module.css'
import { NOT_READY, providerFor } from './labels'
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
  { value: 'customer_choice', title: 'お客さまが選ぶ', note: '先払いか、お店で払うか', icon: <Split size={16} aria-hidden="true" /> },
]

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
          ? `${NOT_READY}「お客さまが選ぶ」は、データの準備が済むと保存できます。`
          : '保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  useV8TabEdit({
    dirty,
    saving,
    subject: 'お支払いの設定への変更',
    saveDisabled: !canEdit || view !== 'settings' || !link.connected,
    onSave: () => void save(),
    onReset: () => { if (config) { setMode(savedMode); setHold(config.holdMinutes); setSaveError(null) } },
  })

  if (view === 'records') return <PaymentRecords accountId={accountId} canEdit={canEdit} />
  if (view === 'events') return <PaymentEvents accountId={accountId} canEdit={canEdit} />
  if (status === 'loading') return <SkeletonRows rows={6} />
  if (status === 'error') {
    return <StateCard icon={<AccountIcon />} title="お支払いの設定を読み込めませんでした" description="通信状態を確認して、もう一度お試しください。" action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />
  }

  if (!link.connected) return <ConnectCard canEdit={canEdit} />

  const testMode = link.testMode
  return (
    <div className={settings.tabStack} data-design="Payments">
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
              <StatusBadge tone="success" size="compact">つながっている</StatusBadge>
              {testMode ? <StatusBadge tone="warning" size="compact">試験モード</StatusBadge> : null}
            </span>
            <span className={styles.providerMeta}>
              {link.accountIdTail ? `アカウント acct_••••${link.accountIdTail}` : 'アカウント：決済サービスの設定から読みます'}
              {link.connectedAt ? `・${formatListTimestamp(link.connectedAt)} につないだ` : ''}
            </span>
          </div>
          <div className={styles.providerActions}>
            <Button href={link.dashboardUrl ?? (testMode ? 'https://dashboard.stripe.com/test/payments' : 'https://dashboard.stripe.com/payments')} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />Stripe の管理画面を開く</Button>
            {canEdit ? <Button onClick={() => notifyToast(`${NOT_READY}つなぎ直す操作は、本部の承認のあとに使えます。`)}>つなぎ直す</Button> : null}
          </div>
        </div>
        {testMode ? <Notice tone="warn" icon={<AlertTriangle size={16} aria-hidden="true" />}>試験モードです。本当の請求は起きません。本番に切り替えるのは、本部の承認のあとです。</Notice> : null}
      </section>

      <section className={settings.section} aria-labelledby="payments-method-heading">
        <div className={styles.headRow}>
          <h2 id="payments-method-heading" className={settings.sectionTitle}>いつもの支払い方法</h2>
          <HelpTip label="いつもの支払い方法の説明">メニュー・コース・クラスで「このメニューだけ変える」を選んでいないときに使う方法です。</HelpTip>
        </div>
        <RadioCardGroup legend="いつもの支払い方法" columns={3}>
          {METHOD_CHOICES.map((choice) => (
            <RadioCard key={choice.value} name="payments-default-method" value={choice.value} title={choice.title} note={choice.note}
              icon={choice.icon}
              checked={mode === choice.value} disabled={!canEdit} disabledReason={canEdit ? undefined : '閲覧のみのため変えられません'}
              onChange={(value) => setMode(value as BookingPaymentMode)} />
          ))}
        </RadioCardGroup>
        <p className={styles.minor}>メニュー・コース・クラスごとに変えられます（メニューの「お支払い」）。</p>
      </section>

      <section className={settings.section} aria-labelledby="payments-hold-heading">
        <div className={styles.headRow}>
          <h2 id="payments-hold-heading" className={settings.sectionTitle}>お支払いを待つ時間</h2>
          <HelpTip label="お支払いを待つ時間の説明">先払いの予約は、払い終わるまで仮の予約として枠を取っておきます。</HelpTip>
        </div>
        <div className={styles.holdRow}>
          <span className={styles.holdSelect}>
            <Select aria-label="お支払いを待つ時間" value={String(hold)} disabled={!canEdit}
              onChange={(value) => setHold(Number(value))}
              options={HOLD_CHOICES.map((minutes) => ({ value: String(minutes), label: `${minutes} 分` }))} />
          </span>
          <span className={styles.minor}>この時間を過ぎても払われないときは、仮の予約を取り消して枠を空けます。</span>
        </div>
        <div className={styles.refundRow}>
          <span className={styles.refundLabel}>返金</span>
          <span className={styles.minor}>キャンセルの期限までに取り消されたときは、自動で返金します。期限を過ぎた取り消しは返金しません。</span>
        </div>
      </section>
    </div>
  )
}

/** つなぐ前（UteeA の左）。つなぐ操作の口はまだ無い（B-314：押すと準備中の案内）。 */
function ConnectCard({ canEdit }: { canEdit: boolean }) {
  return (
    <div className={styles.connectLayout} data-design="PaymentsConnect">
      <section className={styles.connectCard} aria-labelledby="payments-connect-heading">
        <span className={styles.providerMark} aria-hidden="true">S</span>
        <h2 id="payments-connect-heading" className={styles.connectTitle}>Stripe をつなぐと、先払いを受け取れます</h2>
        <ul className={styles.connectList}>
          <li><Check size={14} aria-hidden="true" />カード・Apple Pay・Google Pay で払ってもらえます</li>
          <li><Check size={14} aria-hidden="true" />返金は予約の画面から押すだけです</li>
          <li><Check size={14} aria-hidden="true" />カード番号はお店にも musubo にも残りません</li>
        </ul>
        {canEdit ? <Button variant="primary" onClick={() => notifyToast(`${NOT_READY}Stripe をつなぐ画面は、もうすぐ使えるようになります。`)}><Link2 size={15} aria-hidden="true" />Stripe をつなぐ</Button> : null}
        <p className={styles.minor}>最初は試験モードでつながります。本番は本部の承認のあとです。</p>
      </section>
    </div>
  )
}
