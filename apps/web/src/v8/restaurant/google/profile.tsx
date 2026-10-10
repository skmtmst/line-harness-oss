'use client'
import { useCallback, useEffect, useRef, useState } from "react"
import { CalendarDays, CalendarX, Clock, GitCompare, History, Pencil, RefreshCw, Timer } from "lucide-react"
import Card from "@/components/shared/card"
import SectionHeader from "@/components/shared/section-header"
import Button from "@/components/shared/button"
import { canManageRole, useStaffRole } from "@/lib/staff-role"
import HelpTip from "@/components/shared/help-tip"
import ListState from "@/components/shared/list-state"
import Notice from "@/components/shared/notice"
import Select from "@/components/shared/select"
import StatusBadge from "@/components/shared/status-badge"
import { restaurantGoogleApi, type GoogleHoursProposal, type GoogleProfileAddress, type GoogleProfileData } from "@/lib/restaurant-google-api"
import { errorMessage, formatPeriods, formatStampFull, formatYmdShort, summarizeWeekly, TIME_OPTIONS } from "./format"
import type { GoogleNav } from "./google"
import styles from "./google.module.css"
import TextLink from "@/components/shared/text-link"
import { emptyValue } from "@/components/shared/empty-value"
import { SaveErrorField } from "@/components/shared/save-form-errors"
import ReadOnlyNotice from "@/components/shared/read-only-notice"




















/*
 * ★V8 Googleビジネス プロフィール（`JUTGz`）。
 * 本日の営業時間（変更・今日を休みにする・祝日の確認・早く閉める）→ 店舗情報 → Google側の変更を確認。
 * 口は今の画面と同じ。営業時間の変更・変更の確認・変更履歴・プロフィールの編集は
 * ?tab=profile&view=hours|confirm|history|edit へ移り、入口の page.tsx が今の画面で出す。
 */



function addressText(a: GoogleProfileAddress | null | undefined): string {
  if (!a) return '—'
  return [a.postalCode ? `〒${a.postalCode}` : '', a.administrativeArea ?? '', a.locality ?? '', ...a.addressLines].filter(Boolean).join('') || emptyValue('unknown')
}

const COMPARABLE = ['regularHours', 'specialHours', 'storefrontAddress', 'phoneNumbers', 'profile', 'title', 'websiteUri']

export default function ProfileBoard({ accountId, go }: { accountId: string; go: GoogleNav }) {
  const role = useStaffRole()
  const [data, setData] = useState<GoogleProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const syncLock = useRef(false)
  const [showHolidays, setShowHolidays] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [earlyClose, setEarlyClose] = useState<string | null>(null)

  const load = useCallback(async (sync = false) => {
    if (sync) {
      if (syncLock.current) return
      syncLock.current = true
      setSyncing(true)
    } else setLoading(true)
    setError('')
    try {
      setData(sync ? await restaurantGoogleApi.syncProfile(accountId) : await restaurantGoogleApi.profile(accountId))
    } catch (err) {
      if (!sync) setData(null)
      setError(errorMessage(err, 'プロフィールを読み込めませんでした。'))
    } finally {
      setLoading(false)
      if (sync) {
        syncLock.current = false
        setSyncing(false)
      }
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

  if (loading && !data) return <div className={styles.stateBox}><ListState kind="loading" title="プロフィールを読み込んでいます" /></div>
  if (!data) {
    return <ListState kind="error" title="プロフィールを表示できませんでした" description={error} onRetry={() => void load()} action={<Button onClick={() => go({ tab: 'settings' })}>設定で接続を確認</Button>} />
  }

  const { profile, today } = data
  const canChange = !data.closed && !busy && (canManageRole(role))
  const todayText = today.closed ? '本日は休業' : formatPeriods(today.periods)
  const closeOptions = TIME_OPTIONS.filter((t) => today.periods.length > 0 && t > today.periods[today.periods.length - 1].open).map((t) => ({ value: t, label: t }))
  const updates = data.googleUpdates
  const special = profile.specialHours.length
    ? profile.specialHours.slice(0, 4).map((s) => `${formatYmdShort(s.date)} ${s.closed ? '休業' : formatPeriods(s.periods)}`).join('、') + (profile.specialHours.length > 4 ? ` ほか${profile.specialHours.length - 4} 件` : '')
    : '今後の予定はありません'
  const infoRows: Array<[string, string]> = [
    ['店名', profile.title ?? emptyValue('unknown')],
    ['住所', addressText(profile.address)],
    ['電話', profile.phone ?? emptyValue('unconfigured')],
    ['サイト', profile.websiteUri ?? emptyValue('unconfigured')],
    ['カテゴリ', '—（未取得）'],
  ]
  const moreRows: Array<[string, string]> = [
    ['通常の営業時間', summarizeWeekly(profile.regularHours)],
    ['特別営業時間', special],
    ['写真・店舗紹介', `${data.photoCount === null ? '店舗写真 —' : `店舗写真 ${data.photoCount} 枚`} / ${profile.description ? '紹介文あり' : '紹介文なし'}`],
  ]

  return (
    <>
      {role !== null && !canManageRole(role) ? <ReadOnlyNotice>閲覧のみです。営業時間と店舗情報を確認できます。</ReadOnlyNotice> : null}
      {data.stale ? <Notice tone="warn" action={<Button variant="text" onClick={() => void load(true)} busy={syncing} busyLabel="取得中…">もう一度取得</Button>}>{`Googleから最新の情報を読み込めませんでした。前回取得した内容（${formatStampFull(data.fetchedAt)}）を表示しています。`}</Notice> : null}
      {!data.stale && data.closed ? <Notice tone="danger">Google側で「臨時休業」または「閉業」になっています。営業時間の変更はGoogleビジネスプロフィールで営業状態を戻してから行ってください。</Notice> : null}
      {!data.stale && !data.closed && data.pendingChangeCount > 0 ? <Notice tone="info" action={<Button variant="text" onClick={() => go({ tab: 'profile', view: 'history', result: 'pending' })}>状態を確認</Button>}>{`Googleに変更を送信しました。反映を確認できるまで「反映確認中」と表示します（${data.pendingChangeCount} 件）。`}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      <Card appearance="outlined" layout="vertical" padding="default" gap="normal" aria-labelledby="gb-today-title">
        <SectionHeader size="small" title={<span id="gb-today-title">本日の営業時間</span>} />
        <p className={styles.todayHours}>{`${formatYmdShort(today.date)}${today.holidayName ? `・${today.holidayName} ` : ''}${todayText}${today.special ? '（特別営業時間）' : ''}`}</p>
        <div className={styles.buttonRow}>
          {canChange ? <Button onClick={() => go({ tab: 'profile', view: 'hours', mode: 'text' })}><Clock aria-hidden className={styles.icon15} />営業時間を変更</Button> : null}
          {canChange ? <Button onClick={() => void quick({ source: 'shortcut', shortcut: 'close_today' })} disabled={today.closed} busy={Boolean(busy)} busyLabel="処理中…"><CalendarX aria-hidden className={styles.icon15} />今日を休みにする</Button> : null}
          <Button onClick={() => setShowHolidays((v) => !v)} aria-expanded={showHolidays}><CalendarDays aria-hidden className={styles.icon15} />祝日の営業時間を確認</Button>
          {canChange ? <Button onClick={() => { setEarlyClose(closeOptions[closeOptions.length - 1]?.value ?? null); setActionError('') }} disabled={today.closed || closeOptions.length === 0}><Timer aria-hidden className={styles.icon15} />今日は早く閉める</Button> : null}
        </div>
        {earlyClose !== null ? (
          <div className={styles.inlinePanel}>
            <span className={styles.fieldLabel}>今日の閉店時刻</span>
            <SaveErrorField names={["earlyClose","closeTime","early_close"]}><Select size="page-size" aria-label="今日の閉店時刻" value={earlyClose} onChange={(value) => setEarlyClose(value)} options={closeOptions} /></SaveErrorField>
            <span className={styles.muted}>{`現在 ${formatPeriods(today.periods)}`}</span>
            <span className={styles.spacer} aria-hidden="true" />
            <Button onClick={() => setEarlyClose(null)} disabled={busy}>キャンセル</Button>
            <Button variant="primary" onClick={() => void quick({ source: 'shortcut', shortcut: 'early_close_today', closeTime: earlyClose })} disabled={busy} busy={Boolean(busy)} busyLabel="処理中…">変更案を確認</Button>
          </div>
        ) : null}
        {showHolidays ? (
          <div className={styles.inlinePanel} role="group" aria-label="今後30日の祝日">
            {data.holidays.length === 0 ? <p className={styles.muted}>今後30日に祝日はありません。</p> : (
              <ul className={styles.holidayList}>
                {data.holidays.map((h) => (
                  <li key={h.date} className={styles.holidayRow}>
                    <span className={styles.fieldLabel}>{formatYmdShort(h.date)}</span>
                    <span className={styles.muted}>{h.name}</span>
                    <span>{h.special ? `特別営業時間：${h.special.closed ? '休業' : formatPeriods(h.special.periods)}` : `通常どおり：${formatPeriods(profile.regularHours[h.weekday] ?? [], '定休日')}`}</span>
                    <span className={styles.spacer} aria-hidden="true" />
                    {canChange ? <Button onClick={() => go({ tab: 'profile', view: 'hours', mode: 'calendar', date: h.date })}>{h.special ? '編集' : '設定する'}</Button> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Card>
      <Card appearance="outlined" layout="vertical" padding="default" gap="normal" aria-labelledby="gb-store-info-title">
        <SectionHeader size="small" title={<span id="gb-store-info-title">
          店舗情報
          <HelpTip label="店舗情報の説明">Googleに表示されている内容です。変更は1つの編集画面でまとめて行い、確認してから送信します。自動で以前の内容に戻すことはしません。</HelpTip>
        </span>} />
        <dl className={styles.facts}>
          {[...infoRows, ...(showMore ? moreRows : [])].map(([label, value]) => (
            <div key={label} className={styles.factRow}><dt className={styles.factKey}>{label}</dt><dd className={styles.factValue} title={value}>{value}</dd></div>
          ))}
        </dl>
        <div className={styles.buttonRowEnd}>
          <Button variant="text" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>{showMore ? 'ほかの項目を閉じる' : 'ほかの項目（特別営業時間・写真）'}</Button>
          <span className={styles.spacer} aria-hidden="true" />
          <Button onClick={() => go({ tab: 'profile', view: 'history' })}><History aria-hidden className={styles.icon15} />変更履歴</Button>
          {canChange ? <Button variant="primary" onClick={() => go({ tab: 'profile', view: 'edit' })}><Pencil aria-hidden className={styles.icon15} />プロフィールを編集</Button> : null}
        </div>
      </Card>
      <Card appearance="outlined" layout="vertical" padding="default" gap="normal" aria-labelledby="gb-google-updates-title">
        <SectionHeader size="small" title={<span id="gb-google-updates-title">Google側の変更を確認</span>} note={updates && updates.fields.length > 0 ? <StatusBadge tone="warning">{`確認が必要 ${updates.fields.length} 件`}</StatusBadge> : <StatusBadge tone="neutral">{updates ? '確認が必要な変更はありません' : '未確認'}</StatusBadge>} />
        <p className={styles.warnNote}>Google やお客さまの提案で、店舗情報が変わることがあります。違いがあれば、ここで確かめて採るか戻すかを選びます。</p>
        {showDiff && updates ? (
          <dl className={styles.diffList}>
            {updates.fields.map((f) => {
              const key = f.mask.split('.')[0]
              if (!COMPARABLE.includes(key)) {
                return (
                  <div key={f.mask} className={styles.diffItem}>
                    <dt className={styles.fieldLabel}>{f.label}</dt>
                    <dd className={styles.muted}>この項目はこの画面で比較できません。<TextLink external href="https://business.google.com/"   className={styles.textLink}>Googleの管理画面で確認する</TextLink></dd>
                  </div>
                )
              }
              const u = updates.updated
              const pick = (src: Partial<typeof profile>) => key === 'regularHours' ? (src.regularHours ? summarizeWeekly(src.regularHours) : emptyValue('unknown'))
                : key === 'specialHours' ? (src.specialHours ? src.specialHours.map((s) => `${formatYmdShort(s.date)} ${s.closed ? '休業' : formatPeriods(s.periods)}`).join('、') || emptyValue('none') : emptyValue('unknown'))
                  : key === 'storefrontAddress' ? addressText(src.address)
                    : key === 'phoneNumbers' ? src.phone ?? emptyValue('unknown')
                      : key === 'profile' ? src.description ?? emptyValue('unknown')
                        : key === 'title' ? src.title ?? emptyValue('unknown')
                          : src.websiteUri ?? emptyValue('unknown')
              return (
                <div key={f.mask} className={styles.diffItem}>
                  <dt className={styles.fieldLabel}>{f.label}</dt>
                  <dd className={styles.muted}>{`現在：${pick(profile)}`}</dd>
                  <dd className={styles.diffProposed}>{`Googleの提案：${pick(u)}`}</dd>
                </div>
              )
            })}
          </dl>
        ) : null}
        <div className={styles.buttonRowEnd}>
          {updates && updates.fields.length > 0 ? (
            <Button onClick={() => setShowDiff((v) => !v)} aria-expanded={showDiff}><GitCompare aria-hidden className={styles.icon15} />{showDiff ? '差分を閉じる' : '差分を見る'}</Button>
          ) : (
            <Button onClick={() => void load(true)} disabled={syncing} busy={syncing} busyLabel="取得中…"><RefreshCw aria-hidden className={styles.icon15} />同期する</Button>
          )}
        </div>
      </Card>
      <p className={styles.footCaption}>{`最終取得 ${formatStampFull(data.fetchedAt)}・店舗の時刻は${data.timeZone === 'Asia/Tokyo' ? '日本時間' : data.timeZone}で表示`}</p>
    </>
  )
}
