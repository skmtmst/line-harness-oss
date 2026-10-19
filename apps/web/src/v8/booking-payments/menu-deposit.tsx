'use client'
import { yenPercent } from '@line-crm/shared';
import { formatYen as yen } from '@line-crm/shared';

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, CreditCard } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/card'
import Checkbox from '@/components/shared/checkbox'
import HelpTip from '@/components/shared/help-tip'
import NumberInput from '@/components/shared/number-field'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import SegmentedControl from '@/components/shared/segmented'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField, SaveErrorScope } from '@/components/shared/save-form-errors'
import TextLink from '@/components/shared/text-link'
import { bookingAdvancedApi } from '@/lib/api/helpers/booking-advanced'
import type { DepositRule } from '@line-crm/shared'
import type { MenuPaymentState } from './menu-payment'
import { MODE_LABEL } from './labels'
import styles from './payments.module.css'

/*
 * 予約メニューの「お支払い」の段（B1・絵 CnV1I）：いつもの方法／先払い／お店で払う／デポジット（一部）の 4 つ。
 * 先払い・お店で払うは今ある口（saveMenuPayment）、デポジットも版付きの実APIで読み書きする。
 * デポジットを選ぶと支払い方法は先払い（残りはお店で）として送る。
 */

type Choice = 'default' | 'online' | 'onsite' | 'deposit'
const NEW_MENU_DEPOSIT: DepositRule & { inherit: boolean } = { kind: 'none', value: null, conditions: { always: true, minPeople: null, weekdays: null, timeBand: null }, version: 0, inherit: true }

export function useMenuDeposit(accountId: string | null, menuId: string | null) {
  const [saved, setSaved] = useState<(DepositRule & { inherit: boolean }) | null>(null)
  const [draft, setDraft] = useState<(DepositRule & { inherit: boolean }) | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!accountId) { setReady(false); return }
    /* 作る画面（まだメニューが無い）：いつもの方法から始め、保存でメニューができてから同じ口へ送る（版 0）。 */
    if (!menuId) { setSaved(NEW_MENU_DEPOSIT); setDraft(NEW_MENU_DEPOSIT); setReady(true); return }
    let alive = true
    void Promise.resolve().then(() => bookingAdvancedApi.menuDeposit(accountId, menuId))
      .then((response) => { if (alive) { setSaved(response.data); setDraft(response.data); setReady(true) } })
      .catch(() => { if (alive) { setSaved(null); setDraft(null); setReady(false) } })
    return () => { alive = false }
  }, [accountId, menuId])
  const dirty = ready && JSON.stringify(saved) !== JSON.stringify(draft)
  const save = useCallback(async (targetId?: string) => {
    const id = targetId ?? menuId
    if (!accountId || !id || !draft || !dirty) return
    const { version, ...body } = draft
    const response = await bookingAdvancedApi.saveMenuDeposit(accountId, id, { ...body, expectedVersion: version })
    setSaved(response.data); setDraft(response.data)
  }, [accountId, menuId, draft, dirty])
  return { ready, draft, setDraft, dirty, save }
}
export type MenuDepositState = ReturnType<typeof useMenuDeposit>


export function BookingMenuPaymentCard({ payment, deposit, price, readOnly }: { payment: MenuPaymentState; deposit: MenuDepositState; price: number | null; readOnly: boolean }) {
  const depositOn = Boolean(deposit.draft && !deposit.draft.inherit && deposit.draft.kind !== 'none')
  const choice: Choice = depositOn ? 'deposit' : payment.value === 'online' ? 'online' : payment.value === 'onsite' || payment.value === 'none' || payment.value === 'customer_choice' ? 'onsite' : 'default'
  const choose = (next: Choice) => {
    if (next === 'default') payment.setValue(null)
    else payment.setValue(next === 'deposit' ? 'online' : next)
    if (deposit.draft) deposit.setDraft({ ...deposit.draft, inherit: next !== 'deposit', kind: next === 'deposit' ? (deposit.draft.kind === 'none' ? 'percent' : deposit.draft.kind) : 'none', value: next === 'deposit' ? deposit.draft.value ?? 30 : deposit.draft.value })
  }
  const rule = deposit.draft
  const amount = rule && price !== null && rule.value ? (rule.kind === 'percent' ? yenPercent(price, rule.value) : Math.min(rule.value, price)) : null
  const header = <CardHeader size="stacked" title="お支払い" help={<HelpTip label="お支払いの説明">いつもの方法は予約設定 › お支払いのとおりです。デポジットは予約のときに一部を先に払ってもらい、残りはお店で払います。</HelpTip>} />
  if (payment.status === 'loading') return <Card variant="form" gap="normal">{header}<p className={styles.minor}>お支払いの設定を読み込んでいます…</p></Card>
  if (!payment.connected) return <Card variant="form" gap="normal">{header}<p className={styles.sideCardLink}><CreditCard size={15} aria-hidden="true" />先払い・デポジットを受けるには<TextLink href="/booking/menus?tab=payments">お支払いをつなぐ<ArrowRight size={14} aria-hidden="true" /></TextLink></p></Card>
  if (readOnly) return <Card variant="form" gap="normal">{header}<p className={styles.readValue}>{payment.value === 'customer_choice' ? MODE_LABEL.customer_choice : choice === 'deposit' ? 'デポジット（一部）' : choice === 'default' ? `いつもの方法（${MODE_LABEL[payment.defaultMode]}）` : MODE_LABEL[choice]}</p></Card>
  return (
    <Card variant="form" gap="normal">
      {header}
      <SaveErrorScope errors={payment.saveErrors}><SaveErrorField names={['mode', 'payment_mode', 'provider']}>
      <RadioCardGroup legend="このメニューのお支払い" className={styles.fourChoices}>
        {([
          ['default', 'いつもの方法', '予約設定のお支払いのとおり'],
          ['online', '先払い', '予約のときに全額'],
          ['onsite', 'お店で払う', '来店のときに払う'],
          ['deposit', 'デポジット（一部）', '予約のときに一部、残りはお店で'],
        ] as const).map(([value, title, note]) => (
          <RadioCard key={value} name="menu-payment-choice" value={value} title={value === 'onsite' && payment.value === 'customer_choice' ? MODE_LABEL.customer_choice : title} note={value === 'onsite' && payment.value === 'customer_choice' ? '先払いか、お店で払うか' : note}
            checked={choice === value} disabled={value === 'deposit' && !deposit.ready} disabledReason={value === 'deposit' && !deposit.ready ? 'データの準備が済むと選べます' : undefined}
            onChange={() => choose(value)} />
        ))}
      </RadioCardGroup></SaveErrorField>
      {choice === 'onsite' ? <Checkbox checked={payment.value === 'customer_choice'} disabled={payment.status === 'not-ready'}
        onCheckedChange={(enabled) => payment.setValue(enabled ? 'customer_choice' : 'onsite')}>お客さまが選ぶ（先払いか、お店で払うか）</Checkbox> : null}
      </SaveErrorScope>
      {choice === 'deposit' && rule ? (
        <>
          <div className={styles.depositLine}>
            <SegmentedControl aria-label="デポジットの決め方" value={rule.kind === 'amount' ? 'amount' : 'percent'} onChange={(kind) => deposit.setDraft({ ...rule, kind })}
              options={[{ value: 'percent', label: '%' }, { value: 'amount', label: '金額' }]} />
            <Field label="デポジット" required>
              <NumberInput aria-label="デポジット" unit={rule.kind === 'amount' ? '円' : '%'} type="number" min={1} max={rule.kind === 'percent' ? 100 : undefined} value={rule.value ?? ''}
                onChange={(event) => deposit.setDraft({ ...rule, value: event.target.value === '' ? null : Number(event.target.value) })} />
            </Field>
            {amount !== null && price !== null ? <span className={styles.depositResult}>{`= ${yen(amount)}（料金 ${yen(price)} のうち）`}</span> : null}
          </div>
          <p className={styles.subLabel}>デポジットを取る条件</p>
          <div className={styles.checkRow}>
            <Checkbox checked={Boolean(rule.conditions.minPeople)} onCheckedChange={(on) => deposit.setDraft({ ...rule, conditions: { ...rule.conditions, always: false, minPeople: on ? 4 : null } })}>人数が 4 人以上</Checkbox>
            <Checkbox checked={Boolean(rule.conditions.weekdays?.length)} onCheckedChange={(on) => deposit.setDraft({ ...rule, conditions: { ...rule.conditions, always: false, weekdays: on ? [5, 6] : null, timeBand: on ? 'dinner' : null } })}>金・土の夜</Checkbox>
            <Checkbox checked={rule.conditions.always} onCheckedChange={(on) => deposit.setDraft({ ...rule, conditions: { always: on, minPeople: on ? null : rule.conditions.minPeople, weekdays: on ? null : rule.conditions.weekdays, timeBand: on ? null : rule.conditions.timeBand } })}>いつも</Checkbox>
          </div>
          <p className={styles.minor}>飲食店のメニュー管理（コース）も同じ段です。残りはお店で払います。</p>
        </>
      ) : null}
    </Card>
  )
}
