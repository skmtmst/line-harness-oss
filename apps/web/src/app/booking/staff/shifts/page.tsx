'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import { bookingApi, type BookingShift, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import { GRID_DAYS, gridHours, isOpenAt, specialCountByDay } from './shift-grid'
import { Th } from '@/components/shared/table'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'

type LoadStatus = 'loading' | 'ready' | 'error'

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const DAYS: Array<{ key: DayKey; weekday: number; label: string; tone: string }> = [
  { key: 'sun', weekday: 0, label: '日', tone: 'text-red-500' },
  { key: 'mon', weekday: 1, label: '月', tone: '' },
  { key: 'tue', weekday: 2, label: '火', tone: '' },
  { key: 'wed', weekday: 3, label: '水', tone: '' },
  { key: 'thu', weekday: 4, label: '木', tone: '' },
  { key: 'fri', weekday: 5, label: '金', tone: '' },
  { key: 'sat', weekday: 6, label: '土', tone: 'text-blue-500' },
]

type WeeklyTemplate = Record<DayKey, { start: string; end: string } | null>
const DEFAULT_TEMPLATE: WeeklyTemplate = {
  sun: null,
  mon: { start: '10:00', end: '19:00' },
  tue: { start: '10:00', end: '19:00' },
  wed: { start: '10:00', end: '19:00' },
  thu: { start: '10:00', end: '19:00' },
  fri: { start: '10:00', end: '19:00' },
  sat: { start: '10:00', end: '19:00' },
}

/**
 * 受付時間・カレンダー（設計 V2 8-2-3 / node uJ37b）。
 *
 * 以前は ?staff_id= が無いと何も出せず、「スタッフ一覧から選んでください」
 * とだけ書いてあった。予約設定のタブからここへ来た人は、そこで詰まる。
 * 設計どおり、画面の中でスタッフを選べるようにした。
 */
function StaffShiftsPageContent() {
  const sp = useSearchParams()
  const { selectedAccountId } = useAccount()
  /** URLで指定が無ければ、選んだ人を覚えておく。 */
  const [pickedStaffId, setPickedStaffId] = useState('')
  const staffId = sp.get('staff_id') || pickedStaffId
  const [allStaff, setAllStaff] = useState<BookingStaff[]>([])
  const [staffMember, setStaffMember] = useState<BookingStaff | null>(null)
  const [shifts, setShifts] = useState<BookingShift[]>([])
  const [template, setTemplate] = useState<WeeklyTemplate>(DEFAULT_TEMPLATE)
  const [calendarId, setCalendarId] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null)
  const [serviceAccountConfigured, setServiceAccountConfigured] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState(false)
  const [savingRules, setSavingRules] = useState(false)
  /* 格子は保存済みの内容ではなく、いま編集中の値から描く。 */
  const hours = gridHours(template)
  const specialCounts = specialCountByDay(shifts)
  const [savingCalendar, setSavingCalendar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [deleteShiftTarget, setDeleteShiftTarget] = useState<{ id: string; date: string } | null>(null)
  const loadRequestRef = useRef(0)

  // スタッフの一覧は、誰も選ばれていないうちから要る。
  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    bookingApi
      .listStaff(selectedAccountId)
      .then((r) => {
        if (!alive) return
        setAllStaff(r.staff)
        // 1人しかいなければ選ばせる意味が無い。そのまま開く。
        if (!sp.get('staff_id') && !pickedStaffId && r.staff.length === 1) {
          setPickedStaffId(r.staff[0].id)
        }
      })
      .catch(() => {
        // 一覧が出ないだけ。URLで指定して来た人はそのまま使える。
      })
    return () => {
      alive = false
    }
    // pickedStaffId は初回だけ見る。選び直すたびに引き直す必要はない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!selectedAccountId || !staffId) {
      setLoadStatus('ready')
      setLoadError(false)
      return
    }
    setLoadStatus('loading')
    setLoadError(false)
    setError(null)
    try {
      const [staff, dated, rules, calendar] = await Promise.all([
        bookingApi.listStaff(selectedAccountId),
        bookingApi.getShifts(selectedAccountId, staffId),
        bookingApi.getAvailabilityRules(selectedAccountId, staffId),
        bookingApi.getGoogleCalendar(selectedAccountId, staffId),
      ])
      if (requestId !== loadRequestRef.current) return
      setStaffMember(staff.staff.find((item) => item.id === staffId) ?? null)
      setShifts(dated.shifts)
      if (rules.rules.length > 0) {
        const next: WeeklyTemplate = {
          sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null,
        }
        for (const day of DAYS) {
          const rule = rules.rules.find((item) => item.weekday === day.weekday)
          if (rule) next[day.key] = { start: rule.start_time, end: rule.end_time }
        }
        setTemplate(next)
      }
      setCalendarId(calendar.connection?.calendar_id ?? '')
      setCalendarConnected(Boolean(calendar.connection))
      setServiceAccountEmail(calendar.service_account.email)
      setServiceAccountConfigured(calendar.service_account.configured)
      setLoadStatus('ready')
    } catch {
      if (requestId !== loadRequestRef.current) return
      setStaffMember(null)
      setShifts([])
      setLoadError(true)
      setLoadStatus('error')
    }
  }, [selectedAccountId, staffId])

  useEffect(() => {
    void load()
    return () => {
      loadRequestRef.current += 1
    }
  }, [load])

  async function saveRules() {
    if (!selectedAccountId || !staffId) return
    setSavingRules(true)
    setError(null)
    setSuccess(null)
    try {
      const rules = DAYS.flatMap((day) => {
        const value = template[day.key]
        return value
          ? [{ weekday: day.weekday, start_time: value.start, end_time: value.end }]
          : []
      })
      await bookingApi.putAvailabilityRules(selectedAccountId, staffId, rules)
      setSuccess('毎週の受付時間を保存しました。今後は期限切れせず、自動で枠が作られます。')
    } catch {
      setError('受付時間を保存できませんでした。入力内容を確かめて、もう一度お試しください。')
    } finally {
      setSavingRules(false)
    }
  }

  async function connectCalendar() {
    if (!selectedAccountId || !staffId || !calendarId.trim()) return
    setSavingCalendar(true)
    setError(null)
    setSuccess(null)
    try {
      await bookingApi.putGoogleCalendar(selectedAccountId, staffId, calendarId.trim())
      setCalendarConnected(true)
      setSuccess('Googleカレンダーに接続しました。予定ありの時間は予約枠から自動で除外されます。')
    } catch {
      setError('Googleカレンダーへ接続できませんでした。共有設定とカレンダーIDを確かめてください。')
    } finally {
      setSavingCalendar(false)
    }
  }

  /*
    **確認はブラウザの `confirm()` を使わない。**
    見た目がブラウザ任せで設計の確認窓と違ううえ、**画像比較に写らない**ので
    確認の絵をそもそも撮れない。共通の確認窓（`ConfirmDialog`）で出す。
  */
  async function disconnectCalendar() {
    if (!selectedAccountId || !staffId) return
    await bookingApi.deleteGoogleCalendar(selectedAccountId, staffId)
    setCalendarConnected(false)
    setCalendarId('')
    setUnlinkOpen(false)
    setSuccess('Googleカレンダー連携を解除しました。')
  }

  async function deleteShift(shiftId: string) {
    if (!selectedAccountId) return
    await bookingApi.deleteShift(selectedAccountId, staffId, shiftId)
    setDeleteShiftTarget(null)
    await load()
  }

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/booking/menus" className="hover:underline">
          予約設定
        </Link>
        <span className="mx-1.5">/</span>
        <span>受付時間</span>
      </nav>

      <div data-design="Head">
        <Header
          title="受付時間・カレンダー"
          description="スタッフごとの受付時間を決めます。Googleカレンダーをつなぐと、そちらの予定が入っている時間は自動で受付を止めます。"
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <a
            href="#special"
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm"
          >
            特別休業日を設定
          </a>
          <button
            onClick={saveRules}
            disabled={savingRules || !staffId}
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {savingRules ? '保存中…' : '変更を保存'}
          </button>
        </div>
      </div>

      <div data-design="Picker" className="bg-canvas rounded-card border-hairline mb-4 border p-4">
        <p className="text-ink-faint mb-2 text-xs">受付時間を編集する人を選んでください。</p>
        {allStaff.length === 0 ? (
          <p className="text-ink-faint text-sm">
            まだスタッフが登録されていません。
            <Link href="/booking/staff/new" className="text-accent ml-1 hover:underline">
              スタッフを登録する
            </Link>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allStaff.map((s) => (
              <button
                key={s.id}
                onClick={() => setPickedStaffId(s.id)}
                className={`rounded-pill px-3 py-1.5 text-xs font-medium ${
                  s.id === staffId
                    ? 'bg-accent-deep text-on-accent'
                    : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                }`}
              >
                {s.display_name || s.name}
                {s.is_designation_optional === 1 && (
                  <span className="ml-1 opacity-70">指名なし</span>
                )}
              </button>
            ))}
          </div>
        )}
        {staffMember && (
          <p className="text-ink-faint mt-2 text-xs">
            {staffMember.display_name || staffMember.name} の受付時間を編集しています。
            {/* 「ほかのスタッフにコピー」は、上書き先を丸ごと置き換えるので
                取り消せない。仕組みを入れる前に、何を上書きするかを
                決める必要がある。v025-open-questions に残してある。 */}
            <span className="ml-2 opacity-60">
              まとめて反映（ほかのスタッフにコピー）は準備中です
            </span>
          </p>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">{success}</div>}

      {!selectedAccountId || !staffId ? (
        <ListState kind="empty" title="予約スタッフを選んでください" description="この画面のスタッフ選択から、受付時間を設定する人を選んでください。" />
      ) : loadStatus === 'loading' ? (
        <ListState kind="loading" title="受付時間と休業日を読み込んでいます" />
      ) : loadStatus === 'error' && loadError ? (
        <ListState
          kind="error"
          title="受付時間と休業日を表示できませんでした"
          description="保存済みの設定は消えていません。再読み込みしても直らない場合はエラー報告へ。"
          action={<Button variant="secondary" onClick={() => void load()}>受付時間と休業日を再読み込み</Button>}
        />
      ) : (
        <div className="space-y-4">
          <section data-design="Week" className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
              <h2 className="font-semibold text-gray-900">
                {staffMember ? `${staffMember.display_name || staffMember.name} の受付時間` : '受付時間'}
              </h2>
              <p className="mt-1 text-sm text-gray-500">毎週くり返します。一度保存すれば、将来の日付にも自動で適用されます。週数や終了日はありません。</p>
              {/* 設計は30分きざみの升目で「受付可・休憩・予約済」を塗り分ける。
                  休憩という考え方が availability_rules に無く、升目にすると
                  持ち方から決める必要がある。いまは曜日ごとの開始と終了で受ける。
                  v025-open-questions に残してある。 */}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span>色の意味</span>
                <span className="flex items-center gap-1">
                  <span className="bg-success-bg inline-block h-3 w-3 rounded-sm" />
                  受付可
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-canvas-sunken inline-block h-3 w-3 rounded-sm" />
                  受付なし
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-warning-bg inline-block h-3 w-3 rounded-sm" />
                  Googleカレンダーに予定あり
                </span>
              </div>
            </div>
            {/*
              設計は曜日×時間の格子で見せる。1行ずつだと
              **「何曜の何時なら受け付けるか」を見比べられない。**
              下の欄で直し、ここで見る。
            */}
            {hours.length > 0 ? (
              <div className="border-hairline overflow-x-auto border-b p-5">
                <table className="w-full min-w-lg table-fixed border-separate border-spacing-0.5">
                  <thead>
                    <tr>
                      <Th className="w-12" aria-label="時間" />
                      {GRID_DAYS.map((day) => (
                        <Th key={day.key} align="center" className="px-1 pb-1">
                          {day.label}
                          {/* 休みか営業かは口が言っていない。件数だけ添える。 */}
                          {specialCounts[day.key] > 0 ? (
                            <span className="text-ink-faint block text-xs font-normal">特別{specialCounts[day.key]}</span>
                          ) : null}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map((hour) => (
                      <tr key={hour}>
                        <Th align="right" scope="row" className="pr-2 tabular-nums">{hour}時</Th>
                        {GRID_DAYS.map((day) => (
                          <td
                            key={day.key}
                            aria-label={`${day.label}曜 ${hour}時 ${isOpenAt(template[day.key], hour) ? '受付' : '受付しない'}`}
                            className={`h-5 rounded-sm ${isOpenAt(template[day.key], hour) ? 'bg-accent-soft' : 'bg-canvas-sunken'}`}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-ink-faint mt-3 text-xs">
                  色の付いた時間だけ受け付けます。「特別」は下の
                  <a href="#special" className="text-accent mx-1 underline">特別な休み・営業</a>
                  にある日で、休みか営業かはその一覧で確かめてください。
                </p>
              </div>
            ) : null}

            <div className="space-y-3 p-5">
              {DAYS.map((day) => {
                const current = template[day.key]
                return (
                  <div key={day.key} className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={current !== null}
                      onChange={(event) => setTemplate((previous) => ({
                        ...previous,
                        [day.key]: event.target.checked ? { start: '10:00', end: '19:00' } : null,
                      }))}
                      className="h-4 w-4"
                    />
                    <span className={`w-7 font-medium ${day.tone}`}>{day.label}</span>
                    {current ? (
                      <>
                        <input type="time" value={current.start} onChange={(event) => setTemplate((previous) => ({ ...previous, [day.key]: { ...current, start: event.target.value } }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums" />
                        <span className="text-gray-400">〜</span>
                        <input type="time" value={current.end} onChange={(event) => setTemplate((previous) => ({ ...previous, [day.key]: { ...current, end: event.target.value } }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums" />
                      </>
                    ) : <span className="text-sm text-gray-400">受付しない</span>}
                  </div>
                )
              })}
              <div className="flex justify-end pt-2">
                <button onClick={saveRules} disabled={savingRules} className="rounded-lg bg-accent-deep px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {savingRules ? '保存中…' : '受付時間を保存'}
                </button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900">Googleカレンダー連携</h2>
                  <p className="mt-1 text-sm text-gray-500">予定との重複を防ぎ、確定した予約をGoogleカレンダーにも登録します。</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${calendarConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {calendarConnected ? '接続済み' : '未接続'}
                </span>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {!serviceAccountConfigured && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  OSS管理者によるGoogleサービスアカウント設定が必要です。
                </div>
              )}
              {serviceAccountEmail && (
                <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
                  Googleカレンダーの「設定と共有」で、次のメールアドレスに「予定の変更」権限を付けて共有してください。<br />
                  <code className="mt-2 inline-block break-all rounded bg-white px-2 py-1 text-xs">{serviceAccountEmail}</code>
                </div>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">GoogleカレンダーID</span>
                <input
                  value={calendarId}
                  onChange={(event) => setCalendarId(event.target.value)}
                  placeholder="例: example@gmail.com または xxx@group.calendar.google.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100"
                />
                <span className="mt-1.5 block text-xs text-gray-500">Googleカレンダー → 設定と共有 → カレンダーの統合 → カレンダーID</span>
              </label>
              <div className="flex justify-end gap-2">
                {calendarConnected && <button onClick={() => setUnlinkOpen(true)} className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600">連携解除</button>}
                <button onClick={connectCalendar} disabled={savingCalendar || !calendarId.trim() || !serviceAccountConfigured} className="rounded-lg bg-accent-deep px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {savingCalendar ? '接続確認中…' : calendarConnected ? '再接続して確認' : '接続して確認'}
                </button>
              </div>
            </div>
          </section>

          <section
            id="special"
            data-design="Special"
            className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
          >
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
              <h2 className="font-semibold text-gray-900">特別な休み・営業 ({shifts.length}件)</h2>
              <p className="mt-1 text-sm text-gray-500">その日だけの受付時間です。同じ日付では毎週の設定よりこちらを優先します。</p>
            </div>
            {shifts.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">特別な休み・営業はまだありません</div> : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white"><tr className="border-b"><th className="px-5 py-3 text-left">日付</th><th className="px-5 py-3 text-left">時間</th><th className="px-5 py-3 text-right">操作</th></tr></thead>
                  <tbody>{shifts.map((shift) => <tr key={shift.id} className="border-b border-gray-100"><td className="px-5 py-3 tabular-nums">{shift.work_date}</td><td className="px-5 py-3 tabular-nums">{shift.start_time}〜{shift.end_time}</td><td className="px-5 py-3 text-right"><button onClick={() => setDeleteShiftTarget({ id: shift.id, date: shift.work_date })} className="text-red-600 hover:underline">削除</button></td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          <div data-design="note" className="bg-canvas-sunken rounded-card p-4">
            <ul className="text-ink-secondary space-y-1.5 text-xs leading-5">
              <li>
                ・Googleカレンダーの予定は5分ごとに取り込みます。直前の予定は反映が間に合わないことがあります
              </li>
              <li>・受付時間を短くしても、すでに入っている予約は取り消されません</li>
              <li>・「まとめて反映」は、上書き先の設定を置き換えます</li>
            </ul>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={unlinkOpen}
        title="Googleカレンダー連携を解除しますか？"
        description="このスタッフの予定の取り込みを止めます。すでに取り込んだ予定と、入っている予約はそのまま残ります。あとからつなぎ直せます。"
        confirmLabel="連携を解除"
        destructive
        onCancel={() => setUnlinkOpen(false)}
        onConfirm={() => void disconnectCalendar()}
      />

      <ConfirmDialog
        open={deleteShiftTarget !== null}
        title={`${deleteShiftTarget?.date ?? ''} の応急枠を削除しますか？`}
        description="この日だけの受付時間を消して、ふだんの曜日ごとの設定に戻します。すでに入っている予約は取り消されません。"
        confirmLabel="削除する"
        destructive
        onCancel={() => setDeleteShiftTarget(null)}
        onConfirm={() => { if (deleteShiftTarget) void deleteShift(deleteShiftTarget.id) }}
      />
    </div>
  )
}

// useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
export default function StaffShiftsPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <StaffShiftsPageContent />
    </Suspense>
  )
}
