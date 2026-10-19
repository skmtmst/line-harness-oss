'use client'

import { useEffect, useState } from 'react'
import StatusBadge from '@/components/shared/status-badge'
import TestModeNote from '@/components/shared/test-mode-note'
import { PAYMENT_METHOD_ONSITE } from '@/components/shared/payment-status'
import TextLink from '@/components/shared/text-link'
import TruncatedText from '@/components/shared/truncated-text'
import { emptyValue } from '@/components/shared/empty-value'
import { formatYen } from '@/lib/format'
import { bookingApi, type BookingMenu } from '@/lib/api'
import { bookingPaymentAdminApi, type BookingPaymentMode, type MenuPaymentOverride, type PaymentSummary } from '@/lib/api/helpers/booking-payment-admin'
import { MODE_SHORT, MODE_TONE } from './labels'
import styles from './payments.module.css'

/* 予約設定 › お支払いの右の欄（T91bV）：メニューごとの支払い方法と今月のお支払い。 */

const SIDE_MENU_COUNT = 3

export default function PaymentsSide({ accountId, menus, connected = true }: { accountId: string; menus: BookingMenu[]; connected?: boolean }) {
  const [defaultMode, setDefaultMode] = useState<BookingPaymentMode | null>(null)
  const [overrides, setOverrides] = useState<MenuPaymentOverride[] | null>(null)
  const [summary, setSummary] = useState<PaymentSummary | null | 'not-ready'>(null)
  const [testMode, setTestMode] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.allSettled([
      Promise.resolve().then(() => bookingApi.getPaymentConfig(accountId)),
      Promise.resolve().then(() => bookingPaymentAdminApi.menuOverrides(accountId)),
      Promise.resolve().then(() => bookingPaymentAdminApi.records(accountId, { period: 'month', limit: 1 })),
      Promise.resolve().then(() => bookingPaymentAdminApi.connection(accountId)),
    ]).then(([config, menuModes, records, link]) => {
      if (alive) setTestMode(link.status === 'fulfilled' ? Boolean(link.value?.data?.connected && link.value.data.testMode) : false)
      if (!alive) return
      setDefaultMode(config.status === 'fulfilled' ? config.value.data.mode : null)
      setOverrides(menuModes.status === 'fulfilled' ? menuModes.value.data.menus : null)
      setSummary(records.status === 'fulfilled' ? records.value.data.summary : 'not-ready')
    })
    return () => { alive = false }
  }, [accountId])

  const shown = menus.filter((menu) => menu.is_active).slice(0, SIDE_MENU_COUNT)
  const normal = (mode: BookingPaymentMode | null) => (!mode || mode === 'none' ? 'onsite' : mode)

  return (
    <div className={styles.side}>
      <h2 className={styles.sideTitle}>メニューごとの支払い方法</h2>
      <ul className={`${styles.sideList} ${styles.sideMenus}`}>
        {shown.map((menu) => {
          const override = overrides?.find((item) => item.menuId === menu.id)
          const mode = normal(override?.mode ?? defaultMode)
          return (
            <li key={menu.id} className={styles.sideRow}>
              <span className={styles.sideName}><TruncatedText value={menu.name} /></span>
              {/* つなぐ前（r1zRK）はどのメニューもお店で払う。 */}
              {!connected ? <StatusBadge tone={PAYMENT_METHOD_ONSITE.tone} size="compact">{PAYMENT_METHOD_ONSITE.label}</StatusBadge>
                : overrides === null ? <span className={styles.sideValue}>{emptyValue('unknown')}</span>
                  : override ? <StatusBadge tone={MODE_TONE[mode]} size="compact">{MODE_SHORT[mode]}</StatusBadge>
                    : <StatusBadge tone="neutral" size="compact">{`いつもの方法（${MODE_SHORT[mode]}）`}</StatusBadge>}
            </li>
          )
        })}
      </ul>
      {!connected ? <p className={styles.minor}>先払いにするメニューは、Stripe をつないでから選べます。</p> : null}
      <TextLink href="/booking/menus?tab=menus">メニューの一覧で変える</TextLink>

      {connected ? <>
      <h2 className={styles.sideTitle}><span className={styles.headRow}>今月のお支払い{testMode ? <TestModeNote size="compact">{null}</TestModeNote> : null}</span></h2>
      <dl className={styles.sideList}>
        <div className={styles.sideRow}><dt className={styles.sideName}>入金</dt><dd className={styles.sideValue}>{summary && summary !== 'not-ready' ? formatYen(summary.paidAmount) : emptyValue('unknown')}</dd></div>
        <div className={styles.sideRow}><dt className={styles.sideName}>返金</dt><dd className={styles.sideValue}>{summary && summary !== 'not-ready' ? formatYen(summary.refundedAmount) : emptyValue('unknown')}</dd></div>
        <div className={styles.sideRow}><dt className={styles.sideName}>期限切れの枠</dt><dd className={styles.sideValue}>{summary && summary !== 'not-ready' ? `${summary.expiredCount} 件` : emptyValue('unknown')}</dd></div>
      </dl>
      <TextLink href="/booking/menus?tab=payments&view=records">お支払いの記録を見る</TextLink>
      <TextLink href="/booking/menus?tab=payments&view=events">Stripe から届いた知らせを見る</TextLink>
      </> : null}
    </div>
  )
}
