'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Calculator, CreditCard, Pencil, Settings } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/card'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import TextLink from '@/components/shared/text-link'
import { formatYen } from '@/lib/format'
import { bookingApi } from '@/lib/api'
import { bookingPaymentAdminApi, isNotReadyError, type BookingPaymentMode } from '@/lib/api-booking-payment-admin'
import { MODE_LABEL, NOT_READY, providerFor } from './labels'
import styles from './payments.module.css'

/*
 * メニュー・コース・クラスごとの「お支払い」の段（B-305 追記 3・絵 mauOC・XFRyO・QqER7）。
 * いつもの方法を使う／このメニューだけ変える（オンラインで先払い・お店で払う・お客さまが選ぶ）。
 * 決済をつないでいない店では段を出さず、1 行だけ「お支払いをつなぐ →」（押せない形にしない）。
 * 予約メニューは今ある口（saveMenuPayment／clearMenuPayment）。コース・クラスと今の値を読む口は口待ち。
 */

export type MenuPaymentKind = 'booking' | 'course' | 'event'
type Status = 'loading' | 'ready' | 'not-ready' | 'error'

export interface MenuPaymentState {
  status: Status
  connected: boolean
  defaultMode: BookingPaymentMode
  /** null＝いつもの方法を使う。 */
  value: BookingPaymentMode | null
  dirty: boolean
  setValue: (next: BookingPaymentMode | null) => void
  /** 変えていれば保存する。口が無いときは保存しない（準備中）。 */
  save: (id?: string) => Promise<void>
  reset: () => void
}

function normal(mode: BookingPaymentMode | null | undefined): BookingPaymentMode {
  return !mode || mode === 'none' ? 'onsite' : mode
}

export function useMenuPayment(kind: MenuPaymentKind, accountId: string | null, id: string | null): MenuPaymentState {
  const [status, setStatus] = useState<Status>('loading')
  const [connected, setConnected] = useState(false)
  const [defaultMode, setDefaultMode] = useState<BookingPaymentMode>('onsite')
  const [saved, setSaved] = useState<BookingPaymentMode | null>(null)
  const [value, setValue] = useState<BookingPaymentMode | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    if (!accountId) return
    const mine = ++generation.current
    setStatus('loading')
    const current: Promise<BookingPaymentMode | null> = !id ? Promise.resolve(null)
      : kind === 'booking' ? bookingPaymentAdminApi.menuOverrides(accountId).then((response) => response.data.menus.find((item) => item.menuId === id)?.mode ?? null)
        : kind === 'course' ? bookingPaymentAdminApi.courseMode(accountId, id).then((response) => response.data.mode)
          : bookingPaymentAdminApi.eventMode(accountId, id).then((response) => response.data.mode)
    void Promise.allSettled([bookingApi.getPaymentConfig(accountId), bookingPaymentAdminApi.connection(accountId), current]).then(([config, link, mode]) => {
      if (mine !== generation.current) return
      if (config.status === 'rejected') { setStatus('error'); return }
      setDefaultMode(normal(config.value.data.mode))
      setConnected(link.status === 'fulfilled' ? link.value.data.connected : config.value.data.provider === 'stripe')
      const next = mode.status === 'fulfilled' ? mode.value : null
      setSaved(next)
      setValue(next)
      setStatus(mode.status === 'rejected' && isNotReadyError(mode.reason) ? 'not-ready' : mode.status === 'rejected' ? 'error' : 'ready')
    })
  }, [kind, accountId, id])

  const dirty = status === 'ready' && value !== saved
  const save = useCallback(async (targetId?: string) => {
    const menuId = targetId ?? id
    if (!accountId || !menuId || status !== 'ready' || value === saved) return
    if (kind === 'booking') {
      if (value === null) await bookingApi.clearMenuPayment(accountId, menuId)
      else await bookingApi.saveMenuPayment(accountId, menuId, { mode: value, provider: providerFor(value) })
    } else if (kind === 'course') {
      await bookingPaymentAdminApi.saveCourseMode(accountId, menuId, value)
    } else {
      await bookingPaymentAdminApi.saveEventMode(accountId, menuId, value)
    }
    setSaved(value)
  }, [accountId, id, kind, status, value, saved])

  return { status, connected, defaultMode, value, dirty, setValue, save, reset: () => setValue(saved) }
}

const OVERRIDE_CHOICES: BookingPaymentMode[] = ['online', 'onsite', 'customer_choice']

/** 段の中身（題は呼び出し側の段に合わせて MenuPaymentCard か、そのまま置く）。 */
export function MenuPaymentFields({ state, name, price, people, unit, readOnly = false }: {
  state: MenuPaymentState
  name: string
  /** 1 名（1 回）の値段。 */
  price: number | null
  /** 先払いの計算に使う人数（予約の人数の下限など）。 */
  people?: number
  unit?: string
  readOnly?: boolean
}) {
  if (state.status === 'loading') return <p className={styles.minor}>お支払いの設定を読み込んでいます…</p>
  if (state.status === 'error') return <p className={styles.minor}>お支払いの設定を読み込めませんでした。いつもの方法（予約設定 › お支払い）で受けます。</p>
  if (!state.connected) {
    return <p className={styles.sideCardLink}><CreditCard size={15} aria-hidden="true" />先払いを受けるには<TextLink href="/booking/menus?tab=payments">お支払いをつなぐ<ArrowRight size={14} aria-hidden="true" /></TextLink></p>
  }
  const own = state.value !== null
  const effective = state.value ?? state.defaultMode
  const count = people && people > 0 ? people : 1
  const locked = readOnly || state.status === 'not-ready'
  return (
    <>
      {state.status === 'not-ready' ? <Notice tone="info">{NOT_READY}このメニューだけ変える設定は、データの準備が済むと保存できます（今はいつもの方法で受けます）。</Notice> : null}
      <RadioCardGroup legend={`${name}のお支払い`} columns={2}>
        <RadioCard name={`${name}-payment-source`} value="default" title="いつもの方法を使う" note={`今は：${MODE_LABEL[state.defaultMode]}（予約設定 › お支払い）`}
          icon={<Settings size={16} aria-hidden="true" />} checked={!own} disabled={locked} onChange={() => state.setValue(null)} />
        <RadioCard name={`${name}-payment-source`} value="own" title="このメニューだけ変える" note="下で選んだ方法にします"
          icon={<Pencil size={16} aria-hidden="true" />} checked={own} disabled={locked}
          onChange={() => state.setValue(state.value ?? (state.defaultMode === 'online' ? 'onsite' : 'online'))} />
      </RadioCardGroup>
      {own ? (
        <RadioCardGroup legend="このメニューの支払い方法" className={styles.choiceRow}>
          {OVERRIDE_CHOICES.map((mode) => (
            <RadioCard key={mode} variant="row" name={`${name}-payment-mode`} value={mode} title={MODE_LABEL[mode]}
              checked={state.value === mode} disabled={locked} onChange={() => state.setValue(mode)} />
          ))}
        </RadioCardGroup>
      ) : null}
      {effective === 'online' && price !== null ? (
        <div className={styles.amountBox}>
          <Calculator size={15} aria-hidden="true" />
          {`先払いの金額：${formatYen(price)} × ${count}${unit ?? '名'} = ${formatYen(price * count)}`}
          <span className={styles.amountNote}>人数に合わせて計算</span>
        </div>
      ) : null}
    </>
  )
}

export function MenuPaymentCard(props: Parameters<typeof MenuPaymentFields>[0]) {
  return (
    <Card variant="form" gap="normal">
      <CardHeader size="stacked" title="お支払い" help={<HelpTip label="お支払いの説明">先払いのときは、予約の最後に Stripe の支払いページへ進みます。払い終わると予約が決まります。</HelpTip>} />
      <MenuPaymentFields {...props} />
    </Card>
  )
}

/** 右の欄の説明カード（mauOC・XFRyO）。 */
export function PaymentSideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.sideCard}>
      <h3 className={styles.sideCardTitle}>{title}</h3>
      <p className={styles.sideCardText}>{children}</p>
    </section>
  )
}
