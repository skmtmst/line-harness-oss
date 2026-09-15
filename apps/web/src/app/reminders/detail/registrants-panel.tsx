'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ReminderRegistrant } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { TextInput } from '@/components/shared/form-controls'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'


const JST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** APIのUTC ISOを、どの端末でも同じJSTのdatetime-local値へ変える。 */
export function dateTimeLocalJst(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(JST_PARTS.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** datetime-localのJST壁時計時刻を、曖昧さなくUTC ISOへ変える。 */
export function dateTimeLocalJstToUtcIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 9, minute))
  // 2月30日などをDateが翌月へ丸めても保存しない。
  return dateTimeLocalJst(utc.toISOString()) === value ? utc.toISOString() : null
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

export function ReminderRegistrantsPanel({ reminderId }: { reminderId: string }) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<ReminderRegistrant[]>([])
  const [draftDates, setDraftDates] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!reminderId) {
      setError('リマインダが指定されていません。一覧から選び直してください。')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const registrants = await api.reminders.registrants.list(reminderId)
      if (!registrants.success) throw new Error('load failed')
      setItems(registrants.data)
      setDraftDates(Object.fromEntries(registrants.data.map((item) => [item.id, dateTimeLocalJst(item.targetDate)])))
    } catch {
      setItems([])
      setError('登録者を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [reminderId])

  useEffect(() => {
    // アカウント切替直後に前の店舗の一覧を見せたままにしない。
    setItems([])
    setDraftDates({})
    void load()
  }, [load, selectedAccountId])

  const activeCount = useMemo(() => items.filter((item) => item.status === 'active').length, [items])
  const apply = (id: string, value: { targetDate: string; status: string; lockVersion: number }) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...value, updatedAt: new Date().toISOString() } : item))
    setDraftDates((current) => ({ ...current, [id]: dateTimeLocalJst(value.targetDate) }))
  }

  const saveDate = async (item: ReminderRegistrant) => {
    if (actioningId) return
    const local = draftDates[item.id]
    const targetDate = local ? dateTimeLocalJstToUtcIso(local) : null
    if (!targetDate) {
      setNotice('基準日を正しく入力してください。')
      return
    }
    setActioningId(item.id)
    setNotice('')
    try {
      const response = await api.reminders.registrants.updateTargetDate(reminderId, item.id, targetDate, item.lockVersion)
      if (!response.success) throw new Error(response.error)
      apply(item.id, response.data)
      setNotice(response.data.replayed ? '同じ変更を確認しました。基準日は変更済みです。' : '基準日を変更しました。未送信分だけ新しい日程で組み直します。')
    } catch {
      setNotice('基準日を変更できませんでした。ほかの担当者による変更がないか、一覧を読み直してください。')
    } finally { setActioningId(null) }
  }

  const changeStatus = async (item: ReminderRegistrant, action: 'cancel' | 'resume') => {
    if (actioningId) return
    setActioningId(item.id)
    setNotice('')
    try {
      const response = action === 'cancel'
        ? await api.reminders.registrants.cancel(reminderId, item.id, item.lockVersion)
        : await api.reminders.registrants.resume(reminderId, item.id, item.lockVersion)
      if (!response.success) throw new Error(response.error)
      apply(item.id, response.data)
      setNotice(action === 'cancel'
        ? '登録を取り消しました。送信済みの履歴は残り、未送信分だけを止めています。'
        : '登録を再開しました。未送信分だけを次の配信処理で組み直します。')
    } catch {
      setNotice('操作を完了できませんでした。一覧を読み直してからもう一度お試しください。')
    } finally { setActioningId(null) }
  }

  return <section className="space-y-4" aria-label="登録者を管理">
    {notice ? <NoteBar tone="info">{notice}</NoteBar> : null}
    <Card padding="default"><CardHeader title="登録者を管理" meta={`登録 ${items.length}件 / 有効 ${activeCount}件`} /><p className="text-ink-faint mt-1 text-sm">基準日の変更・取消・再開を行えます。送信済みの履歴は消えません。</p></Card>
    {loading ? <ListState kind="loading" /> : error ? <ListState kind="error" title="登録者を表示できませんでした" description={error} onRetry={() => void load()} /> : items.length === 0 ? <ListState kind="empty" emptyPreset="readonly" title="登録者はいません" description="このリマインダに登録すると、ここで基準日と状態を管理できます。" /> : (
      <DataTable><thead><TableHeadRow><Th>友だち</Th><Th>基準日</Th><Th>状態</Th><Th>登録</Th><Th align="right">操作</Th></TableHeadRow></thead><tbody>
        {items.map((item) => <Tr key={item.id}>
          <Td>{item.friendName || '名前未設定'}</Td>
          <Td><TextInput aria-label={`${item.friendName || '登録者'}の基準日`} type="datetime-local" value={draftDates[item.id] ?? ''} disabled={item.status !== 'active' || actioningId === item.id} onChange={(event) => setDraftDates((current) => ({ ...current, [item.id]: event.target.value }))} /></Td>
          <Td>{item.status === 'active' ? '有効' : item.status === 'cancelled' ? '取消済み' : item.status}</Td>
          <Td>{formatDate(item.createdAt)}</Td>
          <Td align="right"><div className="flex flex-wrap justify-end gap-2">
            {item.status === 'active' ? <><Button size="field" disabled={actioningId === item.id} onClick={() => void saveDate(item)}>基準日を保存</Button><Button size="field" variant="secondary" disabled={actioningId === item.id} onClick={() => void changeStatus(item, 'cancel')}>取消</Button></> : null}
            {item.status === 'cancelled' ? <Button size="field" disabled={actioningId === item.id} onClick={() => void changeStatus(item, 'resume')}>再開</Button> : null}
          </div></Td>
        </Tr>)}
      </tbody></DataTable>
    )}
  </section>
}
