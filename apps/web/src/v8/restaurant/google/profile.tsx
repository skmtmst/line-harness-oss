'use client'

/*
 * ★V8 Googleビジネス プロフィール（`JUTGz`）。
 * 本日の営業時間（変更・今日を休みにする・祝日の確認・早く閉める）→ 店舗情報 → Google側の変更を確認。
 * 口は今の画面と同じ。営業時間の変更・変更の確認・変更履歴・プロフィールの編集は
 * ?tab=profile&view=hours|confirm|history|edit へ移り、入口の page.tsx が今の画面で出す。
 */
import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, CalendarX, Clock, GitCompare, History, Pencil, RefreshCw, Timer } from 'lucide-react'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { restaurantGoogleApi, type GoogleHoursProposal, type GoogleProfileAddress, type GoogleProfileData } from '@/lib/restaurant-google-api'
import { errorMessage, formatPeriods, formatStampFull, formatYmdShort, summarizeWeekly, TIME_OPTIONS } from './format'
import type { GoogleNav } from './google'
import styles from './google.module.css'

function addressText(a: GoogleProfileAddress | null | undefined): string {
  if (!a) return '—'
  return [a.postalCode ? `〒${a.postalCode}` : '', a.administrativeArea ?? '', a.locality ?? '', ...a.addressLines].filter(Boolean).join('') || '—'
}

const COMPARABLE = ['regularHours', 'specialHours', 'storefrontAddress', 'phoneNumbers', 'profile', 'title', 'websiteUri']

export default function ProfileBoard({ accountId, go }: { accountId: string; go: GoogleNav }) {
  const [data, setData] = useState<GoogleProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [showHolidays, setShowHolidays] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showMore, setShowMore] = useState(false)
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

  if (loading && !data) return <div className={styles.stateBox}><ListState kind="loading" title="プロフィールを読み込んでいます" /></div>
  if (!data) {
    return <ListState kind="error" title="プロフィールを表示できませんでした" description={error} onRetry={() => void load()} action={<Button onClick={() => go({ tab: 'settings' })}>設定で接続を確認</Button>} />
  }

  const { profile, today } = data
  const canChange = !data.closed && !busy
  const todayText = today.closed ? '本日は休業' : formatPeriods(today.periods)
  const closeOptions = TIME_OPTIONS.filter((t) => today.periods.length > 0 && t > today.periods[today.periods.length - 1].open).map((t) => ({ value: t, label: t }))
  const updates = data.googleUpdates
  const special = profile.specialHours.length
    ? profile.specialHours.slice(0, 4).map((s) => `${formatYmdShort(s.date)} ${s.closed ? '休業' : formatPeriods(s.periods)}`).join('、') + (profile.specialHours.length > 4 ? ` ほか${profile.specialHours.length - 4}件` : '')
    : '今後の予定はありません'
  const infoRows: Array<[string, string]> = [
    ['店名', profile.title ?? '—'],
    ['住所', addressText(profile.address)],
    ['電話', profile.phone ?? '未設定'],
    ['サイト', profile.websiteUri ?? '未設定'],
    ['通常の営業時間', summarizeWeekly(profile.regularHours)],
  ]
  const moreRows: Array<[string, string]> = [
    ['特別営業時間', special],
    ['写真・店舗紹介', `${data.photoCount === null ? '店舗写真 —' : `店舗写真 ${data.photoCount}枚`} / ${profile.description ? '紹介文あり' : '紹介文なし'}`],
  ]

  return (
    <>
      {data.stale ? <Notice tone="warn" action={<button type="button" className={styles.textButton} onClick={() => void load(true)}>{syncing ? '取得中…' : 'もう一度取得'}</button>}>{`Googleから最新の情報を読み込めませんでした。前回取得した内容（${formatStampFull(data.fetchedAt)}）を表示しています。`}</Notice> : null}
      {!data.stale && data.closed ? <Notice tone="danger">Google側で「臨時休業」または「閉業」になっています。営業時間の変更はGoogleビジネスプロフィールで営業状態を戻してから行ってください。</Notice> : null}
      {!data.stale && !data.closed && data.pendingChangeCount > 0 ? <Notice tone="info" action={<button type="button" className={styles.textButton} onClick={() => go({ tab: 'profile', view: 'history', result: 'pending' })}>状態を確認</button>}>{`Googleに変更を送信しました。反映を確認できるまで「反映確認中」と表示します（${data.pendingChangeCount}件）。`}</Notice> : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      <section className={styles.card} aria-labelledby="gb-today-title">
        <h2 id="gb-today-title" className={styles.cardTitle}>本日の営業時間</h2>
        <p className={styles.todayHours}>{`${formatYmdShort(today.date)}${today.holidayName ? `・${today.holidayName} ` : ''}${todayText}${today.special ? '（特別営業時間）' : ''}`}</p>
        <div className={styles.buttonRow}>
          <Button onClick={() => go({ tab: 'profile', view: 'hours', mode: 'text' })} disabled={!canChange}><Clock aria-hidden className={styles.icon15} />営業時間を変更</Button>
          <Button onClick={() => void quick({ source: 'shortcut', shortcut: 'close_today' })} disabled={!canChange || today.closed}><CalendarX aria-hidden className={styles.icon15} />今日を休みにする</Button>
          <Button onClick={() => setShowHolidays((v) => !v)} aria-expanded={showHolidays}><CalendarDays aria-hidden className={styles.icon15} />祝日の営業時間を確認</Button>
          <Button onClick={() => { setEarlyClose(closeOptions[closeOptions.length - 1]?.value ?? null); setActionError('') }} disabled={!canChange || today.closed || closeOptions.length === 0}><Timer aria-hidden className={styles.icon15} />今日は早く閉める</Button>
        </div>
        {earlyClose !== null ? (
          <div className={styles.inlinePanel}>
            <span className={styles.fieldLabel}>今日の閉店時刻</span>
            <Select size="page-size" aria-label="今日の閉店時刻" value={earlyClose} onChange={(value) => setEarlyClose(value)} options={closeOptions} />
            <span className={styles.muted}>{`現在 ${formatPeriods(today.periods)}`}</span>
            <span className={styles.spacer} aria-hidden="true" />
            <Button onClick={() => setEarlyClose(null)} disabled={busy}>キャンセル</Button>
            <Button variant="primary" onClick={() => void quick({ source: 'shortcut', shortcut: 'early_close_today', closeTime: earlyClose })} disabled={busy}>変更案を確認</Button>
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
                    <Button onClick={() => go({ tab: 'profile', view: 'hours', mode: 'calendar', date: h.date })} disabled={!canChange}>{h.special ? '編集' : '設定する'}</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>
      <section className={styles.card} aria-labelledby="gb-store-info-title">
        <h2 id="gb-store-info-title" className={styles.cardTitle}>
          店舗情報
          <HelpTip label="店舗情報の説明">Googleに表示されている内容です。変更は1つの編集画面でまとめて行い、確認してから送信します。自動で以前の内容に戻すことはしません。</HelpTip>
        </h2>
        <dl className={styles.facts}>
          {[...infoRows, ...(showMore ? moreRows : [])].map(([label, value]) => (
            <div key={label} className={styles.factRow}><dt className={styles.factKey}>{label}</dt><dd className={styles.factValue} title={value}>{value}</dd></div>
          ))}
        </dl>
        <div className={styles.buttonRowEnd}>
          <button type="button" className={styles.textButton} onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>{showMore ? 'ほかの項目を閉じる' : 'ほかの項目（特別営業時間・写真）'}</button>
          <span className={styles.spacer} aria-hidden="true" />
          <Button onClick={() => go({ tab: 'profile', view: 'history' })}><History aria-hidden className={styles.icon15} />変更履歴</Button>
          <Button variant="primary" onClick={() => go({ tab: 'profile', view: 'edit' })} disabled={!canChange}><Pencil aria-hidden className={styles.icon15} />プロフィールを編集</Button>
        </div>
      </section>
      <section className={styles.card} aria-labelledby="gb-google-updates-title">
        <h2 id="gb-google-updates-title" className={styles.cardTitle}>
          Google側の変更を確認
          {updates && updates.fields.length > 0 ? <StatusBadge tone="warning">{`確認が必要 ${updates.fields.length}件`}</StatusBadge> : <StatusBadge tone="neutral">{updates ? '確認が必要な変更はありません' : '未確認'}</StatusBadge>}
        </h2>
        <p className={styles.warnNote}>Google やお客さまの提案で、店舗情報が変わることがあります。違いがあれば、ここで確かめて採るか戻すかを選びます。</p>
        {showDiff && updates ? (
          <dl className={styles.diffList}>
            {updates.fields.map((f) => {
              const key = f.mask.split('.')[0]
              if (!COMPARABLE.includes(key)) {
                return (
                  <div key={f.mask} className={styles.diffItem}>
                    <dt className={styles.fieldLabel}>{f.label}</dt>
                    <dd className={styles.muted}>この項目はこの画面で比較できません。<a href="https://business.google.com/" target="_blank" rel="noreferrer" className={styles.textLink}>Googleの管理画面で確認する</a></dd>
                  </div>
                )
              }
              const u = updates.updated
              const pick = (src: Partial<typeof profile>) => key === 'regularHours' ? (src.regularHours ? summarizeWeekly(src.regularHours) : '—')
                : key === 'specialHours' ? (src.specialHours ? src.specialHours.map((s) => `${formatYmdShort(s.date)} ${s.closed ? '休業' : formatPeriods(s.periods)}`).join('、') || 'なし' : '—')
                  : key === 'storefrontAddress' ? addressText(src.address)
                    : key === 'phoneNumbers' ? src.phone ?? '—'
                      : key === 'profile' ? src.description ?? '—'
                        : key === 'title' ? src.title ?? '—'
                          : src.websiteUri ?? '—'
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
      </section>
      <p className={styles.footCaption}>{`最終取得 ${formatStampFull(data.fetchedAt)}・店舗の時刻は${data.timeZone === 'Asia/Tokyo' ? '日本時間' : data.timeZone}で表示`}</p>
    </>
  )
}
