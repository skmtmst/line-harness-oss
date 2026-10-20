'use client'
import { notifySaved } from '@/components/shared/toast'
import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Link from 'next/link'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { TimeField } from '@/components/shared/date-time-field'
import Toggle from '@/components/shared/toggle'
import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import { bookingApi, type BookingSettings, type BookingStaff } from '@/lib/api'
import { formatHoursBeforeHint, formatMinutesLengthHint } from '@/lib/format-duration'
import { bookingWindowEnd } from '../lib/format-time'
import { BEFORE_MINUTE_CHOICES, MAX_ACTIVE_CHOICES, WINDOW_DAY_CHOICES, beforeLabel, withCurrent } from '../lib/rule-choices'
import { bookingRulesErrorMessage } from '../lib/menu-validation'
import { AccountIcon, Band, StateCard, SkeletonRows, useV8TabEdit, type LoadStatus } from './shared'
import styles from '../settings.module.css'
import { ruleNumberRequirements } from '../lib/rule-number-requirements'
import { focusFieldById } from '@/lib/use-form-errors'
import { Field } from '@/components/shared/form-controls'
import { SettingsFormRow } from '@/components/shared/settings-form-card'
import { emptyValue } from '@/components/shared/empty-value'
import NumberInput from '@/components/shared/number-field'
import SaveFeedback, { useSaveFeedback } from '@/components/shared/save-feedback'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import Notice from '@/components/shared/notice'

/* ④ 予約のルール。絵に無い設定は「ほかの設定」で開く。 */

/* 候補は 管理画面（/booking/menus の BookingRulesEditor）と同じ。 */
const TIME_ZONE_CHOICES = [
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Australia/Sydney',
  'Pacific/Auckland',
]

function isUnknownTimeZone(zone: string): boolean {
  if (TIME_ZONE_CHOICES.includes(zone)) return false
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supportedValuesOf !== 'function') return false
    return !supportedValuesOf.call(Intl, 'timeZone').includes(zone)
  } catch {
    return false
  }
}

/** 閲覧のみ：選ぶ部品・つまみの代わりに、選んでいる値を読み取りだけの欄で見せる（2026-10-06 オーナー決定）。 */
function ReadOnlyText({ label, value, spaced = false }: { label: string; value: string; spaced?: boolean }) {
  return <SaveErrorField names={["value"]}><TextField aria-label={label} value={value} readOnly aria-readonly="true" title={value} className={spaced ? 'mt-1' : undefined} /></SaveErrorField>
}

function RuleNumberFieldV8({ name, error, label, unit, min, max, value, onChange, trackEmpty, humanize, readOnly = false }: {
  name: keyof typeof ruleNumberRequirements
  error?: string
  label: string
  unit: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
  trackEmpty?: (empty: boolean) => void
  humanize?: (value: number) => string | null
  /** 閲覧のみ：数は見せるが変えられない。 */
  readOnly?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  const trackEmptyRef = useRef(trackEmpty)
  trackEmptyRef.current = trackEmpty
  const lastValueRef = useRef(value)
  useEffect(() => {
    if (lastValueRef.current !== value) {
      lastValueRef.current = value
      setText(null)
      trackEmptyRef.current?.(false)
    }
  }, [value])
  const shown = text ?? value
  const hintNumber = typeof shown === 'number'
    ? shown
    : typeof shown !== 'string' || shown.trim() === ''
      ? null
      : Number(shown)
  const hint = hintNumber === null || Number.isNaN(hintNumber) ? null : humanize?.(hintNumber)
  return (
    <Field label={<>{label}</>} htmlFor={`booking-rule-${name}`} requirement={ruleNumberRequirements[name]} error={error}><span className="mt-1 flex items-center gap-2">
        <SaveErrorField names={[name, name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), "shown","text"]}><NumberInput id={`booking-rule-${name}`} unit={unit}
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={shown ?? ''}
          readOnly={readOnly}
          onChange={(event) => {
            const raw = event.target.value
            if (!trackEmpty) {
              onChange(Number(raw))
              return
            }
            setText(raw)
            trackEmpty(raw === '')
            if (raw !== '') onChange(Number(raw))
          }}
          className={styles.numInput}
        /></SaveErrorField>

      </span>
{hint ? <span className="text-ink-faint mt-1 block text-xs">＝{hint}</span> : null}</Field>
  )
}

export function RulesTabV8({ accountId, settings, status, error, staff, staffReady, canEdit, onSaved, onReload }: {
  accountId: string
  settings: BookingSettings | null
  status: LoadStatus
  error: string | null
  staff: BookingStaff[]
  /** スタッフ一覧の読み込みが終わっているか。「指名なし」の切替はスタッフに書く。 */
  staffReady: boolean
  canEdit: boolean
  onSaved: (settings: BookingSettings) => void
  onReload: () => void
}) {
  const saveErrors = useSaveFormErrors()
  const feedback = useSaveFeedback()
  const completedRules = useRef<{ accountId: string; payload: string; settings: BookingSettings } | null>(null)
  const [draft, setDraft] = useState<BookingSettings | null>(null)
  /* 「指名なし」を出すか。店舗の保存先は無く、スタッフの is_designation_optional に書く。 */
  const [noAssign, setNoAssign] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cutoffEmpty, setCutoffEmpty] = useState(false)
  const [cancelEmpty, setCancelEmpty] = useState(false)
  const [numberErrors, setNumberErrors] = useState<Record<string, string>>({})
  const inFlightRef = useRef(false)
  const saveGenerationRef = useRef(0)
  useEffect(() => {
    setSaving(false)
    inFlightRef.current = false
    return () => { saveGenerationRef.current += 1 }
  }, [accountId])
  const savedStaff = useRef(new Map<string, boolean>())
  useEffect(() => { savedStaff.current.clear() }, [accountId])

  const initialNoAssign = useMemo(
    () => staff.some((person) => person.is_active && person.is_designation_optional),
    [staff],
  )

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])
  useEffect(() => {
    if (staffReady) setNoAssign(initialNoAssign)
  }, [staffReady, initialNoAssign])

  const dirty = draft !== null && settings !== null && (
    JSON.stringify(draft) !== JSON.stringify(settings)
    || cutoffEmpty
    || cancelEmpty
    || (noAssign !== null && noAssign !== initialNoAssign)
  )

  useV8TabEdit({
    dirty,
    saving,
    subject: '予約のルールへの変更',
    saveLabel: settings?.version === 0 ? 'ルールを作る' : 'ルールを保存',
    saveDisabled: !canEdit,
    onSave: () => void submit(),
    onReset: () => {
      if (settings) setDraft(settings)
      setNoAssign(initialNoAssign)
      setCutoffEmpty(false)
      setCancelEmpty(false)
      setSaveError(null)
    },
  })

  function set<K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    if (key in ruleNumberRequirements) setNumberErrors(current => { const next = { ...current }; delete next[key]; return next })
  }

  async function submit() {
    if (!draft || inFlightRef.current || !canEdit) return
    const generation = saveGenerationRef.current
    const alive = () => saveGenerationRef.current === generation
    const numericProblems = Object.fromEntries((Object.keys(ruleNumberRequirements) as Array<keyof typeof ruleNumberRequirements>).flatMap(name => {
      const reason = ruleNumberRequirements[name].check(draft[name])
      return reason ? [[name, reason]] : []
    }))
    setNumberErrors(numericProblems)
    if (Object.keys(numericProblems).length) { focusFieldById(`booking-rule-${Object.keys(numericProblems)[0]}`); return }
    const emptyLabels = [
      cutoffEmpty ? '受付の締め切り' : null,
      cancelEmpty ? 'キャンセルの期限' : null,
    ].filter((label): label is string => label !== null)
    if (emptyLabels.length > 0) {
      setSaveError(`「${emptyLabels.join('」「')}」が空欄です。空欄のまま保存できません。直前まで可能にするときは0と入力してください。`)
      return
    }
    if (!feedback.begin('予約のルール')) return
    inFlightRef.current = true
    setSaving(true)
    setSaveError(null)
    let settingsSaved = false
    const completedSteps: string[] = []
    const remainingSteps = ['予約のルール']
    try {
      const payload = {
        timeZone: draft.timeZone.trim(),
        bookingWindowDays: draft.bookingWindowDays,
        cutoffMinutesBefore: draft.cutoffMinutesBefore,
        cancelDeadlineMinutesBefore: draft.cancelDeadlineMinutesBefore,
        maxActiveBookingsPerFriend: draft.maxActiveBookingsPerFriend,
        approvalMode: draft.approvalMode,
        holdMinutes: draft.holdMinutes,
        slotGranularityMinutes: draft.slotGranularityMinutes,
        liffDateView: draft.liffDateView ?? 'list',
        reminderDayBeforeTime: draft.reminderDayBeforeTime || null,
        reminderHoursBefore: draft.reminderHoursBefore,
      }
      const payloadKey = JSON.stringify(payload)
      const previous = completedRules.current
      const response = previous?.accountId === accountId && previous.payload === payloadKey
        ? { success: true as const, data: previous.settings }
        : await bookingApi.saveSettings(accountId, { ...payload, expectedVersion: draft.version })
      if (!alive()) return
      if (!response.success) throw new Error('booking_settings_save_failed')
      completedRules.current = { accountId, payload: payloadKey, settings: response.data }
      setDraft(response.data)
      settingsSaved = true
      completedSteps.push('予約のルール')
      remainingSteps[0] = '残った担当の設定'
      /* 「指名なし」の切替は全スタッフの is_designation_optional を揃える。 */
      if (noAssign !== null && noAssign !== initialNoAssign) {
        const targets = staff.filter((person) => person.is_active && (savedStaff.current.get(person.id) ?? Boolean(person.is_designation_optional)) !== noAssign)
        for (const person of targets) {
          if (!alive()) return
          const updated = await bookingApi.updateStaff(accountId, person.id, { is_designation_optional: noAssign ? 1 : 0 })
          if (!updated.ok) throw new Error('担当の設定を保存できませんでした')
          if (!alive()) return
          savedStaff.current.set(person.id, noAssign)
          completedSteps.push(person.display_name)
        }
      }
      if (!alive()) return
      setDraft(response.data)
      setCutoffEmpty(false)
      setCancelEmpty(false)
      feedback.success('予約のルールと担当の設定')
      notifySaved('予約のルールを保存しました。')
      onSaved(response.data)
      if (noAssign !== null && noAssign !== initialNoAssign) onReload()
    } catch (cause) {
      if (!alive()) return
      feedback.failure(bookingRulesErrorMessage(cause, '保存'), completedSteps, remainingSteps)
      const fieldFailure = saveErrors.capture(cause)

      { if (!fieldFailure)
      setSaveError(settingsSaved ? `ルールは保存しました。担当の更新を完了できませんでした。もう一度保存すると、残った担当だけ更新します。${bookingRulesErrorMessage(cause, '保存')}` : bookingRulesErrorMessage(cause, '保存')) }
    } finally {
      if (alive()) {
        inFlightRef.current = false
        setSaving(false)
      }
    }
  }

  // WEB053：失敗を先に見る。draft は成功したときだけできるので、失敗が「読み込み中」のまま残らないように。
  if (status === 'error' || (status !== 'loading' && !settings)) {
    return (
      <SaveErrorScope errors={saveErrors}><StateCard
        icon={<AccountIcon />}
        title="予約のルールを読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>もう一度読み込む</Button>}
      /></SaveErrorScope>
    )
  }

  if (status === 'loading' || draft === null) return <SaveErrorScope errors={saveErrors}><SkeletonRows rows={5} /></SaveErrorScope>

  const windowOptions = withCurrent(WINDOW_DAY_CHOICES, draft.bookingWindowDays)
    .map((days) => ({ value: String(days), label: `${days} 日先まで` }))
  const cutoffOptions = withCurrent(BEFORE_MINUTE_CHOICES, draft.cutoffMinutesBefore)
    .map((minutes) => ({ value: String(minutes), label: beforeLabel(minutes) }))
  const cancelOptions = withCurrent(BEFORE_MINUTE_CHOICES, draft.cancelDeadlineMinutesBefore)
    .map((minutes) => ({ value: String(minutes), label: beforeLabel(minutes) }))
  const maxOptions = withCurrent(MAX_ACTIVE_CHOICES, draft.maxActiveBookingsPerFriend)
    .map((count) => ({ value: String(count), label: `${count} 件` }))
  const dayBeforeText = draft.reminderDayBeforeTime
    ? `前日の ${draft.reminderDayBeforeTime} に送ります`
    : '24時間前に送ります'

  return (
    <SaveErrorScope errors={saveErrors}><div className={styles.tabStack} data-design="Rules">
      <SaveFeedback state={feedback.state} onRetry={saveError?.includes('先に保存') ? () => { feedback.reset(); onReload() } : submit} retryLabel={saveError?.includes('先に保存') ? '最新の内容を読み直す' : undefined} />
      {/* 閲覧のみ：選ぶ部品・つまみは置かず、選んでいる値を読み取りだけの欄で見せる（2026-10-06 オーナー決定）。 */}
      <div className="contents">
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>いつまで予約を受けるか</h2>
          </div>
          <SettingsFormRow layout="columns" columns={3}>
            <Field label="先の予約が取れる範囲" optional={false} help={<>今は {bookingWindowEnd(draft.bookingWindowDays)} まで受け付けます。</>}>
              {canEdit ? <SaveErrorField names={["bookingWindowDays","draft.bookingWindowDays","booking_window_days","draft.booking_window_days"]}><Select size="full"
                aria-label="先の予約が取れる範囲"
                value={String(draft.bookingWindowDays)}
                onChange={(value) => set('bookingWindowDays', Number(value))}
                options={windowOptions}
              /></SaveErrorField> : <ReadOnlyText label="先の予約が取れる範囲" value={`${draft.bookingWindowDays} 日先まで`} />}
            </Field>
            <Field label="受付の締め切り" optional={false} help="「直前まで」は開始の直前まで受け付けます。">
              {canEdit ? <SaveErrorField names={["cutoffMinutesBefore","draft.cutoffMinutesBefore","cutoff_minutes_before","draft.cutoff_minutes_before"]}><Select size="full"
                aria-label="受付の締め切り"
                value={cutoffEmpty ? '' : String(draft.cutoffMinutesBefore)}
                onChange={(value) => {
                  setCutoffEmpty(value === '')
                  if (value !== '') set('cutoffMinutesBefore', Number(value))
                }}
                options={cutoffOptions}
              /></SaveErrorField> : <ReadOnlyText label="受付の締め切り" value={beforeLabel(draft.cutoffMinutesBefore)} />}
            </Field>
            <Field label="キャンセルの期限" optional={false}>
              {canEdit ? <SaveErrorField names={["cancelDeadlineMinutesBefore","draft.cancelDeadlineMinutesBefore","cancel_deadline_minutes_before","draft.cancel_deadline_minutes_before"]}><Select size="full"
                aria-label="キャンセルの期限"
                value={cancelEmpty ? '' : String(draft.cancelDeadlineMinutesBefore)}
                onChange={(value) => {
                  setCancelEmpty(value === '')
                  if (value !== '') set('cancelDeadlineMinutesBefore', Number(value))
                }}
                options={cancelOptions}
              /></SaveErrorField> : <ReadOnlyText label="キャンセルの期限" value={beforeLabel(draft.cancelDeadlineMinutesBefore)} />}
            </Field>
          </SettingsFormRow>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>予約の受け方</h2>
          </div>
          <div className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>お店が承認してから確定する</span>
            {canEdit ? (
              <SaveErrorField names={["approvalMode","draft.approvalMode","approval_mode","draft.approval_mode"]}><Toggle
                label="お店が承認してから確定する"
                checked={draft.approvalMode === 'manual'}
                onChange={(next) => set('approvalMode', next ? 'manual' : 'automatic')}
              /></SaveErrorField>
            ) : <span className="text-sm text-ink-secondary">{draft.approvalMode === 'manual' ? 'オン' : 'オフ'}</span>}
          </div>
          <div className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>{`同じ人の予約は同時に ${draft.maxActiveBookingsPerFriend} 件 まで`}</span>
            {canEdit ? (
              <span className={styles.ruleLineSelect}>
                <SaveErrorField names={["maxActiveBookingsPerFriend","draft.maxActiveBookingsPerFriend","max_active_bookings_per_friend","draft.max_active_bookings_per_friend"]}><Select
                  aria-label="同じ人が同時に持てる予約の数"
                  value={String(draft.maxActiveBookingsPerFriend)}
                  onChange={(value) => set('maxActiveBookingsPerFriend', Number(value))}
                  options={maxOptions}
                /></SaveErrorField>
              </span>
            ) : null}
          </div>
          <div className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>
              「指名なし」を出す
              <HelpTip label="「指名なし」の説明">オンにすると、受付中のスタッフ全員が「指名なし」での予約の対象になります。</HelpTip>
            </span>
            {canEdit ? (
              <SaveErrorField names={["noAssign","initialNoAssign","no_assign","initial_no_assign"]}><Toggle
                label="「指名なし」を出す"
                checked={noAssign ?? initialNoAssign}
                onChange={(next) => setNoAssign(next)}
              /></SaveErrorField>
            ) : <span className="text-sm text-ink-secondary">{(noAssign ?? initialNoAssign) ? 'オン' : 'オフ'}</span>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>お知らせ</h2>
            <p className={styles.sectionDesc}>予約・変更・キャンセルをLINEで送ります</p>
          </div>
          <div className={styles.noticeRow}>
            <span className={styles.noticeWhen}>予約を受けたとき</span>
            <span className={styles.noticeWhat}>お客さまのLINEへ自動で送ります</span>
          </div>
          <div className={styles.noticeRow}>
            <span className={styles.noticeWhen}>承認したとき</span>
            <span className={styles.noticeWhat}>お客さまのLINEへ自動で送ります</span>
          </div>
          <div className={styles.noticeRow}>
            <span className={styles.noticeWhen}>前日</span>
            <span className={styles.noticeWhat}>{dayBeforeText}</span>
          </div>
        </section>

        <Band tone="hint">メニューごとに変えたいときは、メニューの中身から「このメニューだけ変える」。</Band>

        {/* 絵に無いが機能がある欄（送る時刻・当日・枠の間隔・仮押さえ・タイムゾーン・日時の最初の形）は「ほかの設定」で開く。 */}
        <Disclosure title="ほかの設定（お知らせの時刻・予約枠の間隔・仮押さえ・タイムゾーン・日時の最初の形）">
          <SettingsFormRow layout="columns" columns={3}>
            <Field label="前日のお知らせを送る時刻"><span className="mt-1 flex items-center gap-2">
                {canEdit ? (
                  <SaveErrorField names={["reminderDayBeforeTime","draft.reminderDayBeforeTime","reminder_day_before_time","draft.reminder_day_before_time"]}><TimeField
                    aria-label="前日のお知らせを送る時刻"
                    value={draft.reminderDayBeforeTime ?? ''}
                    onChange={(value) => set('reminderDayBeforeTime', value || null)}
                  /></SaveErrorField>
                ) : <ReadOnlyText label="前日のお知らせを送る時刻" value={draft.reminderDayBeforeTime || emptyValue('unconfigured')} />}
                <span className="text-ink-faint whitespace-nowrap text-xs">空欄は24時間前</span>
              </span></Field>
            <RuleNumberFieldV8 name="reminderHoursBefore" error={numberErrors.reminderHoursBefore} readOnly={!canEdit} label="当日のお知らせ" unit="時間前" min={1} max={72} value={draft.reminderHoursBefore} onChange={(value) => set('reminderHoursBefore', value)} humanize={(value) => formatHoursBeforeHint(value) || null} />
            <RuleNumberFieldV8 name="slotGranularityMinutes" error={numberErrors.slotGranularityMinutes} readOnly={!canEdit} label="予約枠の間隔" unit="分" min={5} max={60} value={draft.slotGranularityMinutes} onChange={(value) => set('slotGranularityMinutes', value as BookingSettings['slotGranularityMinutes'])} />
            <RuleNumberFieldV8 name="holdMinutes" error={numberErrors.holdMinutes} readOnly={!canEdit} label="仮押さえの保持時間" unit="分" min={1} max={1440} value={draft.holdMinutes} onChange={(value) => set('holdMinutes', value)} humanize={formatMinutesLengthHint} />
            <Field label="タイムゾーン">{canEdit ? (
                <SaveErrorField names={["timeZone","draft.timeZone","time_zone","draft.time_zone"]}><Select size="full"
                  aria-label="タイムゾーン"
                  value={draft.timeZone}
                  onChange={(value) => set('timeZone', value)}
                  className="mt-1"
                  options={(TIME_ZONE_CHOICES.includes(draft.timeZone)
                    ? TIME_ZONE_CHOICES
                    : [draft.timeZone, ...TIME_ZONE_CHOICES]
                  ).map((zone) => ({ value: zone, label: zone }))}
                /></SaveErrorField>
              ) : <ReadOnlyText label="タイムゾーン" value={draft.timeZone} spaced />}
{isUnknownTimeZone(draft.timeZone) ? (
                <span className="text-danger mt-1 block text-xs">一覧にないタイムゾーンです。綴りを確認してください（よく使う値: Asia/Tokyo）。</span>
              ) : null}</Field>
            <Field label="日時を選ぶ画面の最初の形">{canEdit ? (
                <SaveErrorField names={["liffDateView","draft.liffDateView","liff_date_view","draft.liff_date_view"]}><Select size="full"
                  aria-label="日時を選ぶ画面の最初の形"
                  value={draft.liffDateView ?? 'list'}
                  onChange={(value) => set('liffDateView', value as 'list' | 'calendar')}
                  className="mt-1"
                  options={[
                    { value: 'list', label: '週で見る（日付の横ならび）' },
                    { value: 'calendar', label: 'カレンダー' },
                  ]}
                /></SaveErrorField>
              ) : <ReadOnlyText label="日時を選ぶ画面の最初の形" value={draft.liffDateView === 'calendar' ? 'カレンダー' : '週で見る（日付の横ならび）'} spaced />}</Field>
            <Notice tone="info">お客さまの画面の色と書体は、すべての画面で共通です。<Link href="/settings/customer-look">お客さまのデザインを開く ↗</Link></Notice>
          </SettingsFormRow>
        </Disclosure>

        {saveError && feedback.state.kind === 'idle' ? (
          <Notice tone="danger" >{saveError}
            {saveError.includes('先に保存') ? (
              <button type="button" className="text-action ml-2 font-semibold underline" onClick={onReload}>最新の内容を読み直す</button>
            ) : null}</Notice>
        ) : null}
      </div>
    </div></SaveErrorScope>
  )
}
