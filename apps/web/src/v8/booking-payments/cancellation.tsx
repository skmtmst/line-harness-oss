'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import type { BookingCancellationPolicy } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import NumberInput from '@/components/shared/number-field'
import Radio from '@/components/shared/radio'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import TextLink from '@/components/shared/text-link'
import { RowMenu } from '@/components/shared/row-actions'
import { Field } from '@/components/shared/form-controls'
import { ApiError } from '@/lib/api'
import { bookingCancellationApi } from '@/lib/api-gap1'
import { gapDraftApi, type CancellationOptions, type DepositRule } from '@/lib/api-gap-draft'
import { isNotReadyError } from '@/lib/api-booking-payment-admin'
import settings from '../booking-menus/settings.module.css'
import styles from './cancellation.module.css'

/*
 * 予約設定 › お支払いの「キャンセル料」と「デポジット（一部前払い）」（B1・絵 FcGmv／つなぐ前は i2iv4g）。
 * キャンセル料の段・無断の率は gap1 の口（bookingCancellationApi・版つき）。
 * カードを登録してもらう条件・請求の仕方・デポジットは口の案（api-gap-draft：口が要る）。無い間は共通の案内の窓で出す。
 * 物差しは「予約の開始の何時間前か」1 つだけ（時刻の物差しは使わない）。段の穴・重なり・100% 超は Worker が断る。
 */

type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'not-ready' } | { state: 'error' }
const SAMPLE_PRICE = 8400
const CARD_LABEL: Record<CancellationOptions['cardRequiredFor'], string> = { all: 'カードの登録：全員', no_show_flagged: 'カードの登録：無断の印がある人だけ', conditions: 'カードの登録：条件で決める' }

const yen = (value: number) => `¥${Math.floor(value).toLocaleString('ja-JP')}`

/** 見本の予約（来週の金曜 14:00・料金 ¥8,400）。お客さまへの文の見本に使う。 */
function sampleStart(): Date {
  const now = new Date(Date.now() + 9 * 3600_000)
  const day = now.getUTCDay()
  const add = ((5 - day + 7) % 7) || 7
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, 14 - 9, 0))
}
function jstLabel(date: Date): string {
  const j = new Date(date.getTime() + 9 * 3600_000)
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}（${'日月火水木金土'[j.getUTCDay()]}）${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}`
}

/** お客さまへ出す文（LIFF・前日・取消の前と同じ形。本物は Worker の同じ関数が作る）。 */
export function policySampleText(policy: Pick<BookingCancellationPolicy, 'tiers' | 'noShowPercent'>, price = SAMPLE_PRICE): string {
  const start = sampleStart()
  const tiers = [...policy.tiers].sort((a, b) => b.beforeHours - a.beforeHours)
  const parts: string[] = []
  for (const tier of tiers) {
    if (tier.percent === 0) parts.push(`${jstLabel(new Date(start.getTime() - tier.beforeHours * 3600_000))} まで無料`)
    else parts.push(`それ以降 料金の ${tier.percent}%（${yen(price * tier.percent / 100)}）`)
  }
  parts.push(`連絡なしの欠席 ${policy.noShowPercent}%（${yen(price * policy.noShowPercent / 100)}）`)
  return parts.join('／')
}

export function useCancellationSettings(accountId: string) {
  const [policy, setPolicy] = useState<Load<BookingCancellationPolicy>>({ state: 'loading' })
  const [draft, setDraft] = useState<BookingCancellationPolicy | null>(null)
  const [options, setOptions] = useState<Load<CancellationOptions>>({ state: 'loading' })
  const [optionsDraft, setOptionsDraft] = useState<CancellationOptions | null>(null)
  const [deposit, setDeposit] = useState<Load<DepositRule>>({ state: 'loading' })
  const [depositDraft, setDepositDraft] = useState<DepositRule | null>(null)
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    let alive = true
    const read = <T,>(call: () => Promise<{ data: T }>, set: (value: Load<T>) => void, setDraftValue: (value: T | null) => void) =>
      Promise.resolve().then(call).then((response) => { if (alive) { set({ state: 'ready', value: response.data }); setDraftValue(response.data) } })
        .catch((cause) => { if (alive) { set({ state: isNotReadyError(cause) ? 'not-ready' : 'error' }); setDraftValue(null) } })
    setPolicy({ state: 'loading' }); setOptions({ state: 'loading' }); setDeposit({ state: 'loading' })
    void read(() => bookingCancellationApi.getPolicy(accountId), setPolicy, setDraft)
    void read(() => gapDraftApi.cancellationOptions(accountId), setOptions, setOptionsDraft)
    void read(() => gapDraftApi.depositRule(accountId), setDeposit, setDepositDraft)
    return () => { alive = false }
  }, [accountId, reloadSeq])

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const dirty = (policy.state === 'ready' && draft !== null && !same(draft, policy.value))
    || (options.state === 'ready' && optionsDraft !== null && !same(optionsDraft, options.value))
    || (deposit.state === 'ready' && depositDraft !== null && !same(depositDraft, deposit.value))

  /** 変えた物だけ送る。版が古いと 409（呼び出し側が「読み直す」を出す）。 */
  const save = useCallback(async () => {
    if (policy.state === 'ready' && draft && !same(draft, policy.value)) {
      const { version, ...body } = draft
      const response = await bookingCancellationApi.savePolicy(accountId, { ...body, expectedVersion: version })
      setPolicy({ state: 'ready', value: response.data }); setDraft(response.data)
    }
    if (options.state === 'ready' && optionsDraft && !same(optionsDraft, options.value)) {
      const { version, ...body } = optionsDraft
      const response = await gapDraftApi.saveCancellationOptions(accountId, { ...body, expectedVersion: version })
      setOptions({ state: 'ready', value: response.data }); setOptionsDraft(response.data)
    }
    if (deposit.state === 'ready' && depositDraft && !same(depositDraft, deposit.value)) {
      const { version, ...body } = depositDraft
      const response = await gapDraftApi.saveDepositRule(accountId, { ...body, expectedVersion: version })
      setDeposit({ state: 'ready', value: response.data }); setDepositDraft(response.data)
    }
  }, [accountId, policy, draft, options, optionsDraft, deposit, depositDraft])

  const reset = () => {
    if (policy.state === 'ready') setDraft(policy.value)
    if (options.state === 'ready') setOptionsDraft(options.value)
    if (deposit.state === 'ready') setDepositDraft(deposit.value)
  }

  return { policy, draft, setDraft, options, optionsDraft, setOptionsDraft, deposit, depositDraft, setDepositDraft, dirty, save, reset, reload: () => setReloadSeq((value) => value + 1) }
}

export type CancellationSettings = ReturnType<typeof useCancellationSettings>

/** 保存の失敗を言葉にする（段の穴・重なり・未接続・本番・版）。 */
export function cancellationSaveError(cause: unknown): string {
  if (!(cause instanceof ApiError)) return '保存できませんでした。もう一度お試しください。'
  if (cause.status === 409 && cause.code === 'payment_not_connected') return '決済をつないでから、キャンセル料をオンにできます。'
  if (cause.status === 409 && cause.code === 'live_mode_not_approved') return '本番の決済は本部の承認のあとで使えます。'
  if (cause.status === 409) return 'ほかの人が先に保存しました。読み直してから、もう一度保存してください。'
  if (cause.status === 400) return '段の間に空き・重なりがあるか、100% を超える値があります。段を見直してください。'
  if (cause.status === 403) return 'この設定を変える権限がありません。'
  return '保存できませんでした。もう一度お試しください。'
}

function tierLabel(tiers: BookingCancellationPolicy['tiers'], index: number): string {
  const tier = tiers[index]
  if (tier.percent === 0) return `予約の開始の ${tier.beforeHours} 時間前まで`
  const previous = tiers[index - 1]
  return previous ? `${previous.beforeHours} 時間前を過ぎてから` : `予約の開始の ${tier.beforeHours} 時間前を過ぎてから`
}

/** キャンセル料の区画（FcGmv）。つなぐ前（i2iv4g）は説明だけ。 */
export function CancellationSection({ state, connected, testMode, canEdit }: { state: CancellationSettings; connected: boolean; testMode: boolean; canEdit: boolean }) {
  const [editing, setEditing] = useState<number | 'new' | 'noshow' | null>(null)
  const head = (
    <div className={styles.head}>
      <h2 className={settings.sectionTitle}>キャンセル料</h2>
      <HelpTip label="キャンセル料の説明">取り消し・無断のときに、予約のときに登録してもらったカードへ請求します。請求は店が［請求する］を押したときだけです（自動の請求は設定でオンにしたときだけ）。</HelpTip>
    </div>
  )
  if (!connected) {
    return (
      <section className={settings.section} aria-label="キャンセル料">
        {head}
        <p className={styles.minor}>決済をつなぐと使えます。取り消し・無断のときに、登録したカードへ店が［請求する］を押して請求します（初めはオフ）。</p>
      </section>
    )
  }
  const draft = state.draft
  const tiers = draft ? [...draft.tiers].sort((a, b) => b.beforeHours - a.beforeHours) : []
  const setTiers = (next: BookingCancellationPolicy['tiers']) => draft && state.setDraft({ ...draft, tiers: next })
  return (
    <section className={settings.section} aria-label="キャンセル料">
      {head}
      {testMode ? <Notice tone="warn" icon={<AlertTriangle size={16} aria-hidden="true" />}>試験モード：本当の請求は起きません（Stripe の試験用の鍵）</Notice> : null}
      {state.policy.state === 'loading' ? <p className={styles.minor}>読み込んでいます…</p>
        : state.policy.state === 'error' || state.policy.state === 'not-ready' || !draft ? (
          <div className={styles.inlineState}><span className={styles.minor}>キャンセル料の決まりを読み込めませんでした。</span><Button size="compact" onClick={state.reload}>もう一度</Button></div>
        ) : (
          <>
            {canEdit ? (
              <label className={styles.switchRow}>
                <input type="checkbox" checked={draft.enabled} onChange={(event) => state.setDraft({ ...draft, enabled: event.target.checked })} />
                <span>キャンセル料を使う</span>
              </label>
            ) : <p className={styles.readValue}>{draft.enabled ? 'キャンセル料を使う' : 'キャンセル料は使わない'}</p>}
            <div className={styles.tierTable} role="table" aria-label="キャンセル料の段">
              <div className={`${styles.tierRow} ${styles.tierHead}`} role="row"><span role="columnheader">いつ取り消したか</span><span role="columnheader">キャンセル料</span><span /></div>
              {tiers.map((tier, index) => (
                <div key={`${tier.beforeHours}-${index}`} className={styles.tierRow} role="row">
                  <span role="cell">{tierLabel(tiers, index)}</span>
                  <span role="cell">{tier.percent === 0 ? '無料' : `料金の ${tier.percent}%`}</span>
                  <span role="cell">{canEdit ? <RowMenu appearance="box" size="row" label={`${tierLabel(tiers, index)}の操作`} items={[
                    { id: 'edit', label: '変える', onSelect: () => setEditing(index) },
                    ...(tiers.length > 1 ? [{ id: 'remove', label: '消す', tone: 'danger' as const, onSelect: () => setTiers(tiers.filter((_, i) => i !== index)) }] : []),
                  ]} /> : null}</span>
                </div>
              ))}
              <div className={styles.tierRow} role="row">
                <span role="cell">連絡なしで来なかった</span>
                <span role="cell">{`料金の ${draft.noShowPercent}%`}</span>
                <span role="cell">{canEdit ? <RowMenu appearance="box" size="row" label="無断の操作" items={[{ id: 'edit', label: '変える', onSelect: () => setEditing('noshow') }]} /> : null}</span>
              </div>
            </div>
            <p className={styles.minor}>物差しは「予約の開始の何時間前か」1 つだけです。段の間に空き・重なりがあると保存できません。100% を超える値は入れられません。</p>
            {canEdit && tiers.length < 3 ? <Button variant="text" textTone="ink" onClick={() => setEditing('new')}><Plus size={15} aria-hidden="true" />段を足す</Button> : null}
          </>
        )}
      <h3 className={styles.subTitle}>カードを登録してもらう条件</h3>
      {state.optionsDraft && !canEdit ? <p className={styles.readValue}>{CARD_LABEL[state.optionsDraft.cardRequiredFor]}</p> : state.optionsDraft ? (
        <RadioCardGroup legend="カードを登録してもらう条件" columns={3}>
          {([
            ['no_show_flagged', '無断の印がある人だけ', '前に連絡なしで来なかった人'],
            ['all', '全員（おすすめ）', '予約のたびに登録してもらう'],
            ['conditions', '条件で決める', '人数・メニューで決める'],
          ] as const).map(([value, title, note]) => (
            <RadioCard key={value} name="card-required-for" value={value} title={title} note={note}
              checked={state.optionsDraft?.cardRequiredFor === value} onChange={() => state.optionsDraft && state.setOptionsDraft({ ...state.optionsDraft, cardRequiredFor: value })} />
          ))}
        </RadioCardGroup>
      ) : <p className={styles.minor}>カードを登録してもらう条件と請求の仕方は、データの準備が済むと決められます（今は全員・店が［請求する］を押す）。</p>}
      <h3 className={styles.subTitle}>請求の仕方</h3>
      {!canEdit ? <p className={styles.readValue}>{state.optionsDraft?.chargeMode === 'auto' ? '自動で請求する' : '店が［請求する］を押す'}</p> : (
      <div className={styles.inline} role="radiogroup" aria-label="請求の仕方">
        <Radio name="charge-mode" checked={(state.optionsDraft?.chargeMode ?? 'manual') === 'manual'} disabled={!state.optionsDraft} onChange={() => state.optionsDraft && state.setOptionsDraft({ ...state.optionsDraft, chargeMode: 'manual' })}>店が［請求する］を押す（おすすめ）</Radio>
        <Radio name="charge-mode" checked={state.optionsDraft?.chargeMode === 'auto'} disabled={!state.optionsDraft} onChange={() => state.optionsDraft && state.setOptionsDraft({ ...state.optionsDraft, chargeMode: 'auto' })}>自動で請求する</Radio>
      </div>)}
      {draft ? <p className={styles.minor}>{`お客さまの確認画面・前日のリマインド・取り消しの前に、同じ文で出ます：「${policySampleText(draft)}」`}</p> : null}
      <TierDialog editing={editing} tiers={tiers} noShowPercent={draft?.noShowPercent ?? 100} onClose={() => setEditing(null)}
        onApply={(next) => { if (!draft) return; if (editing === 'noshow') state.setDraft({ ...draft, noShowPercent: next.percent }); else if (editing === 'new') setTiers([...tiers, next]); else if (typeof editing === 'number') setTiers(tiers.map((tier, index) => (index === editing ? next : tier))); setEditing(null) }} />
    </section>
  )
}

function TierDialog({ editing, tiers, noShowPercent, onClose, onApply }: { editing: number | 'new' | 'noshow' | null; tiers: BookingCancellationPolicy['tiers']; noShowPercent: number; onClose: () => void; onApply: (tier: { beforeHours: number; percent: number }) => void }) {
  const current = typeof editing === 'number' ? tiers[editing] : null
  const [hours, setHours] = useState('')
  const [percent, setPercent] = useState('')
  useEffect(() => {
    if (editing === null) return
    setHours(current ? String(current.beforeHours) : editing === 'new' ? '0' : '0')
    setPercent(editing === 'noshow' ? String(noShowPercent) : current ? String(current.percent) : '')
  }, [editing, current, noShowPercent])
  const h = Number(hours), p = Number(percent)
  const valid = Number.isInteger(p) && p >= 0 && p <= 100 && (editing === 'noshow' || (Number.isInteger(h) && h >= 0 && h <= 336))
  return (
    <Dialog open={editing !== null} title={editing === 'noshow' ? '無断のときのキャンセル料' : editing === 'new' ? '段を足す' : '段を変える'} size="small" contentLayout="form"
      cancelLabel="キャンセル" onCancel={onClose} confirmLabel="決める" confirmDisabled={!valid} onConfirm={() => onApply({ beforeHours: editing === 'noshow' ? 0 : h, percent: p })}>
      <div className={styles.dialogBody}>
        {editing !== 'noshow' ? <Field label="予約の開始の何時間前から"><NumberInput aria-label="何時間前" unit="時間前" type="number" min={0} max={336} value={hours} onChange={(event) => setHours(event.target.value)} /></Field> : null}
        <Field label="料金の何 %"><NumberInput aria-label="キャンセル料の率" unit="%" type="number" min={0} max={100} value={percent} onChange={(event) => setPercent(event.target.value)} /></Field>
        <p className={styles.minor}>保存のときに、段の間に空き・重なりが無いかを確かめます。</p>
      </div>
    </Dialog>
  )
}

/** デポジットの区画（FcGmv の下）。口の案（口が要る）。 */
export function DepositSection({ state, connected, canEdit }: { state: CancellationSettings; connected: boolean; canEdit: boolean }) {
  const head = (
    <div className={styles.head}>
      <h2 className={settings.sectionTitle}>デポジット（一部前払い）</h2>
      <HelpTip label="デポジットの説明">予約のときに料金の一部を先に払ってもらい、来店の日に料金から引きます。期限後の取り消し・無断はキャンセル料に充てます。</HelpTip>
    </div>
  )
  if (!connected) {
    return <section className={settings.section} aria-label="デポジット">{head}<p className={styles.minor}>決済をつなぐと使えます。予約のときに料金の一部を先に払ってもらい、来店の日に料金から引きます。</p></section>
  }
  const rule = state.depositDraft
  const set = (patch: Partial<DepositRule>) => rule && state.setDepositDraft({ ...rule, ...patch })
  const now = rule && rule.kind !== 'none' && rule.value ? (rule.kind === 'percent' ? Math.floor(SAMPLE_PRICE * rule.value / 100) : Math.min(rule.value, SAMPLE_PRICE)) : null
  return (
    <section className={settings.section} aria-label="デポジット">
      {head}
      {!rule ? <p className={styles.minor}>デポジットは、データの準備が済むと決められます。</p> : !canEdit ? (
        <p className={styles.readValue}>{rule.kind === 'none' ? 'デポジット：なし' : rule.kind === 'percent' ? `デポジット：料金の ${rule.value ?? 0}%` : `デポジット：${yen(rule.value ?? 0)}`}</p>
      ) : (
        <>
          <div className={styles.inline} role="radiogroup" aria-label="デポジット">
            {([['none', 'なし'], ['amount', '金額（¥）'], ['percent', '料金の %']] as const).map(([kind, label]) => (
              <Radio key={kind} name="deposit-kind" checked={rule.kind === kind} onChange={() => set({ kind, value: kind === 'none' ? null : rule.value })}>{label}</Radio>
            ))}
          </div>
          {rule.kind !== 'none' ? (
            <div className={styles.depositRow}>
              <Field label={rule.kind === 'percent' ? '料金の %' : '金額'}>
                <NumberInput aria-label={rule.kind === 'percent' ? 'デポジットの率' : 'デポジットの金額'} unit={rule.kind === 'percent' ? '%' : '円'} type="number" min={1} max={rule.kind === 'percent' ? 100 : undefined}
                  value={rule.value ?? ''} onChange={(event) => set({ value: event.target.value === '' ? null : Number(event.target.value) })} />
              </Field>
              <span className={styles.depositCondition}>
                <Select aria-label="掛ける条件" value={rule.conditions.always ? 'always' : rule.conditions.minPeople ? 'people' : 'always'}
                  onChange={(value) => set({ conditions: { ...rule.conditions, always: value === 'always', minPeople: value === 'people' ? rule.conditions.minPeople ?? 4 : null } })}
                  options={[{ value: 'always', label: '掛ける条件：常に' }, { value: 'people', label: '掛ける条件：人数が多いとき' }]} />
              </span>
            </div>
          ) : null}
          {now !== null ? <p className={styles.minor}>{`見本：料金 ${yen(SAMPLE_PRICE)} → 今お支払い ${yen(now)} ／ お店で ${yen(SAMPLE_PRICE - now)}（1 円未満は切り捨て）。デポジットはキャンセル料に充てます。キャンセル料はデポジット以上にしてください。`}</p> : null}
        </>
      )}
    </section>
  )
}

/** 決済のつなぎ（FcGmv・i2iv4g の上の小さな区画）。 */
export function ConnectionCard({ connected, testMode, checkedAt, canEdit, busy, onConnect }: { connected: boolean; testMode: boolean; checkedAt: string | null; canEdit: boolean; busy: boolean; onConnect: () => void }) {
  return (
    <section className={settings.section} aria-label="決済のつなぎ">
      <div className={styles.head}>
        <h2 className={settings.sectionTitle}>決済のつなぎ</h2>
        <HelpTip label="決済のつなぎの説明">お客さまのカード番号は Stripe の画面で入れてもらいます。お店にも musubo にも残りません。</HelpTip>
      </div>
      <div className={styles.connectRow}>
        <span className={styles.connectText}>
          <strong>Stripe</strong>
          <span className={styles.minor}>{connected ? `${testMode ? '試験モードで' : ''}つながっています${checkedAt ? `・最後に確かめた ${checkedAt}` : ''}` : 'まだつないでいません。つなぐと、キャンセル料とデポジットを使えます'}</span>
        </span>
        {connected ? <StatusBadge tone="success">つながっている</StatusBadge>
          : canEdit ? <Button variant="primary" busy={busy} onClick={onConnect}>決済をつなぐ</Button> : null}
      </div>
      {/* 記録・届いた知らせへの入口（絵 FcGmv に無い。前の右の欄 T91bV から移した＝絵を直す）。 */}
      {connected ? <p className={styles.links}><TextLink href="/booking/menus?tab=payments&view=records">お支払いの記録を見る</TextLink><TextLink href="/booking/menus?tab=payments&view=events">Stripe から届いた知らせを見る</TextLink></p> : null}
    </section>
  )
}
