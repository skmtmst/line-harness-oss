'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, History, Info, Mic, Pencil, Plus, Sparkles, X } from 'lucide-react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import SelectField from '@/components/shared/select-field'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import Toggle from '@/components/shared/toggle'
import { TextArea, TextField } from '@/components/shared/text-field'
import { api, ApiError } from '@/lib/api'
import type { MediaItem } from '@line-crm/shared'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import {
  restaurantGoogleApi,
  type GoogleChange,
  type GoogleChangeStatus,
  type GoogleDayHours,
  type GoogleHistoryData,
  type GoogleHistoryKind,
  type GoogleHistoryResult,
  type GoogleHoursPeriod,
  type GoogleHoursProposal,
  type GooglePhoto,
  type GoogleProfileAddress,
  type GoogleProfileData,
  type GoogleProfileProposal,
  type GoogleWeekday,
  type GoogleWeeklyHours,
} from '@/lib/restaurant-google-api'
import { TIME_OPTIONS, WEEKDAYS, WEEKDAY_JA, addDays, errorMessage, formatDateTime, formatPeriods, formatYmdJa, formatYmdShort, samePeriods, weekdayOf } from './google-format'

/**
 * ★V6 Googleビジネス 第2段：プロフィール・営業時間・変更履歴。
 *
 * Pencil `Googleビジネス正本.pen`
 *  - GB-10   R4a3qH プロフィール                 - GB-17 w7ZTml 変更履歴
 *  - GB-11   N8Ipp4 営業時間・かんたん入力        - GB-18 V5jnSa プロフィールを編集
 *  - GB-11-B Ldvmo  営業時間・カレンダーで指定    - GB-19 pRLAQ  プロフィール変更の確認
 *  - GB-11-C LbQ05  営業時間・毎週の営業時間      - GB-15 oQRFu  状態・エラー（反映確認中・変更競合）
 *  - GB-12   t73h64 営業時間・変更確認
 *
 * 画面の遷移は URL（?tab=profile&view=hours|confirm|history|edit）で持つ。
 * どの入力もこの画面ではGoogleを変えない。「変更案を確認」→ 確認画面 → 「Googleに変更を送信」で初めて送る。
 */

export type ProfileView = 'profile' | 'hours' | 'confirm' | 'history' | 'edit'
export type HoursMode = 'text' | 'calendar' | 'weekly'

export const PROFILE_DESIGN_NODES: Record<string, string> = {
  profile: 'R4a3qH',
  'hours:text': 'N8Ipp4',
  'hours:calendar': 'Ldvmo',
  'hours:weekly': 'LbQ05',
  'confirm:hours': 't73h64',
  'confirm:profile': 'pRLAQ',
  history: 'w7ZTml',
  edit: 'V5jnSa',
}

export type ProfileNav = (params: Record<string, string | undefined>) => void

const STATUS_LABEL: Record<GoogleChangeStatus, { label: string; tone: StatusBadgeTone }> = {
  draft: { label: 'まだ反映していません', tone: 'warning' },
  pending_confirm: { label: '反映確認中', tone: 'warning' },
  accepted: { label: '反映確認中', tone: 'warning' },
  applied: { label: '反映済み', tone: 'success' },
  failed: { label: '失敗', tone: 'danger' },
  conflict: { label: '変更競合', tone: 'danger' },
  cancelled: { label: '取り消し', tone: 'neutral' },
}

const KIND_LABEL: Record<string, string> = { special_hours: '営業時間', regular_hours: '営業時間', profile: 'プロフィール', photo: 'プロフィール', review_reply: '口コミ返信' }
const FIELD_LABEL: Record<string, string> = { title: '店舗名', phone: '電話番号', websiteUri: 'ウェブサイト', description: '店舗紹介文', address: '住所', photo: '写真' }

function addressText(a: GoogleProfileAddress | null | undefined): string {
  if (!a) return '—'
  return [a.postalCode ? `〒${a.postalCode}` : '', a.administrativeArea ?? '', a.locality ?? '', ...a.addressLines].filter(Boolean).join(' ') || '—'
}

/** 曜日ごとの通常営業時間を「月–金 11:00–15:00 / 17:00–22:00、土 …」の形に縮める。 */
function summarizeWeekly(weekly: GoogleWeeklyHours): string {
  const groups: Array<{ days: GoogleWeekday[]; text: string }> = []
  for (const day of WEEKDAYS) {
    const text = formatPeriods(weekly[day] ?? [], '定休日')
    const last = groups[groups.length - 1]
    if (last && last.text === text) last.days.push(day)
    else groups.push({ days: [day], text })
  }
  return groups
    .map((g) => `${g.days.length > 2 ? `${WEEKDAY_JA[g.days[0]]}–${WEEKDAY_JA[g.days[g.days.length - 1]]}` : g.days.map((d) => WEEKDAY_JA[d]).join('・')} ${g.text}`)
    .join('、')
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <Button onClick={onClick}><ArrowLeft size={16} />{label}</Button>
    </div>
  )
}

function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="bg-status-info-soft text-status-info flex items-start gap-3 rounded-control px-4 py-3 text-label leading-relaxed" role="note">
      <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

/** 方式切替・絞り込みに使う「操作ボタン」風の小さなタブ（Pencil 操作 かんたん入力 等）。 */
function PillTabs({ label, items }: { label: string; items: Array<{ key: string; label: ReactNode; current: boolean; onClick: () => void; disabled?: boolean }> }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.current}
          disabled={item.disabled}
          onClick={item.onClick}
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-control border px-3.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-info disabled:cursor-not-allowed disabled:opacity-40 ${item.current ? 'bg-accent-soft text-accent-deep' : 'bg-canvas text-ink hover:bg-canvas-sunken'}`}
          style={{ borderColor: item.current ? 'transparent' : 'var(--color-hairline)' }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ---------- GB-10 プロフィール ----------

export function ProfileTab({ accountId, go }: { accountId: string; go: ProfileNav }) {
  const [data, setData] = useState<GoogleProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [showHolidays, setShowHolidays] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [earlyClose, setEarlyClose] = useState<string | null>(null)

  const load = useCallback(async (sync = false) => {
    if (sync) setSyncing(true)
    else setLoading(true)
    setError('')
    try {
      setData(sync ? await restaurantGoogleApi.syncProfile(accountId) : await restaurantGoogleApi.profile(accountId))
    } catch (err) {
      if (!sync) setData(null)
      setError(errorMessage(err, 'プロフィールを読み込めませんでした。'))
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const quick = async (proposal: GoogleHoursProposal) => {
    setBusy(true)
    setActionError('')
    try {
      const response = await restaurantGoogleApi.proposeHours(accountId, proposal)
      if (response.change) go({ tab: 'profile', view: 'confirm', id: response.change.id })
      else setActionError(response.question ?? '変更案を作れませんでした。')
    } catch (err) {
      setActionError(errorMessage(err, '変更案を作れませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <ListState kind="loading" title="プロフィールを読み込んでいます" />
  if (!data) {
    return (
      <ListState kind="error" title="プロフィールを表示できませんでした" description={error} onRetry={() => void load()} action={<Button href="/restaurant-test/google?tab=settings">設定で接続を確認</Button>} />
    )
  }

  const { profile, today } = data
  const canChange = !data.closed && !busy
  const todayText = today.closed ? '本日は休業' : formatPeriods(today.periods)
  const specialUpcoming = profile.specialHours
  const closeOptions = TIME_OPTIONS.filter((t) => today.periods.length > 0 && t > today.periods[today.periods.length - 1].open).map((t) => ({ value: t, label: t }))

  return (
    <div data-design-node="R4a3qH" className="text-ink flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-heading font-bold">プロフィール</h2>
        <span className="grow" />
        <Button onClick={() => go({ tab: 'profile', view: 'history' })}><History size={16} />変更履歴</Button>
      </div>

      {data.stale ? <NoteBar tone="warn" action={<button type="button" className="text-sm font-semibold" onClick={() => void load(true)}>{syncing ? '取得中…' : 'もう一度取得'}</button>}>Googleから最新の情報を取得できませんでした。前回取得した内容（{formatDateTime(data.fetchedAt)}）を表示しています。</NoteBar> : null}
      {!data.stale && data.closed ? <NoteBar tone="danger">Google側で「臨時休業」または「閉業」になっています。営業時間の変更はGoogleビジネスプロフィールで営業状態を戻してから行ってください。</NoteBar> : null}
      {!data.stale && !data.closed && data.pendingChangeCount > 0 ? <NoteBar action={<button type="button" className="text-sm font-semibold" onClick={() => go({ tab: 'profile', view: 'history', result: 'pending' })}>状態を確認</button>}>Googleに変更を送信しました。反映を確認できるまで「反映確認中」と表示します（{data.pendingChangeCount}件）。</NoteBar> : null}
      {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}

      <section className="border-hairline bg-accent-soft flex flex-col gap-4 rounded-card border p-5" aria-labelledby="gb-today-title">
        <div className="flex flex-wrap items-center gap-4">
          <Clock3 size={24} className="text-accent-deep shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 grow flex-col gap-1">
            <h3 id="gb-today-title" className="text-lead font-bold">本日の営業時間{today.holidayName ? <span className="text-ink-secondary ml-2 text-label font-normal">{formatYmdShort(today.date)}・{today.holidayName}</span> : <span className="text-ink-secondary ml-2 text-label font-normal">{formatYmdShort(today.date)}</span>}</h3>
            <p className="text-title font-semibold">{todayText}{today.special ? <span className="text-ink-secondary ml-2 text-label font-normal">特別営業時間</span> : null}</p>
          </div>
          <Button variant="primary" onClick={() => go({ tab: 'profile', view: 'hours', mode: 'text' })} disabled={!canChange}><Pencil size={16} />営業時間を変更</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void quick({ source: 'shortcut', shortcut: 'close_today' })} disabled={!canChange || today.closed}>今日を休みにする</Button>
          <Button onClick={() => { setEarlyClose(closeOptions[closeOptions.length - 1]?.value ?? null); setActionError('') }} disabled={!canChange || today.closed || closeOptions.length === 0}>今日は早く閉める</Button>
          <Button onClick={() => setShowHolidays((v) => !v)} aria-expanded={showHolidays}>祝日の営業時間を確認</Button>
          <span className="text-ink-secondary text-caption">すべて確認画面を経由します</span>
        </div>
        {earlyClose !== null ? (
          <div className="border-hairline bg-canvas flex flex-wrap items-center gap-3 rounded-control border px-4 py-3">
            <span className="text-sm font-semibold">今日の閉店時刻</span>
            <SelectField size="compact" aria-label="今日の閉店時刻" value={earlyClose} onChange={(event) => setEarlyClose(event.target.value)} options={closeOptions} />
            <span className="text-ink-secondary text-caption">現在 {formatPeriods(today.periods)}</span>
            <span className="grow" />
            <Button size="field" onClick={() => setEarlyClose(null)} disabled={busy}>やめる</Button>
            <Button size="field" variant="primary" onClick={() => void quick({ source: 'shortcut', shortcut: 'early_close_today', closeTime: earlyClose })} disabled={busy}>変更案を確認</Button>
          </div>
        ) : null}
        {showHolidays ? (
          <div className="border-hairline bg-canvas rounded-control border px-4 py-3">
            <p className="mb-2 text-sm font-semibold">今後30日の祝日</p>
            {data.holidays.length === 0 ? <p className="text-ink-secondary text-sm">今後30日に祝日はありません。</p> : (
              <ul className="flex flex-col gap-2">
                {data.holidays.map((h) => (
                  <li key={h.date} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-semibold">{formatYmdShort(h.date)}</span>
                    <span className="text-ink-secondary">{h.name}</span>
                    <span>{h.special ? `特別営業時間：${h.special.closed ? '休業' : formatPeriods(h.special.periods)}` : `通常どおり：${formatPeriods(profile.regularHours[h.weekday] ?? [], '定休日')}`}</span>
                    <span className="grow" />
                    <Button size="field" onClick={() => go({ tab: 'profile', view: 'hours', mode: 'calendar', date: h.date })} disabled={!canChange}>{h.special ? '変更する' : '設定する'}</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      <div className="gb-profile-grid grid min-w-0 grid-cols-1 gap-4">
        <section className="border-hairline bg-canvas flex flex-col gap-4 rounded-card border p-5" aria-labelledby="gb-store-info-title">
          <div className="flex flex-wrap items-center gap-3">
            <h3 id="gb-store-info-title" className="text-base font-bold">店舗情報</h3>
            <span className="grow" />
            <Button onClick={() => go({ tab: 'profile', view: 'edit' })} disabled={!canChange}><Pencil size={16} />プロフィールを編集</Button>
          </div>
          <p className="text-ink-faint text-caption">Googleに表示されている内容です。変更は1つの編集画面でまとめて行い、確認してから送信します。</p>
          <dl className="flex flex-col">
            {[
              ['店舗名', profile.title ?? '—'],
              ['住所', addressText(profile.address)],
              ['電話・ウェブサイト', [profile.phone, profile.websiteUri].filter(Boolean).join(' / ') || '未設定'],
              ['通常の営業時間', summarizeWeekly(profile.regularHours)],
              ['特別営業時間', specialUpcoming.length ? specialUpcoming.slice(0, 4).map((s) => `${formatYmdShort(s.date)} ${s.closed ? '休業' : formatPeriods(s.periods)}`).join('、') + (specialUpcoming.length > 4 ? ` ほか${specialUpcoming.length - 4}件` : '') : '今後の予定はありません'],
              ['写真・店舗紹介', `${data.photoCount === null ? '店舗写真 —' : `店舗写真 ${data.photoCount}枚`} / ${profile.description ? '紹介文あり' : '紹介文なし'}`],
            ].map(([label, value], index) => (
              <div key={label} className={`flex flex-col gap-1 py-4 ${index === 0 ? '' : 'border-hairline border-t'}`}>
                <dt className="text-ink-faint text-caption">{label}</dt>
                <dd className="truncate text-sm font-semibold" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-hairline bg-canvas flex flex-col gap-3 self-start rounded-card border p-5" aria-labelledby="gb-google-updates-title">
          <h3 id="gb-google-updates-title" className="text-lead font-bold">Google側の変更を確認</h3>
          {data.googleUpdates && data.googleUpdates.fields.length > 0 ? (
            <>
              <div><StatusBadge tone="warning">確認が必要 {data.googleUpdates.fields.length}件</StatusBadge></div>
              <p className="text-ink-secondary text-sm leading-relaxed">{data.googleUpdates.fields.map((f) => f.label).join('・')}の変更提案があります。以前の情報と比較して、店舗の実態に合うか確認してください。</p>
              <div><Button onClick={() => setShowDiff((v) => !v)} aria-expanded={showDiff}>{showDiff ? '差分を閉じる' : '差分を見る'}</Button></div>
              {showDiff ? (
                <dl className="border-hairline flex flex-col gap-2 rounded-control border p-3 text-caption">
                  {data.googleUpdates.fields.map((f) => {
                    const key = f.mask.split('.')[0]
                    const current = key === 'regularHours' ? summarizeWeekly(profile.regularHours) : key === 'specialHours' ? profile.specialHours.map((s) => `${formatYmdShort(s.date)} ${s.closed ? '休業' : formatPeriods(s.periods)}`).join('、') || 'なし' : key === 'storefrontAddress' ? addressText(profile.address) : key === 'phoneNumbers' ? profile.phone ?? '—' : key === 'profile' ? profile.description ?? '—' : key === 'title' ? profile.title ?? '—' : key === 'websiteUri' ? profile.websiteUri ?? '—' : '—'
                    const u = data.googleUpdates!.updated
                    const proposed = key === 'regularHours' && u.regularHours ? summarizeWeekly(u.regularHours) : key === 'specialHours' && u.specialHours ? u.specialHours.map((s) => `${formatYmdShort(s.date)} ${s.closed ? '休業' : formatPeriods(s.periods)}`).join('、') || 'なし' : key === 'storefrontAddress' ? addressText(u.address) : key === 'phoneNumbers' ? u.phone ?? '—' : key === 'profile' ? u.description ?? '—' : key === 'title' ? u.title ?? '—' : key === 'websiteUri' ? u.websiteUri ?? '—' : '（この画面では表示できない項目です）'
                    return (
                      <div key={f.mask} className="flex flex-col gap-1">
                        <dt className="font-semibold">{f.label}</dt>
                        <dd className="text-ink-secondary">現在：{current}</dd>
                        <dd className="text-status-warn-deep">Googleの提案：{proposed}</dd>
                      </div>
                    )
                  })}
                </dl>
              ) : null}
            </>
          ) : (
            <>
              <div><StatusBadge tone="neutral">{data.googleUpdates ? '確認が必要な変更はありません' : '未確認'}</StatusBadge></div>
              <p className="text-ink-secondary text-sm leading-relaxed">{data.googleUpdates ? 'Google側からの営業時間やプロフィールの変更提案は、いまはありません。' : 'Google側の変更提案を取得できませんでした。同期すると再確認します。'}</p>
              <div><Button onClick={() => void load(true)} disabled={syncing}>{syncing ? '取得中…' : '同期する'}</Button></div>
            </>
          )}
          <div className="border-hairline border-t pt-3">
            <p className="text-sm font-bold">来店前の不安を減らす</p>
            <p className="text-ink-secondary mt-2 text-label leading-relaxed">予約リンク・メニュー・駐車場などの属性も、対応状況を確認しながら追加できます。</p>
            <p className="text-ink-faint mt-2 text-caption">自動で以前の内容に戻すことはしません。</p>
          </div>
        </section>
      </div>
      <p className="text-ink-faint text-caption">最終取得 {formatDateTime(data.fetchedAt)}・店舗の時刻は{data.timeZone === 'Asia/Tokyo' ? '日本時間' : data.timeZone}で表示</p>
    </div>
  )
}

// ---------- GB-11 / 11-B / 11-C 営業時間を変更 ----------

function TimeSelect({ value, onChange, kind, label }: { value: string; onChange: (v: string) => void; kind: 'open' | 'close'; label: string }) {
  return (
    <span className="relative inline-flex min-w-0 shrink" style={{ flex: '1 1 84px', maxWidth: 120 }}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-canvas text-ink h-9 w-full appearance-none rounded-control border pr-7 pl-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-info"
        style={{ borderColor: 'var(--color-hairline)' }}
      >
        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{kind === 'close' && t === '00:00' ? '24:00' : t}</option>)}
      </select>
      <ChevronDown size={14} className="text-ink-faint pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2" aria-hidden="true" />
    </span>
  )
}

function periodsProblem(periods: GoogleHoursPeriod[]): string | null {
  if (periods.length > 3) return '1日の枠は3つまでです'
  const min = (v: string) => Number.parseInt(v.slice(0, 2), 10) * 60 + Number.parseInt(v.slice(3, 5), 10)
  const sorted = [...periods].sort((a, b) => min(a.open) - min(b.open))
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]
    if (cur.open === cur.close) return '開始と終了が同じ時刻です'
    const close = cur.close === '00:00' ? 24 * 60 : min(cur.close)
    const overnight = close <= min(cur.open)
    if (overnight && i !== sorted.length - 1) return '翌日にまたぐ枠は、その日の最後の枠にしてください'
    const next = sorted[i + 1]
    if (next && !overnight && min(next.open) < close) return '枠が重なっています'
  }
  return null
}

/** 変更前後の枠を比べ、枠数が同じなら変わった枠だけを「17:00–22:00 → 17:00–23:00」の形で返す。 */
function periodDiff(before: GoogleHoursPeriod[], after: GoogleHoursPeriod[]): [string, string] {
  if (before.length === after.length && before.length > 0) {
    const changed = before.map((p, i) => [p, after[i]] as const).filter(([b, a]) => b.open !== a.open || b.close !== a.close)
    if (changed.length > 0) return [formatPeriods(changed.map(([b]) => b)), formatPeriods(changed.map(([, a]) => a))]
  }
  return [formatPeriods(before, '定休日'), formatPeriods(after, '定休日')]
}

function ChangeTargetCard({ storeName, today, timeZone, title, current, note, hint }: { storeName: string; today: string; timeZone: string; title: string; current: ReactNode; note: string; hint: string }) {
  return (
    <section className="border-hairline bg-canvas flex flex-col gap-4 self-start rounded-card border p-5" aria-label="変更対象の確認">
      <h3 className="text-lead font-bold">{storeName}</h3>
      <p className="text-ink-faint text-label leading-relaxed">基準日：{formatYmdJa(today, true)}<br />タイムゾーン：{timeZone}</p>
      <div className="border-hairline border-t pt-4">
        <p className="text-sm font-semibold">{title}</p>
        <div className="text-heading mt-2 leading-relaxed font-semibold">{current}</div>
      </div>
      <p className="text-ink-secondary text-sm leading-relaxed">{note}</p>
      <p className="text-ink-faint text-label leading-relaxed">{hint}</p>
    </section>
  )
}

export function HoursEditor({ accountId, mode, initialDate, go }: { accountId: string; mode: HoursMode; initialDate?: string | null; go: ProfileNav }) {
  const [data, setData] = useState<GoogleProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [text, setText] = useState('')
  const [question, setQuestion] = useState('')
  const [days, setDays] = useState<Record<string, GoogleDayHours>>({})
  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? '')
  const [month, setMonth] = useState<string>('') // YYYY-MM
  const [weekly, setWeekly] = useState<GoogleWeeklyHours | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    restaurantGoogleApi.profile(accountId)
      .then((response) => {
        if (!alive) return
        setData(response)
        setWeekly(response.profile.regularHours)
        const start = initialDate && initialDate >= response.today.date ? initialDate : response.today.date
        setSelectedDate(start)
        setMonth(start.slice(0, 7))
      })
      .catch((err) => { if (alive) setLoadError(errorMessage(err, 'プロフィールを読み込めませんでした。')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [accountId, initialDate])

  const weeklyChanged = useMemo(() => (data && weekly ? WEEKDAYS.filter((d) => !samePeriods(weekly[d] ?? [], data.profile.regularHours[d] ?? [])) : []), [data, weekly])
  const dirty = mode === 'text' ? text.trim().length > 0 : mode === 'calendar' ? Object.keys(days).length > 0 : weeklyChanged.length > 0
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  const clear = () => {
    setText('')
    setQuestion('')
    setDays({})
    setActionError('')
    if (data) setWeekly(data.profile.regularHours)
  }

  const submit = async () => {
    if (!data) return
    let proposal: GoogleHoursProposal
    if (mode === 'text') proposal = { source: 'text', text: text.trim() }
    else if (mode === 'calendar') {
      const list = Object.values(days)
      const bad = list.map((d) => (d.closed ? null : d.periods.length === 0 ? '営業する日は枠を1つ以上入れてください' : periodsProblem(d.periods))).find(Boolean)
      if (bad) { setActionError(bad); return }
      proposal = { source: 'calendar', days: list }
    } else {
      const bad = WEEKDAYS.map((d) => { const p = periodsProblem(weekly![d] ?? []); return p ? `${WEEKDAY_JA[d]}曜：${p}` : null }).find(Boolean)
      if (bad) { setActionError(bad); return }
      proposal = { source: 'weekly', weekly: weekly! }
    }
    setBusy(true)
    setActionError('')
    setQuestion('')
    try {
      const response = await restaurantGoogleApi.proposeHours(accountId, proposal)
      if (response.change) {
        setDays({}); setText(''); if (data) setWeekly(data.profile.regularHours)
        go({ tab: 'profile', view: 'confirm', id: response.change.id })
      } else setQuestion(response.question ?? 'もう少し具体的に教えてください。')
    } catch (err) {
      setActionError(err instanceof ApiError && err.code === 'unchanged' ? 'すでにその営業時間になっています。' : errorMessage(err, '変更案を作れませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <ListState kind="loading" title="営業時間を読み込んでいます" />
  if (loadError || !data || !weekly) return <ListState kind="error" title="営業時間を表示できませんでした" description={loadError} onRetry={() => go({ tab: 'profile', view: 'hours', mode })} action={<Button onClick={() => go({ tab: 'profile' })}>プロフィールへ戻る</Button>} />

  const { profile, today, timeZone } = data
  const storeName = profile.title ?? data.store.name
  const node = PROFILE_DESIGN_NODES[`hours:${mode}`]
  const canSubmit = !busy && dirty && !data.closed

  const modeTabs = (
    <PillTabs
      label="営業時間の変更方式"
      items={[
        { key: 'text', label: <><Sparkles size={16} />かんたん入力</>, current: mode === 'text', onClick: () => go({ tab: 'profile', view: 'hours', mode: 'text' }) },
        { key: 'calendar', label: 'カレンダーで指定', current: mode === 'calendar', onClick: () => go({ tab: 'profile', view: 'hours', mode: 'calendar' }) },
        { key: 'weekly', label: '毎週の営業時間', current: mode === 'weekly', onClick: () => go({ tab: 'profile', view: 'hours', mode: 'weekly' }) },
      ]}
    />
  )

  // ---- 右側「変更対象の確認」 ----
  const editedDates = Object.keys(days).sort()
  const side = (
    <ChangeTargetCard
      storeName={storeName}
      today={today.date}
      timeZone={timeZone}
      title={`現在の${WEEKDAY_JA[today.weekday]}曜日`}
      current={(profile.regularHours[today.weekday] ?? []).length ? (profile.regularHours[today.weekday] ?? []).map((p, i, arr) => <p key={i}>{arr.length > 1 ? (i === 0 ? '昼 ' : i === 1 ? '夜 ' : '') : ''}{p.open}–{p.close === '00:00' ? '24:00' : p.close}</p>) : <p>定休日</p>}
      note="文章から「いつ・何時に」を読み取り、1日だけの特別営業時間または毎週の営業時間の変更案を作ります。"
      hint="毎週変えたい場合は「毎週の営業時間」から設定してください。"
    />
  )

  // ---- 左側 ----
  let main: ReactNode
  if (mode === 'text') {
    main = (
      <div className="flex min-w-0 flex-col gap-4">
        <h3 className="text-lead font-bold">いつ、何時に変更しますか？</h3>
        <div className="flex flex-col gap-2">
          <label htmlFor="gb-hours-text" className="text-label font-semibold">文章で入力</label>
          <TextArea id="gb-hours-text" value={text} onChange={(event) => { setText(event.target.value); setQuestion('') }} rows={4} maxLength={500} placeholder="例：今週の金曜日は9:00から17:00オープンにして" disabled={!data.aiAvailable} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled title="音声入力は次の段階で対応します"><Mic size={16} />話して入力</Button>
          <span className="text-ink-faint text-label">音声は文字にして確認できます（この段階では文章入力のみ）</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => { setText('今日を休みにして'); setQuestion('') }} disabled={!data.aiAvailable}>今日を休みにして</Button>
          <Button onClick={() => { setText('明日は20時に閉店'); setQuestion('') }} disabled={!data.aiAvailable}>明日は20時に閉店</Button>
        </div>
        <p className="text-ink-faint text-caption">音声が使えない端末では、文章またはカレンダーから入力できます。</p>
        {!data.aiAvailable ? <NoteBar tone="warn">この環境ではかんたん入力（AI）は使えません。「カレンダーで指定」または「毎週の営業時間」から変更してください。</NoteBar> : null}
        {question ? <NoteBar tone="warn">{question}</NoteBar> : null}
        <InfoNote>AIは変更案を作成するだけです。この画面ではGoogleの営業時間は変わりません。</InfoNote>
        <div>
          <p className="text-sm font-bold">日付があいまいな場合は確認します</p>
          <p className="text-ink-secondary mt-2 text-label leading-relaxed">例：「来週の祝日」→ 対象期間と祝日を照合します。該当なし・複数候補なら日付を選び直します。</p>
        </div>
      </div>
    )
  } else if (mode === 'calendar') {
    const [y, m] = month.split('-').map((x) => Number.parseInt(x, 10))
    const first = new Date(Date.UTC(y, m - 1, 1))
    const lead = (first.getUTCDay() + 6) % 7
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const cells: Array<string | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
    while (cells.length % 7 !== 0) cells.push(null)
    const weeks: Array<Array<string | null>> = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    const maxDate = addDays(today.date, 366)
    const shiftMonth = (delta: number) => { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`) }
    const special = (date: string) => profile.specialHours.find((s) => s.date === date) ?? null
    const originalFor = (date: string): GoogleDayHours => { const s = special(date); return s ? { date, closed: s.closed, periods: s.periods } : { date, closed: false, periods: profile.regularHours[weekdayOf(date)] ?? [] } }
    const currentFor = (date: string): GoogleDayHours => days[date] ?? originalFor(date)
    const edited = selectedDate ? currentFor(selectedDate) : null
    const original = selectedDate ? originalFor(selectedDate) : null
    const setDay = (next: GoogleDayHours) => setDays((prev) => ({ ...prev, [next.date]: next }))
    const problem = edited && !edited.closed ? periodsProblem(edited.periods) : null
    const describe = (d: GoogleDayHours, closedLabel: string) => (d.closed || d.periods.length === 0 ? closedLabel : d.periods.map((p, i, arr) => `${arr.length > 1 ? (i === 0 ? '昼 ' : i === 1 ? '夜 ' : '') : ''}${p.open}–${p.close === '00:00' ? '24:00' : p.close}`).join(' ／ '))

    main = (
      <div className="flex min-w-0 flex-col gap-4">
        <h3 className="text-lead font-bold">日付を選んで、その日の営業時間を決めます</h3>
        <p className="text-ink-faint text-label">基準日：{formatYmdJa(today.date, true)}・{timeZone === 'Asia/Tokyo' ? '日本時間（Asia/Tokyo）' : timeZone}・{storeName}</p>
        <div className="gb-calendar-grid grid min-w-0 grid-cols-1 items-start gap-6">
          <div className="border-hairline bg-canvas flex w-full flex-col gap-2 rounded-card border p-4" style={{ maxWidth: 480 }} role="group" aria-label="カレンダー">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="前の月" className="bg-canvas text-ink-secondary flex h-8 w-8 items-center justify-center rounded-control border hover:bg-canvas-sunken" style={{ borderColor: 'var(--color-hairline)' }}><ChevronLeft size={16} /></button>
              <span className="text-base font-bold">{y}年{m}月</span>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="次の月" className="bg-canvas text-ink-secondary flex h-8 w-8 items-center justify-center rounded-control border hover:bg-canvas-sunken" style={{ borderColor: 'var(--color-hairline)' }}><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-caption">
              {WEEKDAYS.map((d) => <span key={d} className={d === 'SATURDAY' ? 'text-status-info' : d === 'SUNDAY' ? 'text-status-danger' : 'text-ink-faint'}>{WEEKDAY_JA[d]}</span>)}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((date, di) => {
                  if (!date) return <span key={di} className="border-hairline bg-canvas rounded-control border" style={{ height: 56 }} aria-hidden="true" />
                  const past = date < today.date
                  const tooFar = date > maxDate
                  const s = special(date)
                  const changed = Boolean(days[date])
                  const selected = date === selectedDate
                  const isToday = date === today.date
                  const mark = changed ? (days[date].closed ? '休業（変更）' : '変更') : s ? (s.closed ? '休業' : formatPeriods(s.periods).replace(/:00/g, '')) : ''
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={past || tooFar}
                      aria-pressed={selected}
                      aria-label={`${formatYmdJa(date, true)}${mark ? ` ${mark}` : ''}${isToday ? ' 今日' : ''}`}
                      onClick={() => setSelectedDate(date)}
                      className={`flex flex-col items-start gap-1 rounded-control border px-2 py-1.5 text-left text-label disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'text-on-accent border-transparent font-bold' : s || changed ? 'bg-status-warn-soft text-ink' : 'bg-canvas text-ink hover:bg-canvas-sunken'}`}
                      style={{ height: 56, backgroundColor: selected ? 'var(--color-accent-deep)' : undefined, borderColor: selected ? 'transparent' : isToday ? 'var(--color-accent)' : 'var(--color-hairline)', borderWidth: isToday && !selected ? 2 : 1 }}
                    >
                      <span className={`${past ? 'text-ink-faint' : ''} leading-tight`}>{Number.parseInt(date.slice(8, 10), 10)}</span>
                      <span className={`truncate text-nano leading-tight ${selected ? '' : 'text-status-warn-deep'}`} style={{ maxWidth: '100%' }}>{selected ? '選択中' : mark}</span>
                    </button>
                  )
                })}
              </div>
            ))}
            <p className="text-caption flex flex-wrap gap-4"><span className="text-status-warn-deep">■ 特別営業時間あり</span><span className="text-ink-faint">枠線＝今日</span><span className="text-ink-faint">過去の日付は選べません</span></p>
          </div>

          {edited && original ? (
            <section className="border-hairline bg-canvas flex min-w-0 flex-col gap-3 rounded-card border p-5" aria-label={`${formatYmdJa(edited.date)}の営業時間`}>
              <h4 className="text-base font-bold">{formatYmdJa(edited.date)}の営業時間</h4>
              <p className="text-sm"><span className="text-ink-faint mr-2 text-caption">現在</span><span className="font-semibold">{describe(original, original.closed && special(edited.date) ? '休業（特別営業時間）' : '定休日')}</span></p>
              <div className="flex items-center gap-3">
                <span className="shrink-0"><Toggle checked={edited.closed} label="この日は休業にする" onChange={(next) => setDay({ ...edited, closed: next, periods: next ? [] : (profile.regularHours[weekdayOf(edited.date)] ?? []) })} /></span>
                <span className="text-sm">この日は休業にする（時間の枠をすべて外します）</span>
              </div>
              {!edited.closed ? (
                <>
                  {edited.periods.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-label w-6 shrink-0 font-semibold">枠{i + 1}</span>
                      <TimeSelect kind="open" label={`枠${i + 1}の開始`} value={p.open} onChange={(v) => setDay({ ...edited, periods: edited.periods.map((x, j) => (j === i ? { ...x, open: v } : x)) })} />
                      <span className="text-ink-faint">–</span>
                      <TimeSelect kind="close" label={`枠${i + 1}の終了`} value={p.close} onChange={(v) => setDay({ ...edited, periods: edited.periods.map((x, j) => (j === i ? { ...x, close: v } : x)) })} />
                      <button type="button" aria-label={`枠${i + 1}を削除`} onClick={() => setDay({ ...edited, periods: edited.periods.filter((_, j) => j !== i) })} className="text-ink-faint flex h-8 w-8 shrink-0 items-center justify-center rounded-control hover:bg-canvas-sunken"><X size={16} /></button>
                    </div>
                  ))}
                  <div><Button onClick={() => setDay({ ...edited, periods: [...edited.periods, { open: edited.periods.length ? edited.periods[edited.periods.length - 1].close : '11:00', close: '22:00' }] })} disabled={edited.periods.length >= 3}><Plus size={16} />枠を追加（1日3枠まで）</Button></div>
                  {problem ? <p className="text-danger text-caption">{problem}</p> : null}
                  {edited.periods.length === 0 ? <p className="text-danger text-caption">営業する日は枠を1つ以上入れてください（休業なら上のスイッチを入れてください）。</p> : null}
                </>
              ) : null}
              <p className="text-ink-faint text-caption">15分刻みで選べます。翌日にまたぐ時間（例：18:00–02:00）はそのまま入力できます。</p>
            </section>
          ) : null}
        </div>

        {editedDates.length > 0 ? (
          <section className="border-hairline bg-canvas flex flex-col gap-2 rounded-card border p-4" aria-label="変更する日の一覧">
            <h4 className="text-sm font-bold">変更する日（{editedDates.length}日）</h4>
            {editedDates.map((date) => (
              <div key={date} className="flex flex-wrap items-center gap-3 text-sm">
                <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => { setSelectedDate(date); setMonth(date.slice(0, 7)) }}>{formatYmdShort(date)}</button>
                <span className="text-ink-faint">{describe(originalFor(date), '定休日')}</span>
                <span className="text-ink-faint">→</span>
                <span className="text-accent-deep font-bold">{describe(days[date], '休業')}</span>
                <span className="grow" />
                <Button size="field" onClick={() => setDays((prev) => { const next = { ...prev }; delete next[date]; return next })}>この日の変更を取り消す</Button>
              </div>
            ))}
          </section>
        ) : null}
        <InfoNote>ここで決めた内容は、その日だけの特別営業時間になります。「変更案を確認」を押すまでGoogleの営業時間は変わりません。</InfoNote>
      </div>
    )
  } else {
    const setDayPeriods = (d: GoogleWeekday, periods: GoogleHoursPeriod[]) => setWeekly({ ...weekly, [d]: periods })
    main = (
      <div className="flex min-w-0 flex-col gap-4">
        <h3 className="text-lead font-bold">毎週の営業時間（通常の営業時間）を決めます</h3>
        <p className="text-ink-faint text-label">基準日：{formatYmdJa(today.date, true)}・{timeZone === 'Asia/Tokyo' ? '日本時間（Asia/Tokyo）' : timeZone}・{storeName}</p>
        <div className="border-hairline overflow-hidden rounded-card border" role="table" aria-label="曜日ごとの営業時間">
          <div className="bg-surface-pearl text-ink-faint flex items-center gap-3 px-4 text-caption font-semibold" style={{ height: 40 }} role="row">
            <span role="columnheader" className="shrink-0" style={{ width: 72 }}>曜日</span><span role="columnheader" className="shrink-0" style={{ width: 64 }}>定休日</span><span role="columnheader">営業時間の枠（開始–終了、1日3枠まで）</span>
          </div>
          {WEEKDAYS.map((d) => {
            const periods = weekly[d] ?? []
            const closed = periods.length === 0
            const changed = weeklyChanged.includes(d)
            return (
              <div key={d} role="row" className={`border-hairline flex items-center gap-3 border-t px-4 py-2 ${changed ? 'bg-accent-soft' : 'bg-canvas'}`} style={{ minHeight: 54 }}>
                <span role="rowheader" className={`flex shrink-0 items-center gap-1 text-sm font-bold ${d === 'SATURDAY' ? 'text-status-info' : d === 'SUNDAY' ? 'text-status-danger' : ''}`} style={{ width: 72 }}>{WEEKDAY_JA[d]}曜{changed ? <span className="text-accent-deep text-nano font-semibold">変更</span> : null}</span>
                <span role="cell" className="shrink-0" style={{ width: 64 }}><Toggle checked={closed} label={`${WEEKDAY_JA[d]}曜を定休日にする`} onChange={(next) => setDayPeriods(d, next ? [] : (profile.regularHours[d]?.length ? profile.regularHours[d] : [{ open: '11:00', close: '22:00' }]))} /></span>
                <span role="cell" className="flex min-w-0 grow flex-wrap items-center gap-4">
                  {closed ? <span className="text-ink-faint text-sm">定休日</span> : periods.map((p, i) => (
                    <span key={i} className="flex items-center gap-2">
                      <TimeSelect kind="open" label={`${WEEKDAY_JA[d]}曜 枠${i + 1}の開始`} value={p.open} onChange={(v) => setDayPeriods(d, periods.map((x, j) => (j === i ? { ...x, open: v } : x)))} />
                      <span className="text-ink-faint">–</span>
                      <TimeSelect kind="close" label={`${WEEKDAY_JA[d]}曜 枠${i + 1}の終了`} value={p.close} onChange={(v) => setDayPeriods(d, periods.map((x, j) => (j === i ? { ...x, close: v } : x)))} />
                      {periods.length > 1 && i === periods.length - 1 ? <button type="button" aria-label={`${WEEKDAY_JA[d]}曜 枠${i + 1}を削除`} onClick={() => setDayPeriods(d, periods.filter((_, j) => j !== i))} className="text-ink-faint flex h-7 w-7 shrink-0 items-center justify-center rounded-control hover:bg-canvas-sunken"><X size={16} /></button> : null}
                    </span>
                  ))}
                  {!closed && periods.length < 3 ? <Button size="field" onClick={() => setDayPeriods(d, [...periods, { open: periods[periods.length - 1]?.close ?? '17:00', close: '22:00' }])}><Plus size={14} />枠を追加</Button> : null}
                </span>
              </div>
            )
          })}
        </div>
        <section className="border-hairline bg-canvas flex flex-col gap-2 rounded-card border p-4" aria-label="変更した曜日">
          <h4 className="text-sm font-bold">変更した曜日（{weeklyChanged.length}）</h4>
          {weeklyChanged.length === 0 ? <p className="text-ink-faint text-sm">まだ変更はありません。</p> : weeklyChanged.map((d) => { const [b, a] = periodDiff(profile.regularHours[d] ?? [], weekly[d] ?? []); return <p key={d} className="flex flex-wrap items-center gap-3 text-sm"><span className="font-semibold">{WEEKDAY_JA[d]}曜</span><span className="text-ink-faint">{b}</span><span className="text-ink-faint">→</span><span className="text-accent-deep font-bold">{a}</span></p> })}
          <p className="text-ink-faint text-caption">変えていない曜日はそのままです。特定の日だけ変えたい場合は「カレンダーで指定」から設定してください。</p>
        </section>
        <p className="text-ink-faint text-caption">15分刻みで選べます。翌日にまたぐ時間（例：18:00–02:00）はそのまま入力できます。特別営業時間が設定されている日は、そちらが優先されます。</p>
        <InfoNote>ここで変えた曜日は、毎週その時間になります。「変更案を確認」を押すまでGoogleの営業時間は変わりません。</InfoNote>
      </div>
    )
  }

  return (
    <div data-design-node={node} className="text-ink flex min-w-0 flex-col gap-4">
      <BackButton label="プロフィールへ戻る" onClick={() => go({ tab: 'profile' })} />
      <h2 className="text-heading font-bold">営業時間を変更</h2>
      {modeTabs}
      {data.closed ? <NoteBar tone="danger">Google側で「臨時休業」または「閉業」になっているため、営業時間は変更できません。</NoteBar> : null}
      {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}
      {mode === 'text' ? (
        <div className="gb-profile-grid grid min-w-0 grid-cols-1 gap-6">
          {main}
          {side}
        </div>
      ) : main}
      <StickyBar actions={<><Button onClick={clear} disabled={busy || !dirty}>入力をクリア</Button><Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>{busy ? '確認中…' : '変更案を確認'}</Button></>} />
      <ConfirmDialog open={leaveTarget !== null} title="入力した内容があります" description="このまま移動すると、入力した営業時間の変更は失われます。Googleにはまだ何も送っていません。" confirmLabel="入力を捨てて移動" cancelLabel="入力を続ける" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

// ---------- GB-12 / GB-19 変更確認（＋GB-15 反映確認中・変更競合） ----------

function describeHours(value: unknown, kind: GoogleChange['kind']): ReactNode {
  if (kind === 'special_hours') {
    const days = (value as GoogleDayHours[] | null) ?? []
    return days.map((d) => (
      <div key={d.date}>
        {days.length > 1 ? <p className="text-label font-normal">{formatYmdShort(d.date)}</p> : null}
        {d.closed ? <p>休業</p> : d.periods.map((p, i) => <p key={i}>{p.open}–{p.close === '00:00' ? '24:00' : p.close}</p>)}
      </div>
    ))
  }
  const weekly = (value as Partial<GoogleWeeklyHours> | null) ?? {}
  return WEEKDAYS.filter((d) => weekly[d] !== undefined).map((d) => <p key={d}><span className="text-label mr-2 font-normal">{WEEKDAY_JA[d]}曜</span>{formatPeriods(weekly[d] ?? [], '定休日')}</p>)
}

function describeProfileValue(field: string, value: unknown): string {
  if (field === 'address') return addressText(value as GoogleProfileAddress | null)
  if (field === 'photo') {
    const v = value as { action?: string; filename?: string; mediaName?: string } | null
    return v?.action === 'add' ? `写真を追加（${v.filename ?? ''}）` : v?.action === 'delete' ? '写真を削除' : '—'
  }
  if (value === null || value === undefined || value === '') return '（未設定）'
  return String(value)
}

export function ChangeConfirmScreen({ accountId, ids, go }: { accountId: string; ids: string[]; go: ProfileNav }) {
  const [index, setIndex] = useState(0)
  const id = ids[index] ?? ids[0]
  const [change, setChange] = useState<GoogleChange | null>(null)
  const [store, setStore] = useState<{ name: string; timeZone: string } | null>(null)
  const [writeEnabled, setWriteEnabled] = useState(true)
  const [canSend, setCanSend] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [conflict, setConflict] = useState<unknown>(null)
  const [sent, setSent] = useState<{ alreadyApplied: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    setChecked(false)
    setConflict(null)
    setSent(null)
    setActionError('')
    try {
      const response = await restaurantGoogleApi.change(accountId, id)
      setChange(response.change)
      setStore({ name: response.store.name, timeZone: response.store.timeZone })
      setWriteEnabled(response.writeEnabled)
      setCanSend(response.canSend)
    } catch (err) {
      setLoadError(errorMessage(err, '変更案を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [accountId, id])

  useEffect(() => { void load() }, [load])

  const send = async () => {
    setBusy(true)
    setActionError('')
    try {
      const response = await restaurantGoogleApi.sendChange(accountId, id)
      setChange(response.change)
      setSent({ alreadyApplied: response.alreadyApplied })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        const data = err.data as { current?: unknown; change?: GoogleChange } | undefined
        setConflict(data?.current ?? null)
        if (data?.change) setChange(data.change)
      } else if (err instanceof ApiError && err.status === 502) {
        setActionError('Googleへの送信結果を確認できませんでした。重複を防ぐため、次に「Googleに変更を送信」を押したときはGoogle側の状態を照合してから送ります。')
        await load()
      } else {
        setActionError(errorMessage(err, 'Googleへの送信に失敗しました。'))
        if (err instanceof ApiError && (err.data as { change?: GoogleChange } | undefined)?.change) setChange((err.data as { change: GoogleChange }).change)
      }
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      await restaurantGoogleApi.cancelChange(accountId, id)
      go({ tab: 'profile' })
    } catch (err) {
      setActionError(errorMessage(err, '取り消せませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <ListState kind="loading" title="変更内容を読み込んでいます" />
  if (loadError || !change || !store) return <ListState kind="error" title="変更内容を表示できませんでした" description={loadError} onRetry={() => void load()} action={<Button onClick={() => go({ tab: 'profile' })}>プロフィールへ戻る</Button>} />

  const isHours = change.kind === 'special_hours' || change.kind === 'regular_hours'
  const field = 'field' in change.target ? change.target.field : null
  const node = isHours ? 't73h64' : 'pRLAQ'
  const status = STATUS_LABEL[change.status]
  const done = change.status === 'applied' || change.status === 'accepted'
  const backLabel = isHours ? '入力に戻る' : '編集に戻る'
  const backTo = () => (isHours ? go({ tab: 'profile', view: 'hours', mode: change.source === 'weekly' ? 'weekly' : change.source === 'calendar' ? 'calendar' : 'text' }) : go({ tab: 'profile', view: 'edit' }))
  const title = isHours
    ? change.kind === 'special_hours'
      ? `${(change.after as GoogleDayHours[]).map((d) => formatYmdJa(d.date, true)).join('・')}のみ`
      : `毎週 ${('weekdays' in change.target ? change.target.weekdays : []).map((d) => `${WEEKDAY_JA[d]}曜`).join('・')}`
    : FIELD_LABEL[field ?? ''] ?? 'プロフィール'
  const kindText = change.kind === 'special_hours' ? '特別営業時間（1日だけ）' : change.kind === 'regular_hours' ? '通常の営業時間（毎週）' : change.kind === 'photo' ? 'プロフィール（写真）' : `プロフィール（${FIELD_LABEL[field ?? ''] ?? ''}）`
  const scopeText = change.kind === 'special_hours'
    ? '通常の営業時間・ほかの日付の営業時間は変更しません。'
    : change.kind === 'regular_hours'
      ? '変えていない曜日・特別営業時間は変更しません。特別営業時間が設定されている日は、そちらが優先されます。'
      : `${['店舗名', '住所', '電話', '営業時間', '写真'].filter((x) => x !== FIELD_LABEL[field ?? '']).join('・')}は変更しません。${field === 'address' ? '住所を変えた場合は、Googleが本人確認（はがきの郵送など）を求めることがあります。' : ''}`
  const afterNote = change.kind === 'special_hours'
    ? (() => { const days = change.after as GoogleDayHours[]; const before = (change.before as GoogleDayHours[] | null) ?? []; return days.length === 1 && before[0] ? (days[0].closed ? `この日の${before[0].periods.length}枠をすべて外し、休業にします。` : `この日の${before[0].closed ? '休業' : `${before[0].periods.length}枠`}を、上記の${days[0].periods.length}枠に置き換えます。`) : `${days.length}日分の特別営業時間を置き換えます。` })()
    : change.kind === 'regular_hours'
      ? '対象の曜日だけを置き換え、毎週この時間になります。'
      : field === 'description'
        ? `文字数 ${String((change.before as string | null) ?? '').length} → ${String((change.after as string | null) ?? '').length}（上限 750）。改行はそのまま反映されます。`
        : field === 'photo'
          ? '写真はGoogleの審査後に反映されます。'
          : 'Googleの審査後に反映されることがあります。'
  const beforeNode = isHours ? describeHours(change.before, change.kind) : <p className="whitespace-pre-wrap">{describeProfileValue(field ?? '', change.before)}</p>
  const afterNode = isHours ? describeHours(change.after, change.kind) : <p className="whitespace-pre-wrap">{describeProfileValue(field ?? '', change.after)}</p>
  const canPress = canSend && writeEnabled && checked && !busy && !done && change.status !== 'cancelled' && conflict === null

  return (
    <div data-design-node={node} className="text-ink flex min-w-0 flex-col gap-4">
      <BackButton label={done || change.status === 'cancelled' ? 'プロフィールへ戻る' : backLabel} onClick={() => (done || change.status === 'cancelled' ? go({ tab: 'profile' }) : backTo())} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-heading font-bold">{done ? (isHours ? '営業時間の変更をGoogleに送信しました' : 'プロフィールの変更をGoogleに送信しました') : isHours ? 'この内容で営業時間を変更しますか？' : 'この内容でプロフィールを変更しますか？'}</h2>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {ids.length > 1 ? <span className="text-ink-faint text-label">{index + 1} / {ids.length}件目</span> : null}
      </div>
      <p className="text-ink-secondary text-sm">対象店舗：{store.name}　/　{isHours ? (store.timeZone === 'Asia/Tokyo' ? '日本時間（Asia/Tokyo）' : store.timeZone) : `変更する項目：${FIELD_LABEL[field ?? ''] ?? ''}`}</p>

      {sent ? <NoteBar>{sent.alreadyApplied ? 'この内容はすでにGoogleに反映されていました。送信はしていません。' : change.status === 'applied' ? 'Googleに変更を送信し、反映を確認しました。' : 'Googleに変更を送信しました。反映を確認できるまで「反映確認中」と表示します。審査・同期に時間がかかることがあります。'}</NoteBar> : null}
      {conflict !== null ? (
        <NoteBar tone="danger" action={<button type="button" className="text-sm font-semibold" onClick={() => go({ tab: 'profile' })}>最新の内容を確認</button>}>
          別の担当者が{isHours ? '営業時間' : 'この項目'}を変更しました。古い値で上書きしないため送信を止めました。Google側の現在の値：{isHours ? describeHours(conflict, change.kind) : describeProfileValue(field ?? '', conflict)}
        </NoteBar>
      ) : null}
      {change.status === 'pending_confirm' && !sent ? <NoteBar tone="warn">前回の送信結果を確認できていません。「Googleに変更を送信」を押すと、先にGoogle側の状態を照合してから送信します。</NoteBar> : null}
      {change.status === 'failed' && !sent ? <NoteBar tone="danger">前回の送信は失敗しました{change.error ? `（${change.error}）` : ''}。内容を確認して、もう一度送信できます。</NoteBar> : null}
      {change.status === 'cancelled' ? <NoteBar tone="warn">この変更は取り消されています。</NoteBar> : null}
      {!writeEnabled ? <NoteBar tone="warn">この環境ではGoogleへの送信が許可されていません。変更案の作成と確認まではできます。</NoteBar> : null}
      {writeEnabled && !canSend ? <NoteBar tone="warn">Googleへの送信は店舗管理者以上が行います。この変更案は保存されているので、管理者が「変更履歴」から確認して送信できます。</NoteBar> : null}
      {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}

      <section className="border-hairline bg-canvas flex flex-col gap-5 rounded-card border p-5">
        <h3 className="text-metric font-bold">{title}</h3>
        <div className="gb-compare-grid grid min-w-0 grid-cols-1 items-center gap-6">
          <div className="border-hairline bg-canvas flex flex-col gap-3 rounded-card border p-5">
            <p className="text-ink-faint text-label">現在</p>
            <div className={`text-ink-secondary leading-relaxed font-semibold ${isHours ? 'text-hero' : 'text-lead'}`}>{beforeNode}</div>
          </div>
          <ArrowRight size={24} className="text-ink-faint hidden shrink-0 justify-self-center lg:block" aria-hidden="true" />
          <div className="bg-accent-soft border-accent flex flex-col gap-3 rounded-card border p-5">
            <p className="text-accent-deep text-label font-semibold">変更後</p>
            <div className={`leading-relaxed font-bold ${isHours ? 'text-hero' : 'text-lead'}`}>{afterNode}</div>
            <p className="text-ink-secondary text-label">{afterNote}</p>
          </div>
        </div>
        <p className="text-sm font-semibold">変更の種類：{kindText}</p>
        <p className="text-ink-secondary text-sm">{scopeText}</p>
        {isHours ? <p className={`text-sm ${change.reservationImpactCount > 0 ? 'text-status-warn-deep font-semibold' : 'text-ink-secondary'}`}>{change.reservationImpactCount > 0 ? `予約への影響：変更後の営業時間の外に始まる予約が ${change.reservationImpactCount}件 あります（予約台帳で確認してください）` : '予約への影響はありません'}</p> : null}
        {change.inputText ? <p className="text-ink-faint text-caption">入力した文章：「{change.inputText}」</p> : null}
      </section>

      <InfoNote>反映直前にGoogleの最新情報を再確認します。他の担当者が{isHours ? '' : '同じ項目を'}変更していた場合は、差分を表示して止めます。</InfoNote>

      {!done && change.status !== 'cancelled' ? (
        <section className="border-hairline bg-canvas flex flex-col gap-3 rounded-card border p-5">
          <Checkbox checked={checked} onCheckedChange={setChecked} description={null}>
            <span className="text-sm font-semibold">{isHours ? '店舗・日付・時間を確認しました' : '店舗・項目・内容を確認しました'}</span>
          </Checkbox>
          <p className="text-ink-secondary text-label">反映後にGoogleから再取得して確認します。審査・同期に時間がかかる場合は「反映確認中」と表示します。</p>
          <p className="text-ink-faint text-caption">送信した担当者・対象項目・日時を記録します。失敗時も同じ変更を重複して送信しません。</p>
        </section>
      ) : null}

      {done || change.status === 'cancelled' ? (
        <StickyBar actions={<>{ids.length > 1 && index < ids.length - 1 ? <Button variant="primary" onClick={() => setIndex(index + 1)}>次の変更へ</Button> : null}<Button variant={ids.length > 1 && index < ids.length - 1 ? 'secondary' : 'primary'} onClick={() => go({ tab: 'profile' })}>プロフィールへ戻る</Button><Button onClick={() => go({ tab: 'profile', view: 'history' })}>変更履歴を見る</Button></>} />
      ) : (
        <StickyBar
          actions={<><Button onClick={backTo} disabled={busy}>修正する</Button>{change.status === 'failed' || change.status === 'conflict' ? <Button onClick={() => void cancel()} disabled={busy}>この変更を取り消す</Button> : null}<Button variant="primary" onClick={() => void send()} disabled={!canPress}>{busy ? '送信中…' : 'Googleに変更を送信'}</Button></>}
        />
      )}
    </div>
  )
}

// ---------- GB-17 変更履歴 ----------

const HISTORY_KINDS: Array<{ key: GoogleHistoryKind; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'hours', label: '営業時間' },
  { key: 'profile', label: 'プロフィール' },
  { key: 'review_reply', label: '口コミ返信' },
]

export function HistoryScreen({ accountId, initialResult, go }: { accountId: string; initialResult?: GoogleHistoryResult | null; go: ProfileNav }) {
  const [kind, setKind] = useState<GoogleHistoryKind>('all')
  const [result, setResult] = useState<GoogleHistoryResult>(initialResult ?? 'all')
  const [days, setDays] = useState('30')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<GoogleHistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await restaurantGoogleApi.history(accountId, { kind, result, days: Number.parseInt(days, 10), q: applied || undefined, page, perPage: 20 }))
    } catch (err) {
      setError(errorMessage(err, '変更履歴を読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [accountId, applied, days, kind, page, result])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = setTimeout(() => { setApplied(search); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const rows: string[][] = [['日時', '内容', '担当者', '種類', '結果', '備考']]
      for (let p = 1; p <= 25; p += 1) {
        const chunk = await restaurantGoogleApi.history(accountId, { kind, result, days: Number.parseInt(days, 10), q: applied || undefined, page: p, perPage: 100 })
        for (const e of chunk.changes) rows.push([e.createdAt, e.summary, e.staffName ?? '', KIND_LABEL[e.kind] ?? e.kind, STATUS_LABEL[e.status].label, e.error ?? ''])
        if (p * chunk.perPage >= chunk.total) break
      }
      const csv = `﻿${rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')}`
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `google-business-changes-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorMessage(err, 'CSVを書き出せませんでした。'))
    } finally {
      setExporting(false)
    }
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1

  return (
    <div data-design-node="w7ZTml" className="text-ink flex min-w-0 flex-col gap-4">
      <BackButton label="プロフィールへ戻る" onClick={() => go({ tab: 'profile' })} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-heading font-bold">変更履歴</h2>
        <span className="text-ink-faint text-label">このLINEアカウントの店舗に対して、Googleへ送った変更の記録です。Google側で直接行われた変更は含みません。</span>
        <span className="grow" />
        <Button onClick={() => void exportCsv()} disabled={exporting || !data || data.total === 0}><Download size={16} />{exporting ? '書き出し中…' : 'CSVで書き出す'}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs label="変更の種類" items={HISTORY_KINDS.map((k) => ({ key: k.key, label: `${k.label}${data ? ` ${data.counts[k.key]}` : ''}`, current: kind === k.key, onClick: () => { setKind(k.key); setPage(1) } }))} />
        <span className="grow" />
        <SelectField aria-label="結果で絞り込み" value={result} onChange={(event) => { setResult(event.target.value as GoogleHistoryResult); setPage(1) }} options={[{ value: 'all', label: '結果：すべて' }, { value: 'applied', label: '反映済み' }, { value: 'pending', label: '反映確認中' }, { value: 'failed', label: '失敗・取り消し' }]} />
        <SelectField size="compact" aria-label="期間" value={days} onChange={(event) => { setDays(event.target.value); setPage(1) }} options={[{ value: '7', label: '期間：7日' }, { value: '30', label: '期間：30日' }, { value: '90', label: '期間：90日' }, { value: '365', label: '期間：1年' }]} />
        <SearchField placeholder="内容で検索" aria-label="内容で検索" value={search} onChange={setSearch} onClear={() => setSearch('')} />
      </div>

      {loading && !data ? <ListState kind="loading" title="変更履歴を読み込んでいます" /> : null}
      {error ? <ListState kind="error" title="変更履歴を表示できませんでした" description={error} onRetry={() => void load()} /> : null}
      {data && data.total === 0 && !loading ? <ListState kind="empty" title="この期間の記録はありません" description="Googleへ送った変更（営業時間・プロフィール・口コミ返信）がここに残ります。" emptyPreset="readonly" /> : null}
      {data && data.total > 0 ? (
        <>
          <div className="border-hairline overflow-hidden rounded-card border" role="table" aria-label="変更履歴">
            <div className="bg-surface-pearl text-ink-faint gb-history-row grid items-center px-4 text-caption font-semibold" style={{ height: 42 }} role="row">
              <span role="columnheader">日時</span><span role="columnheader">内容</span><span role="columnheader">担当者</span><span role="columnheader">種類</span><span role="columnheader">結果</span>
            </div>
            {data.changes.map((entry) => {
              const status = STATUS_LABEL[entry.status]
              const open = entry.changeId ? () => go({ tab: 'profile', view: 'confirm', id: entry.changeId! }) : undefined
              return (
                <div key={entry.id} role="row" className={`border-hairline gb-history-row grid items-center border-t px-4 py-4 ${open ? 'hover:bg-canvas-sunken cursor-pointer' : ''}`} onClick={open} onKeyDown={open ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } } : undefined} tabIndex={open ? 0 : undefined}>
                  <span role="cell" className="text-sm font-semibold whitespace-nowrap">{formatDateTime(entry.createdAt)}</span>
                  <span role="cell" className="min-w-0 truncate text-sm" title={entry.summary}>{entry.summary}</span>
                  <span role="cell" className="text-ink-faint truncate text-label" title={entry.staffName ?? ''}>{entry.staffName ?? '—'}</span>
                  <span role="cell"><StatusBadge tone={entry.kind === 'review_reply' ? 'neutral' : entry.kind === 'profile' || entry.kind === 'photo' ? 'neutral' : 'warning'}>{KIND_LABEL[entry.kind] ?? entry.kind}</StatusBadge></span>
                  <span role="cell"><StatusBadge tone={status.tone}>{status.label}{entry.status === 'failed' && entry.error ? `（${entry.error}）` : ''}</StatusBadge></span>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-ink-faint text-caption">{(page - 1) * data.perPage + 1}–{Math.min(page * data.perPage, data.total)} / {data.total}件　・　記録は削除できません</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
          <p className="text-ink-secondary text-label">各行を押すと、変更前後の内容とGoogleからの応答を確認できます。失敗した変更は、その画面からやり直せます。</p>
        </>
      ) : null}
    </div>
  )
}

// ---------- GB-18 プロフィールを編集 ----------

type ProfileForm = { title: string; postalCode: string; administrativeArea: string; locality: string; addressLines: string; phone: string; websiteUri: string; description: string }

function formFrom(data: GoogleProfileData): ProfileForm {
  const p = data.profile
  return {
    title: p.title ?? '',
    postalCode: p.address?.postalCode ?? '',
    administrativeArea: p.address?.administrativeArea ?? '',
    locality: p.address?.locality ?? '',
    addressLines: (p.address?.addressLines ?? []).join(' / '),
    phone: p.phone ?? '',
    websiteUri: p.websiteUri ?? '',
    description: p.description ?? '',
  }
}

function Field({ label, htmlFor, note, tone = 'default', children }: { label: string; htmlFor?: string; note?: string; tone?: 'default' | 'warn'; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-label font-semibold">{label}</label>
      {children}
      {note ? <p className={`text-caption ${tone === 'warn' ? 'text-status-warn-deep' : 'text-ink-faint'}`}>{note}</p> : null}
    </div>
  )
}

export function ProfileEditScreen({ accountId, go }: { accountId: string; go: ProfileNav }) {
  const [data, setData] = useState<GoogleProfileData | null>(null)
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [photos, setPhotos] = useState<GooglePhoto[] | null>(null)
  const [photosError, setPhotosError] = useState('')
  const [adds, setAdds] = useState<MediaItem[]>([])
  const [deletes, setDeletes] = useState<string[]>([])
  const [picker, setPicker] = useState<{ open: boolean; items: MediaItem[]; loading: boolean; error: string }>({ open: false, items: [], loading: false, error: '' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let alive = true
    restaurantGoogleApi.profile(accountId)
      .then((response) => { if (alive) { setData(response); setForm(formFrom(response)) } })
      .catch((err) => { if (alive) setLoadError(errorMessage(err, 'プロフィールを読み込めませんでした。')) })
      .finally(() => { if (alive) setLoading(false) })
    restaurantGoogleApi.photos(accountId)
      .then((response) => { if (alive) setPhotos(response.photos) })
      .catch((err) => { if (alive) { setPhotos([]); setPhotosError(errorMessage(err, '写真を取得できませんでした。')) } })
    return () => { alive = false }
  }, [accountId])

  const base = data ? formFrom(data) : null
  const changedFields = form && base ? (Object.keys(form) as Array<keyof ProfileForm>).filter((k) => form[k].trim() !== base[k].trim()) : []
  const addressChanged = changedFields.some((k) => k === 'postalCode' || k === 'administrativeArea' || k === 'locality' || k === 'addressLines')
  const dirty = changedFields.length > 0 || adds.length > 0 || deletes.length > 0
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  const openPicker = async () => {
    setPicker({ open: true, items: [], loading: true, error: '' })
    try {
      const response = await api.media.list(accountId, { kind: 'image', limit: 60, sort: 'newest' })
      if (!response.success) throw new ApiError(500, response.error)
      setPicker({ open: true, items: response.data.items, loading: false, error: '' })
    } catch (err) {
      setPicker({ open: true, items: [], loading: false, error: errorMessage(err, '登録メディアを読み込めませんでした。') })
    }
  }

  const submit = async () => {
    if (!form || !data) return
    setBusy(true)
    setActionError('')
    const proposals: GoogleProfileProposal[] = []
    if (changedFields.includes('title')) proposals.push({ field: 'title', value: form.title.trim() })
    if (addressChanged) proposals.push({ field: 'address', value: { postalCode: form.postalCode.trim(), administrativeArea: form.administrativeArea.trim(), locality: form.locality.trim(), addressLines: form.addressLines.split(' / ').map((l) => l.trim()).filter(Boolean) } })
    if (changedFields.includes('phone')) proposals.push({ field: 'phone', value: form.phone.trim() })
    if (changedFields.includes('websiteUri')) proposals.push({ field: 'websiteUri', value: form.websiteUri.trim() })
    if (changedFields.includes('description')) proposals.push({ field: 'description', value: form.description.trim() })
    for (const m of adds) proposals.push({ field: 'photo', action: 'add', mediaId: m.id })
    for (const name of deletes) proposals.push({ field: 'photo', action: 'delete', mediaName: name })
    const ids: string[] = []
    try {
      for (const proposal of proposals) {
        const response = await restaurantGoogleApi.proposeProfile(accountId, proposal)
        ids.push(response.change.id)
      }
      setAdds([]); setDeletes([]); setForm(formFrom(data))
      go({ tab: 'profile', view: 'confirm', id: ids.join(',') })
    } catch (err) {
      setActionError(`${errorMessage(err, '変更案を作れませんでした。')}${ids.length ? `（${ids.length}件は作成済みです。変更履歴から確認できます）` : ''}`)
      setBusy(false)
    }
  }

  if (loading) return <ListState kind="loading" title="プロフィールを読み込んでいます" />
  if (loadError || !data || !form) return <ListState kind="error" title="プロフィールを表示できませんでした" description={loadError} onRetry={() => go({ tab: 'profile', view: 'edit' })} action={<Button onClick={() => go({ tab: 'profile' })}>プロフィールへ戻る</Button>} />

  const set = (key: keyof ProfileForm) => (value: string) => setForm({ ...form, [key]: value })
  const storeName = data.profile.title ?? data.store.name
  const visiblePhotos = (photos ?? []).filter((p) => !deletes.includes(p.name))
  const photoTotal = visiblePhotos.length + adds.length

  return (
    <div data-design-node="V5jnSa" className="text-ink flex min-w-0 flex-col gap-4">
      <BackButton label="プロフィールへ戻る" onClick={() => go({ tab: 'profile' })} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-heading font-bold">プロフィールを編集</h2>
        <StatusBadge tone="warning">まだ反映していません</StatusBadge>
      </div>
      <p className="text-ink-secondary text-sm">対象店舗：{storeName}　/　変更した項目だけをGoogleへ送ります。送信前に確認画面を表示します。</p>
      {data.closed ? <NoteBar tone="danger">Google側で「臨時休業」または「閉業」になっているため、いまは変更できません。</NoteBar> : null}
      {actionError ? <NoteBar tone="danger">{actionError}</NoteBar> : null}

      <div className="gb-edit-grid grid min-w-0 grid-cols-1 gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="店舗名" htmlFor="gb-title" note="Googleに表示される名前です。屋号以外の宣伝文句は入れないでください。">
            <TextField id="gb-title" value={form.title} onChange={(e) => set('title')(e.target.value)} maxLength={100} />
          </Field>
          <Field label="住所" note="住所を変えると、Googleが本人確認（はがきの郵送など）を求めることがあります。その間、変更は保留になります。" tone="warn">
            <div className="flex flex-wrap gap-2">
              <span style={{ width: 160 }}><TextField aria-label="郵便番号" placeholder="150-0001" value={form.postalCode} onChange={(e) => set('postalCode')(e.target.value)} maxLength={8} /></span>
              <span style={{ width: 200 }}><TextField aria-label="都道府県" placeholder="東京都" value={form.administrativeArea} onChange={(e) => set('administrativeArea')(e.target.value)} maxLength={20} /></span>
            </div>
            <TextField aria-label="市区町村" placeholder="渋谷区神宮前" value={form.locality} onChange={(e) => set('locality')(e.target.value)} maxLength={40} />
            <TextField aria-label="番地・建物" placeholder="1-2-3 こもれびビル 1F" value={form.addressLines} onChange={(e) => set('addressLines')(e.target.value)} maxLength={160} />
          </Field>
          <Field label="電話番号" htmlFor="gb-phone" note="ハイフンありで入力できます。">
            <TextField id="gb-phone" inputMode="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} maxLength={20} />
          </Field>
          <Field label="ウェブサイト" htmlFor="gb-website">
            <TextField id="gb-website" inputMode="url" placeholder="https://" value={form.websiteUri} onChange={(e) => set('websiteUri')(e.target.value)} maxLength={200} />
          </Field>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="店舗紹介文" htmlFor="gb-description">
            <TextArea id="gb-description" rows={7} value={form.description} onChange={(e) => set('description')(e.target.value)} maxLength={750} />
            <p className={`text-caption text-right ${form.description.length > 750 ? 'text-danger' : 'text-ink-faint'}`}>{form.description.length} / 750</p>
          </Field>
          <div className="flex flex-col gap-2" role="group" aria-label="写真">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-label font-semibold">写真（{photos === null ? '—' : `${photoTotal}枚`}）</span>
              <span className="grow" />
              <Button onClick={() => void openPicker()} disabled={picker.loading || data.closed}>登録メディアから追加</Button>
            </div>
            {photosError ? <p className="text-ink-faint text-caption">{photosError}</p> : null}
            <div className="flex flex-wrap gap-2">
              {visiblePhotos.map((p) => (
                <figure key={p.name} className="border-hairline bg-surface-chrome relative overflow-hidden rounded-control border" style={{ width: 100, height: 100 }}>
                  {p.thumbnailUrl || p.googleUrl ? <img src={p.thumbnailUrl ?? p.googleUrl ?? ''} alt="" className="h-full w-full object-cover" /> : null}
                  <button type="button" onClick={() => setDeletes([...deletes, p.name])} className="bg-canvas text-danger absolute right-1.5 bottom-1.5 rounded-mini px-1.5 text-micro font-semibold" aria-label="この写真を削除">削除</button>
                </figure>
              ))}
              {adds.map((m) => (
                <figure key={m.id} className="border-accent bg-surface-chrome relative overflow-hidden rounded-control border" style={{ width: 100, height: 100 }} title={m.filename}>
                  <img src={m.url} alt={m.filename} className="h-full w-full object-cover" />
                  <span className="bg-accent-deep text-on-accent absolute top-1.5 left-1.5 rounded-mini px-1.5 text-micro font-semibold">追加</span>
                  <button type="button" onClick={() => setAdds(adds.filter((x) => x.id !== m.id))} className="bg-canvas text-ink absolute right-1.5 bottom-1.5 rounded-mini px-1.5 text-micro font-semibold" aria-label="追加をやめる">やめる</button>
                </figure>
              ))}
              {deletes.length ? <p className="text-status-warn-deep w-full text-caption">{deletes.length}枚を削除します。<button type="button" className="ml-2 font-semibold underline" onClick={() => setDeletes([])}>削除をやめる</button></p> : null}
            </div>
            {picker.open ? (
              <div className="border-hairline bg-canvas flex flex-col gap-3 rounded-control border p-3" role="group" aria-label="登録メディアから写真を選ぶ">
                <div className="flex items-center gap-3"><span className="text-sm font-semibold">登録メディアの画像</span><span className="grow" /><Button size="field" onClick={() => setPicker({ ...picker, open: false })}>閉じる</Button></div>
                {picker.loading ? <ListState kind="loading" title="登録メディアを読み込んでいます" /> : null}
                {picker.error ? <NoteBar tone="danger">{picker.error}</NoteBar> : null}
                {!picker.loading && !picker.error && picker.items.length === 0 ? <p className="text-ink-secondary text-sm">このLINEアカウントの登録メディアに画像がありません。先に「登録メディア」で画像を追加してください。</p> : null}
                <div className="flex flex-wrap gap-2">
                  {picker.items.filter((m) => !adds.some((a) => a.id === m.id)).map((m) => (
                    <button key={m.id} type="button" onClick={() => setAdds([...adds, m])} className="hover:border-accent overflow-hidden rounded-control border" style={{ width: 100, height: 100, borderColor: 'var(--color-hairline)' }} title={m.filename} aria-label={`${m.filename} を追加`}>
                      <img src={m.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="text-ink-faint text-caption">追加・削除した写真はGoogleの審査後に反映されます。人物の顔や個人情報が写った写真は追加しないでください。</p>
          </div>
        </div>
      </div>

      <StickyBar actions={<><Button onClick={() => { setForm(formFrom(data)); setAdds([]); setDeletes([]); setActionError('') }} disabled={busy || !dirty}>入力をクリア</Button><Button variant="primary" onClick={() => void submit()} disabled={busy || !dirty || data.closed || form.description.length > 750}>{busy ? '確認中…' : '変更内容を確認'}</Button></>} />
      <ConfirmDialog open={leaveTarget !== null} title="入力した内容があります" description="このまま移動すると、プロフィールの変更は失われます。Googleにはまだ何も送っていません。" confirmLabel="入力を捨てて移動" cancelLabel="入力を続ける" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
