'use client'

/* ② 受付枠（yRPxl）（settings-v8.tsx から分割。見た目・動きは変えない） */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import DateField from '@/components/shared/date-field'
import HelpTip from '@/components/shared/help-tip'
import { TimeField } from '@/components/shared/date-time-field'
import Toggle from '@/components/shared/toggle'
import { RowMenu } from '@/components/shared/row-actions'
import { notifyToast } from '@/components/shared/toast'
import { ApiError, bookingApi, type BookingMenu, type BookingResource, type BookingSettings, type BookingSlotCheckResult, type BookingStaff } from '@/lib/api'
import { slotReasonLabel } from '../lib/slot-reason'
import {
  AccountIcon,
  Band,
  DAYS,
  StateCard,
  SkeletonRows,
  useV8TabEdit,
  type BusinessHourInterval,
  type BusinessHoursDay,
  type LoadStatus,
} from './shared'
import styles from '../settings.module.css'

export function HoursTabV8({ accountId, settings, settingsStatus, settingsError, resources, resourcesStatus, resourcesError, canEdit, menus, onSaved, onReload, onResourceSaved, onResourceCreated, onResourceDeleted, onResourcesRetry }: {
  accountId: string
  settings: BookingSettings | null
  settingsStatus: LoadStatus
  settingsError: string | null
  resources: BookingResource[] | null
  resourcesStatus: LoadStatus
  resourcesError: string | null
  canEdit: boolean
  menus: BookingMenu[]
  onSaved: (settings: BookingSettings) => void
  onReload: () => void
  onResourceSaved: (resource: BookingResource) => void
  onResourceCreated: (resource: BookingResource) => void
  onResourceDeleted: (id: string) => void
  onResourcesRetry: () => void
}) {
  const [draft, setDraft] = useState<BusinessHoursDay[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [addingResource, setAddingResource] = useState(false)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (settings) setDraft(initialBusinessHours(settings))
  }, [settings])

  const dirty = draft !== null && settings !== null
    && JSON.stringify(draft) !== JSON.stringify(initialBusinessHours(settings))

  useV8TabEdit({
    dirty,
    saving,
    subject: '受付時間への変更',
    saveLabel: settings?.version === 0 ? '受付枠を作る' : '開ける時間を保存',
    saveDisabled: !canEdit,
    onSave: () => void submit(),
    onReset: () => { if (settings) { setDraft(initialBusinessHours(settings)); setSaveError(null) } },
  })

  function updateDay(weekday: number, update: (intervals: BusinessHourInterval[]) => BusinessHourInterval[]) {
    setDraft((current) => current?.map((day) => day.weekday === weekday
      ? { ...day, intervals: update(day.intervals) }
      : day) ?? current)
    setSaveError(null)
  }

  async function submit() {
    if (!settings || !draft || inFlightRef.current) return
    const validationError = validateBusinessHours(draft)
    if (validationError) {
      setSaveError(validationError)
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const response = await bookingApi.saveSettings(accountId, {
        expectedVersion: settings.version,
        timeZone: settings.timeZone,
        bookingWindowDays: settings.bookingWindowDays,
        cutoffMinutesBefore: settings.cutoffMinutesBefore,
        cancelDeadlineMinutesBefore: settings.cancelDeadlineMinutesBefore,
        maxActiveBookingsPerFriend: settings.maxActiveBookingsPerFriend,
        approvalMode: settings.approvalMode,
        holdMinutes: settings.holdMinutes,
        slotGranularityMinutes: settings.slotGranularityMinutes,
        reminderDayBeforeTime: settings.reminderDayBeforeTime,
        reminderHoursBefore: settings.reminderHoursBefore,
        businessHours: draft,
      })
      if (!response.success) throw new Error('booking_business_hours_save_failed')
      notifyToast('受付時間を保存しました。')
      onSaved(response.data)
    } catch (error) {
      setSaveError(businessHoursSaveError(error))
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
  }

  // WEB053：失敗を先に見る（draft は成功したときだけできる）。
  if (settingsStatus === 'error' || (settingsStatus !== 'loading' && !settings)) {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="受付枠を読み込めませんでした"
        description={settingsError ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }
  if (settingsStatus === 'loading' || draft === null || !settings) return <SkeletonRows rows={7} />

  return (
    <div className={styles.tabStack} data-design="Week">
      <Band tone="hint">「同時」は1時間に受けられる数ではなく、同じ時間に重ねられる予約の数です。</Band>
      {!settings.businessHoursConfigured ? (
        <Band tone="warn">まだ週全体の営業時間を保存していません。時間帯がない曜日は現在は担当者の勤務時間どおりに受け付けます。保存すると、その曜日は休業になります。</Band>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>開ける時間</h2>
          <p className={styles.sectionDesc}>曜日ごとに受付の時間と休けいを決めます</p>
        </div>
        <div className="contents">
          {DAYS.map(({ weekday, label }) => {
            const day = draft.find((entry) => entry.weekday === weekday)
            const intervals = day?.intervals ?? []
            const isOpen = intervals.length > 0
            const closedText = settings.businessHoursConfigured
              ? '休み（定休日）・お客さまの画面に出ません'
              : '未設定（現在は担当者の勤務時間どおり）'
            // 閲覧のみ：つまみ・時刻の欄・足す／消す口は置かず、いまの時間を文字で見せる（2026-10-06 オーナー決定）。
            if (!canEdit) {
              return (
                <div key={weekday} className={styles.dayRow}>
                  <div className={styles.dayName}>
                    <span className={styles.dayLabel}>{label.replace('曜日', '')}</span>
                  </div>
                  <div className={styles.dayBody}>
                    {intervals.length === 0 ? (
                      <span className={styles.dayOff}>{closedText}</span>
                    ) : intervals.map((interval, index) => (
                      <p key={index} className={styles.intervalLine}>
                        {interval.start}〜{interval.end}
                        <span className={styles.sameTimeLabel}>同時 {interval.capacity ?? 1}</span>
                      </p>
                    ))}
                  </div>
                </div>
              )
            }
            return (
              <div key={weekday} className={styles.dayRow}>
                <div className={styles.dayName}>
                  <Toggle
                    label={`${label}を${isOpen ? '休みにする' : '開ける'}`}
                    checked={isOpen}
                    onChange={(next) => updateDay(weekday, () => next ? [{ start: '09:00', end: '18:00', capacity: 1 }] : [])}
                  />
                  <span className={styles.dayLabel}>{label.replace('曜日', '')}</span>
                </div>
                <div className={styles.dayBody}>
                  {intervals.length === 0 ? (
                    <span className={styles.dayOff}>{closedText}</span>
                  ) : null}
                  {intervals.map((interval, index) => (
                  <div key={index} className={styles.intervalLine}>
                    <TimeField
                      aria-label={`${label}の開始時刻（${index + 1}区間目）`}
                      value={interval.start}
                      onChange={(value) => updateDay(weekday, (list) => list.map((entry, i) => i === index ? { ...entry, start: value } : entry))}
                      className={styles.timeInput}
                    />
                    <span className={styles.intervalTilde}>〜</span>
                    <TimeField
                      aria-label={`${label}の終了時刻（${index + 1}区間目）`}
                      value={interval.end}
                      onChange={(value) => updateDay(weekday, (list) => list.map((entry, i) => i === index ? { ...entry, end: value } : entry))}
                      className={styles.timeInput}
                    />
                    <span className={styles.sameTimeLabel}>同時</span>
                    <input
                      aria-label={`${label}の同時受付数（${index + 1}区間目）`}
                      type="number"
                      min={1}
                      max={1000}
                      value={interval.capacity ?? 1}
                      onChange={(event) => updateDay(weekday, (list) => list.map((entry, i) => i === index ? { ...entry, capacity: Number(event.target.value) } : entry))}
                      className={styles.numInput}
                    />
                    <button
                      type="button"
                      className={styles.iconRemove}
                      aria-label={`${label}の${index + 1}区間目を削除`}
                      onClick={() => updateDay(weekday, (list) => list.filter((_, i) => i !== index))}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                  ))}
                  {isOpen && intervals.length < 8 ? (
                    <button
                      type="button"
                      className={styles.addLine}
                      onClick={() => updateDay(weekday, (list) => [...list, { start: '09:00', end: '18:00', capacity: 1 }])}
                    >
                      <Plus size={15} aria-hidden="true" />時間帯を足す
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
        {saveError ? <p className="text-danger mt-3 text-sm" role="alert">{saveError}</p> : null}

        {/* 絵 yRPxl：設備と空きの確かめは、開ける時間の白い板の中の入れ子の箱（枠・角12・内側16）。 */}
        <div className={styles.innerStack}>
      <section className={styles.innerSection} aria-labelledby="hours-equip-title">
        <h3 id="hours-equip-title" className={styles.sectionTitle}>設備</h3>
        <div className={styles.innerHeadRow}>
          <p className={styles.sectionDesc}>設備ごとに、同じ時間に使える数を決めます。</p>
          {canEdit ? (
            <Button onClick={() => setAddingResource(true)}>設備を追加する</Button>
          ) : null}
        </div>
        {resourcesStatus === 'loading' ? <SkeletonRows rows={2} /> : null}
        {resourcesStatus === 'error' ? (
          <StateCard
            icon={<AccountIcon />}
            title="設備を読み込めませんでした"
            description={resourcesError ?? 'もう一度お試しください。'}
            action={<Button onClick={onResourcesRetry}>読み直す</Button>}
          />
        ) : null}
        {resourcesStatus === 'ready' && resources ? (
          <div className={styles.equipTable}>
            <div className={styles.equipHead} aria-hidden="true">
              <span className={styles.equipName}>設備名</span>
              <span className={styles.equipType}>種類</span>
              <span className={styles.equipCap}>受付上限</span>
              <span className={styles.colMenu} />
            </div>
            {resources.length === 0 ? (
              <p className={styles.noteText}>設備はまだありません。</p>
            ) : resources.map((resource) => (
              <ResourceRowV8
                key={`${resource.id}:${resource.version}`}
                accountId={accountId}
                resource={resource}
                canEdit={canEdit}
                onSaved={onResourceSaved}
                onDeleted={onResourceDeleted}
              />
            ))}
          </div>
        ) : null}
        <ResourceDialog
          open={addingResource}
          onClose={() => setAddingResource(false)}
          accountId={accountId}
          onSaved={(saved) => { setAddingResource(false); onResourceCreated(saved) }}
        />
      </section>

      <SlotCheckV8 accountId={accountId} menus={menus} />
        </div>
      </section>
    </div>
  )
}

export function ResourceRowV8({ accountId, resource, canEdit, onSaved, onDeleted }: {
  accountId: string
  resource: BookingResource
  canEdit: boolean
  onSaved: (resource: BookingResource) => void
  onDeleted: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  async function setActive(nextActive: boolean) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    try {
      const response = await bookingApi.updateResource(accountId, resource.id, {
        expectedVersion: resource.version,
        isActive: nextActive,
      })
      onSaved(response.data)
    } catch (cause) {
      setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  async function remove() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    try {
      await bookingApi.deleteResource(accountId, resource.id, resource.version)
      setConfirmDelete(false)
      onDeleted(resource.id)
    } catch (cause) {
      setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      setBusy(false)
    }
  }

  const menuItems: ActionMenuItem[] = canEdit ? [
    {
      id: 'edit',
      label: '中身を編集',
      disabled: busy,
      onSelect: () => setEditing(true),
    },
    {
      id: 'toggle',
      label: resource.isActive ? '受付を停止' : '受付を再開',
      disabled: busy,
      onSelect: () => void setActive(!resource.isActive),
    },
    ...(!resource.usage?.referenced ? [{
      id: 'delete',
      label: '設備を削除する',
      tone: 'danger' as const,
      dividerBefore: true,
      disabled: busy,
      onSelect: () => { setError(null); setConfirmDelete(true) },
    }] : []),
  ] : []

  return (
    <div className={styles.equipRow}>
      <span className={styles.equipName}>
        {resource.name}
        {!resource.isActive ? <span className={styles.cellWarn}>（受付停止中）</span> : null}
      </span>
      <span className={styles.equipType}>{resource.type}</span>
      <span className={styles.equipCap}>{resource.capacity}</span>
      <span className={styles.colMenu}>
        <RowMenu
          appearance="plain"
          className={styles.rowMenuButton}
          label={`「${resource.name}」のそのほかの操作`}
          menuLabel={`「${resource.name}」の操作`}
          items={menuItems}
        />
      </span>
      {error ? <p className="text-danger w-full text-xs" role="alert">{error}</p> : null}
      <ResourceDialog
        open={editing}
        onClose={() => setEditing(false)}
        accountId={accountId}
        resource={resource}
        onSaved={(saved) => { setEditing(false); onSaved(saved) }}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`「${resource.name}」を削除しますか？`}
        description="削除すると元に戻せません。受付だけ止めたいときは「受付を停止」を使ってください。"
        confirmLabel="削除する"
        destructive
        busy={busy}
        error={error ?? undefined}
        onCancel={() => { if (!busy) setConfirmDelete(false) }}
        onConfirm={() => void remove()}
      />
    </div>
  )
}

export function ResourceDialog({ open, onClose, accountId, resource, onSaved }: {
  open: boolean
  onClose: () => void
  accountId: string
  resource?: BookingResource
  onSaved: (resource: BookingResource) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [capacity, setCapacity] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setName(resource?.name ?? '')
    setType(resource?.type ?? '')
    setCapacity(String(resource?.capacity ?? 1))
    setError(null)
  }, [open, resource])

  async function submit() {
    if (inFlightRef.current) return
    const parsedCapacity = Number(capacity)
    if (!name.trim() || name.trim().length > 100 || !type.trim() || type.trim().length > 50
      || !Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 1000) {
      setError('設備名は1〜100文字、種類は1〜50文字、受付上限は1〜1000の整数で入力してください。')
      return
    }
    inFlightRef.current = true
    setSaving(true)
    setError(null)
    try {
      if (resource) {
        const response = await bookingApi.updateResource(accountId, resource.id, {
          expectedVersion: resource.version,
          name: name.trim(),
          type: type.trim(),
          capacity: parsedCapacity,
          isActive: resource.isActive,
        })
        onSaved(response.data)
      } else {
        const response = await bookingApi.createResource(accountId, {
          name: name.trim(), type: type.trim(), capacity: parsedCapacity,
        })
        onSaved(response.data)
      }
    } catch (cause) {
      setError(resourceSaveError(cause))
    } finally {
      inFlightRef.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={resource ? `「${resource.name}」を編集` : '設備を追加する'}
      onCancel={() => { if (!saving) onClose() }}
      busy={saving}
    >
      <div className="grid gap-3">
        <label className={styles.fieldLabel}>設備名
          <input aria-label="設備名" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} maxLength={100} className="border-hairline rounded-control focus:ring-accent mt-1 w-full border bg-canvas px-3 h-10 text-sm focus:outline-none focus:ring-2" />
        </label>
        <label className={styles.fieldLabel}>種類
          <input aria-label="種類" value={type} onChange={(event) => setType(event.target.value)} disabled={saving} maxLength={50} placeholder="例: 部屋・席・機器" className="border-hairline rounded-control focus:ring-accent mt-1 w-full border bg-canvas px-3 h-10 text-sm focus:outline-none focus:ring-2" />
        </label>
        <label className={styles.fieldLabel}>受付上限
          <input aria-label="受付上限" type="number" min={1} max={1000} value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={saving} className="border-hairline rounded-control focus:ring-accent mt-1 w-full border bg-canvas px-3 h-10 text-sm tabular-nums focus:outline-none focus:ring-2" />
        </label>
        {error ? <p className="text-danger text-xs" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={() => { if (!saving) onClose() }} disabled={saving}>キャンセル</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving} busy={saving}>保存する</Button>
        </div>
      </div>
    </Dialog>
  )
}

export function SlotCheckV8({ accountId, menus }: { accountId: string; menus: BookingMenu[] }) {
  const activeMenus = useMemo(() => menus.filter((menu) => menu.is_active), [menus])
  const [menuId, setMenuId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [staffId, setStaffId] = useState('')
  const [staffOptions, setStaffOptions] = useState<BookingStaff[]>([])
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<BookingSlotCheckResult | null>(null)
  const requestRef = useRef(0)
  /* WEB054：条件・アカウントを変えたら、確かめている途中の結果を捨てる（古い条件の結果を新しい条件の下に出さない）。 */
  const changeCriteria = () => {
    requestRef.current += 1
    setResult(null)
    setChecking(false)
    setCheckError(null)
  }

  useEffect(() => {
    requestRef.current += 1
    setResult(null)
    setChecking(false)
    setCheckError(null)
  }, [accountId])

  useEffect(() => {
    let cancelled = false
    void bookingApi.listStaff(accountId)
      .then((res) => {
        if (!cancelled) setStaffOptions(res.staff.filter((person) => person.is_active))
      })
      .catch(() => { if (!cancelled) setStaffOptions([]) })
    return () => { cancelled = true }
  }, [accountId])

  useEffect(() => {
    if (!menuId && activeMenus.length > 0) setMenuId(activeMenus[0].id)
  }, [activeMenus, menuId])

  async function run() {
    if (!menuId || !date || !time) return
    const requestId = ++requestRef.current
    setChecking(true)
    setCheckError(null)
    try {
      const response = await bookingApi.checkAvailability(accountId, { menuId, staffId: staffId || undefined, date, time })
      if (requestId !== requestRef.current) return
      setResult(response)
    } catch (error) {
      if (requestId !== requestRef.current) return
      setResult(null)
      setCheckError(error instanceof ApiError && error.status === 403
        ? 'このアカウントの予約を確かめる権限がありません。'
        : '空き状況を確かめられませんでした。もう一度お試しください。')
    } finally {
      if (requestId === requestRef.current) setChecking(false)
    }
  }

  const canRun = Boolean(menuId && date && time) && !checking

  return (
    <section className={styles.innerSection} aria-labelledby="hours-check-title">
      {/* 絵 yRPxl は題だけ。説明の1行は行を高くするので「？」の中へ。 */}
      <div className={styles.innerTitleRow}>
        <h3 id="hours-check-title" className={styles.sectionTitle}>空きを確かめる</h3>
        <HelpTip label="空きを確かめるの説明">お客さまの画面と同じ条件で、その日時に受けられるか確かめます。確かめても予約は作られません。</HelpTip>
      </div>
      <div className={styles.checkGrid}>
        <Select size="full"
          aria-label="確かめるメニュー"
          value={menuId}
          onChange={(value) => { setMenuId(value); changeCriteria() }}
          options={[
            ...(activeMenus.length === 0 ? [{ value: '', label: '受付中のメニューがありません' }] : []),
            ...activeMenus.map((menu) => ({ value: menu.id, label: menu.name })),
          ]}
        />
        <label className={styles.fieldLabel}>
          日付
          <DateField aria-label="確かめる日付" value={date} onChange={(value) => { setDate(value); changeCriteria() }} className="mt-1" />
        </label>
        <label className={styles.fieldLabel}>
          開始時刻
          <TimeField aria-label="確かめる開始時刻" value={time} onChange={(value) => { setTime(value); changeCriteria() }} className="mt-1" />
        </label>
        <Select size="full"
          aria-label="確かめる担当"
          value={staffId}
          onChange={(value) => { setStaffId(value); changeCriteria() }}
          options={[
            { value: '', label: '担当：指名なし' },
            ...staffOptions.map((person) => ({ value: person.id, label: `担当：${person.display_name}` })),
          ]}
        />
      </div>
      <div className={styles.checkAction}>
        {/* 絵 yRPxl：虫めがね付きの白いボタン */}
        <Button variant="secondary" onClick={() => void run()} disabled={!canRun} busy={checking}><Search size={15} aria-hidden="true" />確かめる</Button>
        {result ? (
          <div className={`${styles.checkResult} ${result.bookable ? styles.checkOk : styles.checkNg}`} role="status">
            {result.bookable ? (
              <p>空いています。{result.per_staff?.length ? `${result.per_staff.map((entry) => entry.display_name).join('・')}が受けられます。` : ''}</p>
            ) : (
              <div>
                <p>この日時は受けられません。</p>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {result.reasons.map((reason) => <li key={reason}>{slotReasonLabel(reason)}</li>)}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
      {checkError ? <p className="text-danger mt-2 text-xs" role="alert">{checkError}</p> : null}
    </section>
  )
}

function initialBusinessHours(settings: BookingSettings): BusinessHoursDay[] {
  return DAYS.map(({ weekday }) => ({
    weekday,
    intervals: (settings.businessHours.find((day) => day.weekday === weekday)?.intervals ?? [])
      .map((interval) => ({ ...interval, capacity: interval.capacity ?? 1 })),
  }))
}

// v7 /booking/staff/shifts の BusinessHoursEditor と同じ検査。
function validateBusinessHours(days: BusinessHoursDay[]): string | null {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  for (const day of days) {
    if (day.intervals.length > 8) return '1曜日の営業時間は8区間までです。'
    const sorted = [...day.intervals].sort((a, b) => a.start.localeCompare(b.start))
    for (const interval of sorted) {
      if (!timePattern.test(interval.start) || !timePattern.test(interval.end) || interval.start >= interval.end) {
        return '営業時間は日ごとに分けて入力してください。終了は同じ日の開始より後にし、24:00は使えません。'
      }
      const capacity = Number(interval.capacity)
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
        return '同時に受け付ける数は1〜1000件で入力してください。'
      }
    }
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index - 1].end > sorted[index].start) {
        return '同じ曜日の営業時間は重ならないように入力してください。'
      }
    }
  }
  return null
}

function businessHoursSaveError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'ほかの担当者が先に保存しました。最新の内容を読み直してから、もう一度変更してください。'
  }
  if (error instanceof ApiError && error.status === 400) return error.message
  return '営業時間を保存できませんでした。入力内容を確かめて、もう一度お試しください。'
}

function resourceSaveError(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'ほかの担当者が先にこの設備を変更しました。読み直してからもう一度お試しください。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '設備を変更する権限がありません。'
  }
  return '設備を保存できませんでした。入力内容を確かめて、もう一度お試しください。'
}
