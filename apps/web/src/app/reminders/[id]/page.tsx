'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { api, type ReminderRegistrant } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Breadcrumb from '@/components/shared/breadcrumb'
import Card, { CardHeader } from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { TextInput } from '@/components/shared/form-controls'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

function dateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

export function ReminderRegistrantsPage({ reminderId }: { reminderId: string }) {
  const [name, setName] = useState('')
  const [items, setItems] = useState<ReminderRegistrant[]>([])
  const [draftDates, setDraftDates] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  usePageTitle(name ? `${name}・登録者` : 'リマインダ登録者')

  const load = useCallback(async () => {
    if (!reminderId) {
      setError('リマインダが指定されていません。一覧から選び直してください。')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [reminder, registrants] = await Promise.all([
        api.reminders.get(reminderId),
        api.reminders.registrants.list(reminderId),
      ])
      if (!reminder.success || !registrants.success) throw new Error('load failed')
      setName(reminder.data.name)
      setItems(registrants.data)
      setDraftDates(Object.fromEntries(registrants.data.map((item) => [item.id, dateTimeLocal(item.targetDate)])))
    } catch {
      setItems([])
      setError('登録者を読み込めませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [reminderId])

  useEffect(() => { void load() }, [load])

  const activeCount = useMemo(() => items.filter((item) => item.status === 'active').length, [items])
  const apply = (id: string, value: { targetDate: string; status: string; lockVersion: number }) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...value, updatedAt: new Date().toISOString() } : item))
    setDraftDates((current) => ({ ...current, [id]: dateTimeLocal(value.targetDate) }))
  }

  const saveDate = async (item: ReminderRegistrant) => {
    if (actioningId) return
    const local = draftDates[item.id]
    const parsed = local ? new Date(local) : null
    if (!parsed || Number.isNaN(parsed.getTime())) {
      setNotice('基準日を正しく入力してください。')
      return
    }
    setActioningId(item.id)
    setNotice('')
    try {
      const response = await api.reminders.registrants.updateTargetDate(reminderId, item.id, parsed.toISOString(), item.lockVersion)
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

  return <main className="space-y-4">
    <Breadcrumb items={[{ label: 'リマインダ', href: '/reminders' }, { label: name || '登録者' }]} />
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold">{name || 'リマインダ'}の登録者</h1><p className="text-ink-faint mt-1 text-sm">基準日の変更・取消・再開を行えます。送信済みの履歴は消えません。</p></div>
      <div className="flex gap-2"><Button href={`/reminders/edit?id=${encodeURIComponent(reminderId)}`}>設定を編集</Button><Button href={`/reminders/detail?id=${encodeURIComponent(reminderId)}`}>実行履歴</Button></div>
    </div>
    {notice ? <NoteBar tone="info">{notice}</NoteBar> : null}
    <Card padding="default"><CardHeader title="登録状況" meta={`登録 ${items.length}件 / 有効 ${activeCount}件`} /></Card>
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
  </main>
}

export default function ReminderRegistrantsRoute() {
  const params = useParams<{ id?: string | string[] }>()
  const reminderId = typeof params.id === 'string' ? params.id : ''
  return <ReminderRegistrantsPage reminderId={reminderId} />
}
