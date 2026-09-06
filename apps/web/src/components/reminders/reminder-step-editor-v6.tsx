'use client'

import { useEffect, useState } from 'react'
import type { ReminderDraftSettings } from '@line-crm/shared'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextInput } from '@/components/shared/form-controls'
import { Field, LinePreview, ReminderButton as Button, ReminderFooter, ReminderPanel, ReminderStepCard, ReminderWizard, ReminderWorkspace, SummaryCard, Pill } from './reminder-v6-ui'
import { usePageTitle } from '@/components/shell/page-chrome'

const inputClass = 'border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'

export default function ReminderStepEditorV6({ reminderId }: { reminderId: string }) {
  usePageTitle('リマインダを作成・通知ステップ')
  const router = useRouter()
  const [settings, setSettings] = useState<ReminderDraftSettings | null>(null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void api.reminders.getDraft(reminderId).then((response) => {
      if (!response.success) throw new Error(response.error)
      setSettings(response.data.settings)
      setBody(response.data.settings.steps[0]?.messageContent ?? '')
    }).catch(() => setError('リマインダを読み込めませんでした。')).finally(() => setLoading(false))
  }, [reminderId])

  if (loading) return <p className="text-ink-faint p-6 text-sm">読み込んでいます</p>
  if (!settings) return <p className="text-danger p-6 text-sm">{error}</p>
  const stepRows = settings.steps.map((step, index) => ({
    id: step.stableStepId,
    timing: index === 0 ? '基準日の 1日前 18:00' : index === 1 ? '基準日の 1時間前' : '基準日 当日 09:00',
    title: index === 0 ? '前日のお知らせ' : index === 1 ? '1時間前のお知らせ' : '当日のご案内',
    note: step.messageContent,
  }))

  async function save() {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      const next = { ...settings, steps: settings.steps.map((step, index) => index === 0 ? { ...step, messageContent: body } : step) }
      const response = await api.reminders.saveDraft(reminderId, next)
      if (!response.success) throw new Error(response.error)
      setSettings(response.data.settings)
      router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=preview`)
    } catch { setError('通知ステップを保存できませんでした。') } finally { setSaving(false) }
  }

  return (
    <div data-design-node="J64xI">
      <ReminderWizard current={3} />
      <ReminderWorkspace aside={<>
        <SummaryCard rows={[["対象者", '確認前'], ['基準日', settings.triggerType === 'booking' ? '予約日時' : '設定した日付'], ['通知ステップ', `${settings.steps.length}件`], ['状態', '下書き']]} />
        <LinePreview caption="基準日の 1日前 18:00 に届きます">Kentaさん、明日のGoogle Meet相談のご案内です。{`\n`}日時：8/24（月）18:00{`\n`}参加URL：meet.google.com/xxx-xxxx-xxx{`\n\n`}Google Meetに参加</LinePreview>
        <ReminderPanel title="テスト送信" note="通知イメージを見る"><Button>テスト送信</Button></ReminderPanel>
      </>}>
        <ReminderPanel title="通知ステップ" note="基準日を軸に、何回・いつ送るかを並べます。上から順に届きます。" action={<Button>＋ 通知を追加</Button>}>
          <div className="grid gap-2 md:grid-cols-3">{stepRows.map((step, index) => <ReminderStepCard key={step.id} selected={index === 0} number={index + 1} timing={step.timing} title={step.title} note={step.note} />)}</div>
        </ReminderPanel>
        <ReminderPanel title="1通目・前日のお知らせ" note="送るタイミングと文面を決めます。" action={<div className="flex gap-2"><Button>この通知を複製</Button><Button>この通知を削除</Button></div>}>
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3"><Field label="起点"><TextInput className={inputClass} value="基準日（予約日時）" readOnly /></Field><Field label="ずらす"><TextInput className={inputClass} value="1日前" readOnly /></Field><Field label="送信時刻"><TextInput type="time" className={inputClass} defaultValue="18:00" /></Field></div>
            <Field label="送信可能時間の外になったら"><SelectField className={inputClass} defaultValue="next" options={[{ value: 'next', label: '翌朝 08:00 に繰り越す' }]} /></Field>
            <div className="flex flex-wrap gap-2"><Pill tone="success">名前</Pill><Pill>友だち情報</Pill><Pill>共通情報</Pill><Pill>回答フォーム</Pill><Pill>配信日</Pill><Pill>その他</Pill></div>
            <Field label="本文　必須" note={`${body.length} / 5,000文字`}><TextArea rows={7} className={inputClass} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
            <ReminderPanel title="この通知の送信後アクション" action={<Button>＋ アクションを追加</Button>}><p className="text-xs">対応マークを「確認待ち」に変更</p></ReminderPanel>
            <ReminderPanel title="URLの扱い" note="短縮するとクリック数を計測できます。Meetの参加URLは短縮しない設定です。"><div className="flex items-center justify-between rounded-lg border border-hairline p-3 text-xs"><span>Google Meet 参加URL　<Pill>参加URL（差し込み）</Pill></span><strong>短縮しない</strong></div></ReminderPanel>
          </div>
        </ReminderPanel>
        {error ? <p className="text-danger text-xs">{error}</p> : null}
        <ReminderFooter primary={saving ? '保存中…' : '送信設定へ'} primaryDisabled={saving || !body.trim()} onPrimary={() => void save()} />
      </ReminderWorkspace>
    </div>
  )
}
