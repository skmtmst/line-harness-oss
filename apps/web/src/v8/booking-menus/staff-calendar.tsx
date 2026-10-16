'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, CalendarX2, Link2, Unplug, Wand2 } from 'lucide-react'
import Button from '@/components/shared/button'
import DetailPanel from '@/components/shared/detail-panel'
import Dialog from '@/components/shared/dialog'
import HelpTip from '@/components/shared/help-tip'
import Radio from '@/components/shared/radio'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import StatusBadge from '@/components/shared/status-badge'
import Toggle from '@/components/shared/toggle'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import { notifySaved } from '@/components/shared/toast'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { ApiError, type BookingStaff } from '@/lib/api'
import { bookingCalendarApi } from '@/lib/api-gap1'
import type { BookingCalendarSwitch } from '@line-crm/shared'
import styles from './staff-calendar.module.css'

/*
 * 担当スタッフのつなぐ先（B7・絵 uRd8A・GcYWx）：カレンダー（読み込み・書き込みを別々にオン・オフ、初めはオフ）と会議の URL。
 * 口は gap1（bookingCalendarApi：スタッフごとの同期の切り替え・固定の会議の URL、どちらも版つき）。
 * Outlook・会議の自動発行（Meet・Zoom・Teams）・つなぎ直しは次の段 → 押すと共通の案内の窓。
 * 閲覧のみは押せるものを置かず、オン・オフと URL を文字で出す。
 */

type Load = { state: 'loading' } | { state: 'ready'; store: BookingCalendarSwitch | null; mine: BookingCalendarSwitch; url: { value: string; saved: string; version: number } | null } | { state: 'error' }
const onOff = (on: boolean | undefined) => (on ? 'オン' : 'オフ')

function saveError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) return 'ほかの人が先に変えました。読み直してから、もう一度お試しください。'
  if (cause instanceof ApiError && cause.status === 403) return 'この操作をする権限がありません。'
  if (cause instanceof ApiError && cause.status === 400) return 'https:// で始まる URL を入れてください。'
  return '保存できませんでした。もう一度お試しください。'
}

export function StaffCalendarPanel({ accountId, person, menuCount, canEdit, onClose }: {
  accountId: string
  person: BookingStaff | null
  menuCount: number
  canEdit: boolean
  onClose: () => void
}) {
  const preparing = usePreparingDialog()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [writeOff, setWriteOff] = useState<'keep' | 'remove' | null>(null)
  const staffId = person?.id ?? null

  const reload = useCallback(async () => {
    if (!staffId) return
    setLoad({ state: 'loading' }); setError(null)
    try {
      const [mine, store, url] = await Promise.all([
        bookingCalendarApi.getSwitches(accountId, staffId),
        Promise.resolve().then(() => bookingCalendarApi.getSwitches(accountId)).then((response) => response.data).catch(() => null),
        Promise.resolve().then(() => bookingCalendarApi.getStaffUrl(accountId, staffId)).then((response) => response.data).catch(() => null),
      ])
      setLoad({ state: 'ready', mine: mine.data, store, url: url ? { value: url.url ?? '', saved: url.url ?? '', version: url.version } : null })
    } catch {
      setLoad({ state: 'error' })
    }
  }, [accountId, staffId])
  useEffect(() => { void reload() }, [reload])

  async function saveSwitch(next: { readEnabled: boolean; writeEnabled: boolean }, extra?: { removeFutureEvents: boolean }) {
    if (load.state !== 'ready' || !staffId) return
    setBusy(true); setError(null)
    try {
      const response = await bookingCalendarApi.saveSwitches(accountId, { ...next, expectedVersion: load.mine.version, ...(extra ? { confirmed: true, removeFutureEvents: extra.removeFutureEvents } : {}) }, staffId)
      setLoad({ ...load, mine: response.data })
      setWriteOff(null)
      notifySaved(extra ? '書き込みをオフにしました' : 'カレンダーの設定を保存しました')
    } catch (cause) {
      setError(saveError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function saveUrl() {
    if (load.state !== 'ready' || !load.url || !staffId) return
    setBusy(true); setError(null)
    try {
      const response = await bookingCalendarApi.saveStaffUrl(accountId, staffId, load.url.value.trim() || null, load.url.version)
      setLoad({ ...load, url: { value: response.data.url ?? '', saved: response.data.url ?? '', version: response.data.version } })
      notifySaved('会議の URL を保存しました')
    } catch (cause) {
      setError(saveError(cause))
    } finally {
      setBusy(false)
    }
  }

  const ready = load.state === 'ready' ? load : null
  const mine = ready?.mine
  const connected = mine?.connected !== false
  const urlInvalid = Boolean(ready?.url && ready.url.value.trim() !== '' && !/^https:\/\/\S+$/.test(ready.url.value.trim()))
  const urlDirty = Boolean(ready?.url && ready.url.value.trim() !== ready.url.saved)

  return (
    <DetailPanel open={person !== null} title={person?.name ?? ''} description={person ? `${person.role ? `${person.role} ・ ` : ''}担当メニュー ${menuCount} つ` : undefined}
      contentSpacing="sections" onClose={onClose} busy={busy} footer={<div className={styles.footer}><Button onClick={onClose}>閉じる</Button></div>}>
      {load.state === 'loading' ? <p className={styles.minor}>読み込んでいます…</p> : null}
      {load.state === 'error' ? <div className={styles.card}><p className={styles.minor}>カレンダーの設定を読み込めませんでした。</p><Button size="compact" onClick={() => void reload()}>もう一度読み込む</Button></div> : null}
      {ready && mine ? (
        <>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <section className={styles.card} aria-labelledby="staff-calendar-heading">
            <h3 id="staff-calendar-heading" className={styles.title}>カレンダー</h3>
            {ready.store ? <p className={styles.minor}>{`店全体の同期：読み込み ${onOff(ready.store.readEnabled)} ・ 書き込み ${onOff(ready.store.writeEnabled)}（予約設定 › 担当スタッフの上で変えます）`}</p> : null}
            <div className={styles.table} role="table" aria-label="つなぐカレンダー">
              <div className={`${styles.row} ${styles.head}`} role="row"><span role="columnheader">カレンダー・状態</span><span role="columnheader">読み込み</span><span role="columnheader">書き込み</span></div>
              <div className={styles.row} role="row">
                <span role="cell" className={styles.name}><strong>Google カレンダー</strong><StatusBadge tone={connected ? 'success' : 'danger'} size="compact">{connected ? 'つながっている' : '切れている'}</StatusBadge></span>
                <span role="cell">{canEdit ? <Toggle label="Google カレンダーの読み込み" checked={mine.readEnabled} disabled={busy} onChange={(on) => void saveSwitch({ readEnabled: on, writeEnabled: mine.writeEnabled })} /> : onOff(mine.readEnabled)}</span>
                <span role="cell">{canEdit ? <Toggle label="Google カレンダーの書き込み" checked={mine.writeEnabled} disabled={busy}
                  onChange={(on) => { if (on) void saveSwitch({ readEnabled: mine.readEnabled, writeEnabled: true }); else { setError(null); setWriteOff('keep') } }} /> : onOff(mine.writeEnabled)}</span>
              </div>
              <div className={styles.row} role="row">
                <span role="cell" className={styles.name}><strong>Outlook</strong><StatusBadge tone="neutral" size="compact">つないでいない</StatusBadge></span>
                <span role="cell" className={styles.span2}>{canEdit ? <Button size="compact" onClick={() => preparing.open('Outlook をつなぐ')}>つなぐ</Button> : null}</span>
              </div>
            </div>
            <p className={styles.minor}>初めはどちらもオフです。オフにしても予約はそのまま残ります。</p>
          </section>

          <section className={styles.card} aria-labelledby="staff-meeting-heading">
            <div className={styles.headRow}><h3 id="staff-meeting-heading" className={styles.title}>会議の URL</h3><HelpTip label="会議の URL の説明">オンラインのメニューで、予約が決まったらお客さまに LINE で送る URL です。担当の固定の URL を先に使い、無いときはメニューの URL を使います。</HelpTip></div>
            {canEdit ? (
              <>
                <RadioCardGroup legend="会議の URL の出し方" columns={2}>
                  <RadioCard name={`staff-meeting-${person?.id}`} value="manual" icon={<Link2 size={18} />} title="手で入れる" note="決まった URL を毎回使う" checked onChange={() => undefined} />
                  <RadioCard name={`staff-meeting-${person?.id}`} value="auto" icon={<Wand2 size={18} />} title="自動で発行" note="予約が決まったら会議を作る" checked={false} onChange={() => preparing.open('会議の自動発行')} />
                </RadioCardGroup>
                <div className={styles.table} role="radiogroup" aria-label="自動で発行するときの会議">
                  {['Google Meet', 'Zoom', 'Microsoft Teams'].map((provider) => (
                    <div key={provider} className={`${styles.row} ${styles.providerRow}`}>
                      <Radio name={`staff-meeting-provider-${person?.id}`} checked={false} onChange={() => preparing.open('会議の自動発行')}>{provider}</Radio>
                      <Button size="compact" onClick={() => preparing.open(`${provider} をつなぐ`)}>つなぐ</Button>
                    </div>
                  ))}
                </div>
                <Field label="固定の会議の URL" optional error={urlInvalid ? 'https:// で始まる URL を入れてください' : undefined}>
                  <div className={styles.urlLine}>
                    <TextField aria-label="固定の会議の URL" value={ready.url?.value ?? ''} placeholder="https://meet.google.com/…" disabled={ready.url === null}
                      onChange={(event) => ready.url && setLoad({ ...ready, url: { ...ready.url, value: event.target.value } })} />
                    {urlDirty ? <Button variant="primary" busy={busy} disabled={urlInvalid} disabledReason="https:// で始まる URL を入れてください" onClick={() => void saveUrl()}>保存する</Button> : null}
                  </div>
                </Field>
                <p className={styles.minor}>自動で作れないときにも、この URL を使います。</p>
              </>
            ) : <p className={styles.readValue}>{ready.url?.saved || '固定の URL はありません'}</p>}
          </section>

          {!connected ? (
            <div className={styles.broken} role="status">
              <Unplug size={18} aria-hidden="true" />
              <span><strong>この人の空きは閉じています</strong><span className={styles.minor}>Google の接続が切れました。つなぎ直すまで、この人の枠は予約できません。</span></span>
              {canEdit ? <Button size="compact" onClick={() => preparing.open('カレンダーのつなぎ直し')}>つなぎ直す</Button> : null}
            </div>
          ) : null}

          {/* 書き込みをオフにする確かめ（GcYWx）：書いた予定を残すか、これから先の予定を消すか。 */}
          <Dialog open={writeOff !== null} title="書き込みをオフにしますか？" titleNote={`${person?.name ?? ''} ・ Google カレンダー`} size="medium" contentLayout="form"
            busy={busy} error={error ?? undefined} cancelLabel="やめる" onCancel={() => { if (!busy) setWriteOff(null) }}
            confirmLabel="書き込みをオフにする" onConfirm={() => void saveSwitch({ readEnabled: mine.readEnabled, writeEnabled: false }, { removeFutureEvents: writeOff === 'remove' })}>
            <p className={styles.body}>{`これからの予約は、${person?.name ?? ''}さんのカレンダーに書きません。予約はそのまま残ります。`}</p>
            <RadioCardGroup legend="これまでに書いた予定をどうしますか">
              <RadioCard name="calendar-write-off" value="keep" icon={<CalendarCheck size={16} />} title="カレンダーの予定は残す" note="いま書いてある予定はそのまま" checked={writeOff === 'keep'} onChange={() => setWriteOff('keep')} />
              <RadioCard name="calendar-write-off" value="remove" icon={<CalendarX2 size={16} />} title={`これから先の予約の予定を消す${mine.futureEventCount !== undefined ? `（${mine.futureEventCount} 件）` : ''}`} note="今日より後の予定だけ。過去の予定は消しません" checked={writeOff === 'remove'} onChange={() => setWriteOff('remove')} />
            </RadioCardGroup>
          </Dialog>
        </>
      ) : null}
      {preparing.dialog}
    </DetailPanel>
  )
}
