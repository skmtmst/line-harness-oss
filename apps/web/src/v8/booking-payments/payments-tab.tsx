'use client'

import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreditCard, Split, Store } from 'lucide-react'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { notifySaved } from '@/components/shared/toast'
import { formatListTimestamp } from '@/lib/format'
import { ApiError, bookingApi, type BookingPaymentAdminConfig } from '@/lib/api'
import { bookingPaymentAdminApi, isNotReadyError, type BookingPaymentMode, type StripeConnection } from '@/lib/api/helpers/booking-payment-admin'
import { AccountIcon, SkeletonRows, StateCard, useV8TabEdit } from '@/v8/booking-menus/public/tab-parts/index'
import settings from '../booking-menus/settings.module.css'
import { providerFor } from './labels'
import { CancellationSection, ConnectionCard, DepositSection, cancellationSaveError, useCancellationSettings } from './cancellation'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import TestModeNote from '@/components/shared/test-mode-note'
import PaymentRecords from './records'
import PaymentEvents from './events'
import styles from './payments.module.css'

/*
 * 予約設定 › お支払い（・ 追記 3 の案A：お支払いの設定はこのタブ 1 つ）。
 * 絵：T91bV（つないだ後・試験モード）・UteeA（つなぐ前の状態と Stripe から届いた知らせ）・FY8HC（お支払いの記録）。
 * 読む：getPaymentConfig／savePaymentConfig。つなぎの状態・記録・知らせも実APIで読み、未適用は準備中へ分ける。
 * 受け付ける指定：?tab=payments&view=records|events。
 */

type View = 'settings' | 'records' | 'events'
const HOLD_CHOICES = [5, 10, 15, 30, 60]
const METHOD_CHOICES: Array<{ value: BookingPaymentMode; title: string; note: string; icon: ReactNode }> = [
  { value: 'onsite', title: 'お店で払う', note: '来店したときに払う', icon: <Store size={16} aria-hidden="true" /> },
  { value: 'online', title: 'オンラインで先払い', note: '予約のときにカードで払う', icon: <CreditCard size={16} aria-hidden="true" /> },
]
/* 「お客さまが選ぶ」は絵（T91bV・）のいつもの方法には置かない。すでに選んでいる店だけ 3 つ目に出す。 */
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
  const saveErrors = useSaveFormErrors()
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
  const cancellation = useCancellationSettings(accountId)
  const [connecting, setConnecting] = useState(false)

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
  const dirty = (status === 'ready' && config !== null && (mode !== savedMode || hold !== config.holdMinutes)) || cancellation.dirty
  const link = connectionFrom(config, connection)
  useEffect(() => { if (status === 'ready') onConnectedChange?.(link.connected) }, [status, link.connected, onConnectedChange])

  /* 決済をつなぐ：Stripe の試験の接続の画面へ（本番の鍵は入れない）。口が無ければ共通の案内の窓。 */
  async function connect() {
    setConnecting(true)
    try {
      const response = await bookingPaymentAdminApi.authorizeConnection(accountId)
      window.location.assign(response.data.authorizationUrl)
    } catch (cause) {
      if (isNotReadyError(cause)) preparing.open('決済をつなぐ')
      else setSaveError('決済をつなぐ画面を開けませんでした。もう一度お試しください。')
    } finally {
      setConnecting(false)
    }
  }

  async function save() {
    if (!config) return
    setSaving(true)
    setSaveError(null)
    try {
      if (mode !== savedMode || hold !== config.holdMinutes) {
        const response = await bookingApi.savePaymentConfig(accountId, { mode, provider: providerFor(mode), holdMinutes: hold })
        setConfig({ ...config, ...response.data })
      }
      await cancellation.save()
      notifySaved('お支払いの設定を保存しました')
    } catch (cause) {
      const fieldFailure = saveErrors.capture(cause)
      if (cancellation.dirty && cause instanceof ApiError && (cause.status === 409 || cause.status === 400)) { setSaveError(cancellationSaveError(cause)); return }
      if (fieldFailure) return
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
    onReset: () => { if (config) { setMode(savedMode); setHold(config.holdMinutes); setSaveError(null) } cancellation.reset() },
  })

  if (view === 'records') return (<SaveErrorScope errors={saveErrors}>{<PaymentRecords accountId={accountId} canEdit={canEdit} />}</SaveErrorScope>)
  if (view === 'events') return (<SaveErrorScope errors={saveErrors}>{<PaymentEvents accountId={accountId} canEdit={canEdit} />}</SaveErrorScope>)
  if (status === 'loading') return (<SaveErrorScope errors={saveErrors}>{<SkeletonRows rows={6} />}</SaveErrorScope>)
  if (status === 'error') {
    return (<SaveErrorScope errors={saveErrors}>{<StateCard icon={<AccountIcon />} title="お支払いの設定を読み込めませんでした" description="通信状態を確認して、もう一度お試しください。" action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />}</SaveErrorScope>)
  }

  const testMode = link.testMode
  const connected = link.connected
  const choices = connected ? [...METHOD_CHOICES, ...(savedMode === 'customer_choice' ? [CHOICE_CUSTOMER] : [])] : METHOD_CHOICES.slice(0, 1)
  return (<SaveErrorScope errors={saveErrors}>{(
    <div className={settings.tabStack} data-design={connected ? 'Payments' : 'PaymentsNotConnected'}>
      {saveError ? <Notice tone="danger" role="alert">{saveError}</Notice> : null}
      {/* 絵 FcGmv・i2iv4g（B1）：決済のつなぎ → キャンセル料 → デポジット。つなぐのは Stripe の試験の接続（組3 の口）。 */}
      <ConnectionCard connected={connected} testMode={testMode} checkedAt={link.connectedAt ? formatListTimestamp(link.connectedAt) : null} accountIdTail={link.accountIdTail} dashboardUrl={link.dashboardUrl} canEdit={canEdit} busy={connecting} onConnect={() => void connect()} onReconnect={() => preparing.open('Stripe のつなぎ直し')} />
      <CancellationSection state={cancellation} connected={connected} testMode={testMode} canEdit={canEdit} />
      <DepositSection state={cancellation} connected={connected} canEdit={canEdit} />

      {/* 決済をつなぐ前（i2iv4g）は、つなぎ・キャンセル料・デポジットの 3 つだけ（いつもの方法はお店で払うだけなので出さない）。 */}
      {connected ? (
      <section className={settings.section} aria-labelledby="payments-method-heading">
        <div className={styles.headRow}>
          <h2 id="payments-method-heading" className={settings.sectionTitle}>いつもの支払い方法</h2>
          <HelpTip label="いつもの支払い方法の説明">メニュー・コース・クラスで「このメニューだけ変える」を選んでいないときに使う方法です。</HelpTip>
        </div>
        {canEdit ? (
          <RadioCardGroup legend="いつもの支払い方法" columns={choices.length > 2 ? 3 : choices.length === 2 ? 2 : undefined}>
            {choices.map((choice) => (
              <SaveErrorField key={choice.value} names={["mode", "provider"]}><RadioCard key={choice.value} name="payments-default-method" value={choice.value} title={choice.title} note={choice.note}
                icon={choice.icon} checked={mode === choice.value} onChange={(value) => setMode(value as BookingPaymentMode)} /></SaveErrorField>
            ))}
          </RadioCardGroup>
        ) : <p className={styles.readValue}>{[...METHOD_CHOICES, CHOICE_CUSTOMER].find((choice) => choice.value === mode)?.title}</p>}
        <p className={styles.minor}>{METHOD_NOTE}</p>
      </section>
      ) : null}

      {connected ? (
      <section className={settings.section} aria-labelledby="payments-hold-heading">
        <div className={styles.headRow}>
          <h2 id="payments-hold-heading" className={settings.sectionTitle}>お支払いを待つ時間</h2>
          <HelpTip label="お支払いを待つ時間の説明">先払いの予約は、払い終わるまで仮の予約として枠を取っておきます。</HelpTip>
        </div>
        <div className={styles.holdRow}>
          <span className={styles.holdSelect}>
            {canEdit ? <SaveErrorField names={['holdMinutes', 'hold_minutes']}><Select aria-label="お支払いを待つ時間" value={String(hold)}
              onChange={(value) => setHold(Number(value))}
              options={HOLD_CHOICES.map((minutes) => ({ value: String(minutes), label: `${minutes} 分` }))} /></SaveErrorField> : <span className={styles.readValue}>{`${hold} 分`}</span>}
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
  )}</SaveErrorScope>)
}
