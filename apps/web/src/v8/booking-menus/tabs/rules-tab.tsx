'use client'

/* ④ 予約のルール（x1OZS6）。絵に無い設定は「ほかの設定」で開く。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { TimeField } from '@/components/shared/date-time-field'
import Toggle from '@/components/shared/toggle'
import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import { notifyToast } from '@/components/shared/toast'
import { bookingApi, type BookingSettings, type BookingStaff } from '@/lib/api'
import { formatHoursBeforeHint, formatMinutesLengthHint } from '@/lib/format-duration'
import { bookingWindowEnd } from '../lib/format-time'
import { BEFORE_MINUTE_CHOICES, MAX_ACTIVE_CHOICES, WINDOW_DAY_CHOICES, beforeLabel, withCurrent } from '../lib/rule-choices'
import { bookingRulesErrorMessage } from '../lib/menu-validation'
import {
  AccountIcon,
  Band,
  StateCard,
  SkeletonRows,
  useV8TabEdit,
  type LoadStatus,
} from './shared'
import styles from '../settings.module.css'

/* 候補は v7（/booking/menus の BookingRulesEditor）と同じ。 */
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
  return <TextField aria-label={label} value={value} readOnly aria-readonly="true" title={value} className={spaced ? 'mt-1' : undefined} />
}

function RuleNumberFieldV8({ label, unit, min, max, value, onChange, trackEmpty, humanize, readOnly = false }: {
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
    <label className={styles.fieldLabel}>
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input
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
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">{unit}</span>
      </span>
      {hint ? <span className="text-ink-faint mt-1 block text-xs">＝{hint}</span> : null}
    </label>
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
  const [draft, setDraft] = useState<BookingSettings | null>(null)
  /* 「指名なし」を出すか。店舗の保存先は無く、スタッフの is_designation_optional に書く。 */
  const [noAssign, setNoAssign] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [cutoffEmpty, setCutoffEmpty] = useState(false)
  const [cancelEmpty, setCancelEmpty] = useState(false)
  const inFlightRef = useRef(false)

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
  }

  async function submit() {
    if (!draft || inFlightRef.current) return
    const emptyLabels = [
      cutoffEmpty ? '受付の締め切り' : null,
      cancelEmpty ? 'キャンセルの期限' : null,
    ].filter((label): label is string => label !== null)
    if (emptyLabels.length > 0) {
      setSaveError(`「${emptyLabels.join('」「')}」が空欄です。空欄のまま保存できません。直前まで可能にするときは0と入力してください。`)
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const response = await bookingApi.saveSettings(accountId, {
        expectedVersion: draft.version,
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
      })
      if (!response.success) throw new Error('booking_settings_save_failed')
      /* 「指名なし」の切替は全スタッフの is_designation_optional を揃える。 */
      if (noAssign !== null && noAssign !== initialNoAssign) {
        const targets = staff.filter((person) => person.is_active && Boolean(person.is_designation_optional) !== noAssign)
        for (const person of targets) {
          await bookingApi.updateStaff(accountId, person.id, { is_designation_optional: noAssign ? 1 : 0 })
        }
      }
      setDraft(response.data)
      setCutoffEmpty(false)
      setCancelEmpty(false)
      notifyToast('予約のルールを保存しました。')
      onSaved(response.data)
      if (noAssign !== null && noAssign !== initialNoAssign) onReload()
    } catch (cause) {
      setSaveError(bookingRulesErrorMessage(cause, '保存'))
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
  }

  if (status === 'loading' || draft === null) return <SkeletonRows rows={5} />
  if (status === 'error' || !settings) {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="予約のルールを読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }

  const windowOptions = withCurrent(WINDOW_DAY_CHOICES, draft.bookingWindowDays)
    .map((days) => ({ value: String(days), label: `${days} 日先まで` }))
  const cutoffOptions = withCurrent(BEFORE_MINUTE_CHOICES, draft.cutoffMinutesBefore)
    .map((minutes) => ({ value: String(minutes), label: beforeLabel(minutes) }))
  const cancelOptions = withCurrent(BEFORE_MINUTE_CHOICES, draft.cancelDeadlineMinutesBefore)
    .map((minutes) => ({ value: String(minutes), label: beforeLabel(minutes) }))
  const maxOptions = withCurrent(MAX_ACTIVE_CHOICES, draft.maxActiveBookingsPerFriend)
    .map((count) => ({ value: String(count), label: `${count}件` }))
  const dayBeforeText = draft.reminderDayBeforeTime
    ? `前日の ${draft.reminderDayBeforeTime} に送ります`
    : '24時間前に送ります'

  return (
    <div className={styles.tabStack} data-design="Rules">
      {/* 閲覧のみ：選ぶ部品・つまみは置かず、選んでいる値を読み取りだけの欄で見せる（2026-10-06 オーナー決定）。 */}
      <div className="contents">
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>いつまで予約を受けるか</h2>
          </div>
          {/* 絵 x1OZS6：見出しの段と欄の段を分けて3列に並べる。 */}
          <div className={styles.ruleGrid}>
            <span className={styles.ruleHead}>
              先の予約が取れる範囲
              <HelpTip label="先の予約が取れる範囲の説明">今は {bookingWindowEnd(draft.bookingWindowDays)} まで受け付けます。</HelpTip>
            </span>
            <span className={styles.ruleHead}>
              受付の締め切り
              <HelpTip label="受付の締め切りの説明">「直前まで」は開始の直前まで受け付けます。</HelpTip>
            </span>
            <span className={styles.ruleHead}>キャンセルの期限</span>
            {canEdit ? <>
              <Select size="full"
                aria-label="先の予約が取れる範囲"
                value={String(draft.bookingWindowDays)}
                onChange={(value) => set('bookingWindowDays', Number(value))}
                options={windowOptions}
              />
              <Select size="full"
                aria-label="受付の締め切り"
                value={String(draft.cutoffMinutesBefore)}
                onChange={(value) => set('cutoffMinutesBefore', Number(value))}
                options={cutoffOptions}
              />
              <Select size="full"
                aria-label="キャンセルの期限"
                value={String(draft.cancelDeadlineMinutesBefore)}
                onChange={(value) => set('cancelDeadlineMinutesBefore', Number(value))}
                options={cancelOptions}
              />
            </> : <>
              <ReadOnlyText label="先の予約が取れる範囲" value={`${draft.bookingWindowDays} 日先まで`} />
              <ReadOnlyText label="受付の締め切り" value={beforeLabel(draft.cutoffMinutesBefore)} />
              <ReadOnlyText label="キャンセルの期限" value={beforeLabel(draft.cancelDeadlineMinutesBefore)} />
            </>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>予約の受け方</h2>
          </div>
          <div className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>お店が承認してから確定する</span>
            {canEdit ? (
              <Toggle
                label="お店が承認してから確定する"
                checked={draft.approvalMode === 'manual'}
                onChange={(next) => set('approvalMode', next ? 'manual' : 'automatic')}
              />
            ) : <span className="text-sm text-ink-secondary">{draft.approvalMode === 'manual' ? 'オン' : 'オフ'}</span>}
          </div>
          <div className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>{`同じ人の予約は同時に ${draft.maxActiveBookingsPerFriend}件 まで`}</span>
            {canEdit ? (
              <span className={styles.ruleLineSelect}>
                <Select
                  aria-label="同じ人が同時に持てる予約の数"
                  value={String(draft.maxActiveBookingsPerFriend)}
                  onChange={(value) => set('maxActiveBookingsPerFriend', Number(value))}
                  options={maxOptions}
                />
              </span>
            ) : null}
          </div>
          <div className={styles.ruleLine}>
            <span className={styles.ruleLineLabel}>
              「指名なし」を出す
              <HelpTip label="「指名なし」の説明">オンにすると、受付中のスタッフ全員が「指名なし」での予約の対象になります。</HelpTip>
            </span>
            {canEdit ? (
              <Toggle
                label="「指名なし」を出す"
                checked={noAssign ?? initialNoAssign}
                onChange={(next) => setNoAssign(next)}
              />
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
          <div className={styles.ruleFields}>
            <label className={styles.fieldLabel}>
              前日のお知らせを送る時刻
              <span className="mt-1 flex items-center gap-2">
                {canEdit ? (
                  <TimeField
                    aria-label="前日のお知らせを送る時刻"
                    value={draft.reminderDayBeforeTime ?? ''}
                    onChange={(value) => set('reminderDayBeforeTime', value || null)}
                  />
                ) : <ReadOnlyText label="前日のお知らせを送る時刻" value={draft.reminderDayBeforeTime || '未設定'} />}
                <span className="text-ink-faint whitespace-nowrap text-xs">空欄は24時間前</span>
              </span>
            </label>
            <RuleNumberFieldV8 readOnly={!canEdit} label="当日のお知らせ" unit="時間前" min={1} max={72} value={draft.reminderHoursBefore} onChange={(value) => set('reminderHoursBefore', value)} humanize={(value) => formatHoursBeforeHint(value) || null} />
            <RuleNumberFieldV8 readOnly={!canEdit} label="予約枠の間隔" unit="分" min={5} max={60} value={draft.slotGranularityMinutes} onChange={(value) => set('slotGranularityMinutes', value as BookingSettings['slotGranularityMinutes'])} />
            <RuleNumberFieldV8 readOnly={!canEdit} label="仮押さえの保持時間" unit="分" min={1} max={1440} value={draft.holdMinutes} onChange={(value) => set('holdMinutes', value)} humanize={formatMinutesLengthHint} />
            <label className={styles.fieldLabel}>
              タイムゾーン
              {canEdit ? (
                <Select size="full"
                  aria-label="タイムゾーン"
                  value={draft.timeZone}
                  onChange={(value) => set('timeZone', value)}
                  className="mt-1"
                  options={(TIME_ZONE_CHOICES.includes(draft.timeZone)
                    ? TIME_ZONE_CHOICES
                    : [draft.timeZone, ...TIME_ZONE_CHOICES]
                  ).map((zone) => ({ value: zone, label: zone }))}
                />
              ) : <ReadOnlyText label="タイムゾーン" value={draft.timeZone} spaced />}
              {isUnknownTimeZone(draft.timeZone) ? (
                <span className="text-danger mt-1 block text-xs">一覧にないタイムゾーンです。綴りを確認してください（よく使う値: Asia/Tokyo）。</span>
              ) : null}
            </label>
            <label className={styles.fieldLabel}>
              日時を選ぶ画面の最初の形
              {canEdit ? (
                <Select size="full"
                  aria-label="日時を選ぶ画面の最初の形"
                  value={draft.liffDateView ?? 'list'}
                  onChange={(value) => set('liffDateView', value as 'list' | 'calendar')}
                  className="mt-1"
                  options={[
                    { value: 'list', label: '週で見る（日付の横ならび）' },
                    { value: 'calendar', label: 'カレンダー' },
                  ]}
                />
              ) : <ReadOnlyText label="日時を選ぶ画面の最初の形" value={draft.liffDateView === 'calendar' ? 'カレンダー' : '週で見る（日付の横ならび）'} spaced />}
            </label>
          </div>
        </Disclosure>

        {saveError ? (
          <p className="text-danger text-sm" role="alert">
            {saveError}
            {saveError.includes('先に保存') ? (
              <button type="button" className="text-action ml-2 font-semibold underline" onClick={onReload}>最新の内容を読み直す</button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  )
}
