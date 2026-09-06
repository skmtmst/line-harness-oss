'use client'

import { useEffect, useState } from 'react'
import type { Folder, ReminderDraftSettings, ReminderTriggerType } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextInput } from '@/components/shared/form-controls'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import { Choice, Field, LinePreview, ReminderFooter, ReminderPanel, ReminderWizard, ReminderWorkspace, SummaryCard } from '@/components/reminders/reminder-v6-ui'
import { usePageTitle } from '@/components/shell/page-chrome'

const inputClass = 'border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'
const templateRows = [
  ['予約の前日案内', '無断キャンセルを減らす', '予約日時', '1日前 18:00'],
  ['予約の直前リマインド', '開始前に気づいてもらう', '予約日時', '1時間前'],
  ['契約更新のお知らせ', '更新の検討時間をつくる', '契約終了日', '30日前 10:00'],
  ['誕生日のお祝い', '来店・購入のきっかけに', '誕生日', '当日 10:00'],
]

export default function NewReminderPage() {
  usePageTitle('リマインダを作成・基本設定')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [folderId, setFolderId] = useState('')
  const [triggerType, setTriggerType] = useState<ReminderTriggerType>('booking')
  const [folders, setFolders] = useState<Folder[]>([])
  const [foldersLoadState, setFoldersLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloadToken, setFoldersReloadToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setFoldersLoadState('loading')
    void api.folders.list('reminder').then((res) => {
      if (!active) return
      if (!res.success) return setFoldersLoadState('error')
      setFolders(res.data)
      setFoldersLoadState('ready')
      const booking = res.data.find((folder) => folder.name.includes('予約'))
      if (booking) setFolderId((current) => current || booking.id)
    }).catch(() => { if (active) setFoldersLoadState('error') })
    return () => { active = false }
  }, [foldersReloadToken])

  async function save() {
    if (accountLoading || !selectedAccountId) return setError('LINEアカウントを選んでください')
    if (!name.trim()) return setError('リマインダ名を入力してください')
    setSaving(true)
    setError('')
    try {
      const settings: ReminderDraftSettings = {
        name: name.trim(), description: description.trim() || null, lineAccountId: selectedAccountId!,
        folderId: folderId || null, triggerType, deliveryMode: 'time', triggerFieldId: null,
        repeatYearly: false, triggerOffsetMinutes: null, sendAtTime: '18:00', targetTagId: null,
        stopConditions: { bookingCancelled: true, supportMarkCompleted: true, daysAfterTarget: 7, friendBlocked: true },
        steps: [{ stableStepId: crypto.randomUUID(), offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '明日のGoogle Meet相談のご案内です。' }],
      }
      const res = await api.reminders.createDraft(settings)
      if (!res.success) throw new Error(res.error)
      window.location.href = `/reminders/edit?id=${encodeURIComponent(String(res.data.reminderId))}&stage=target`
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '下書きを保存できませんでした')
    } finally { setSaving(false) }
  }

  return (
    <div data-design-node="uJP22" data-design="Body">
      <div data-design="Crumb"><ReminderWizard current={1} /></div>
      <div data-design="Head" />
      {error ? <p className="bg-danger-bg text-danger mb-3 rounded-lg p-3 text-sm">{error}</p> : null}
      <ReminderWorkspace aside={<div data-design="Right">
        <SummaryCard rows={[["対象者", '未設定'], ['基準日', '予約日時'], ['通知ステップ', '未設定'], ['状態', '下書き']]} />
        <LinePreview caption="通知ステップは STEP 3 で設定します" empty>メッセージは STEP 3 で作成します。基準日を選ぶと、差し込める項目がここに出ます。</LinePreview>
        <ReminderPanel title="テスト送信" note="通知イメージを見る"><p className="text-ink-faint text-xs leading-5">テスト送信と表示確認は、STEP 3 で通知を作ると使えます。</p></ReminderPanel>
      </div>}>
        <div data-design="Left" className="grid gap-3">
        <ReminderPanel title="基本設定" note="管理名とフォルダを設定します。">
          <div className="grid gap-4">
            <Field label="リマインダ名　必須" note={`${name.length} / 60文字`}><TextInput value={name} maxLength={60} placeholder="例：Google Meet相談の前日案内" onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
            <Field label="フォルダ"><div className="flex items-center gap-2"><SelectField value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={foldersLoadState !== 'ready'} aria-label="リマインダのフォルダ" className={inputClass} options={[{ value: '', label: foldersLoadState === 'loading' ? 'フォルダを読み込み中' : foldersLoadState === 'error' ? 'フォルダを読み込めませんでした' : '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />{foldersLoadState === 'error' ? <Button onClick={() => setFoldersReloadToken((value) => value + 1)}>フォルダを再読み込み</Button> : <Button>＋ フォルダを追加</Button>}</div>{foldersLoadState === 'ready' && folders.length === 0 ? <small>フォルダはまだありません。一覧から追加できます。</small> : null}</Field>
            <Field label="社内メモ　任意" note="友だちには表示されません"><TextArea rows={3} value={description} placeholder="運用目的や注意点を入力" onChange={(event) => setDescription(event.target.value)} className={inputClass} /></Field>
          </div>
        </ReminderPanel>
        <ReminderPanel title="基準日の選択" note="予約日時・友だち情報欄の日付・フォーム回答日から選べます。">
          <div className="grid gap-2 md:grid-cols-3"><Choice selected={triggerType === 'booking'} title="予約日時を基準にする" note="予約管理・Google Meet相談の日時に連動します。" onClick={() => setTriggerType('booking')} /><Choice selected={triggerType === 'friend_field'} title="友だち情報欄の日付" note="誕生日・契約終了日など、日付型の情報欄を選びます。" onClick={() => setTriggerType('friend_field')} /><Choice selected={triggerType === 'event'} title="フォーム回答日" note="回答フォームに答えた日を起点にします。" onClick={() => setTriggerType('event')} /></div>
        </ReminderPanel>
        <ReminderPanel title="ひな形から作る" note="よく使う組み合わせです。選ぶと基準日・通知ステップ・文面がまとめて入ります。" action={<Button>ひな形を管理</Button>}>
          <div className="overflow-hidden rounded-lg border border-hairline"><table className="w-full text-left text-xs"><thead className="bg-canvas-sunken text-ink-faint"><TableHeadRow><Th>ひな形</Th><Th>基準日</Th><Th>通知のタイミング</Th><Th>操作</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{templateRows.map(([title,note,base,timing]) => <tr key={title}><td className="p-2"><strong className="block text-ink">{title}</strong><span className="text-ink-faint">{note}</span></td><td>{base}</td><td>{timing}</td><td><Button>このひな形を使う</Button></td></tr>)}</tbody></table></div>
        </ReminderPanel>
        <ReminderFooter primary={saving ? '保存中…' : '対象設定へ'} primaryDisabled={saving} onPrimary={() => void save()} />
        </div>
      </ReminderWorkspace>
    </div>
  )
}
