'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReminderDraftSettings, ReminderDraftVersion } from '@line-crm/shared'
import { api } from '@/lib/api'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextInput } from '@/components/shared/form-controls'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  Field,
  LinePreview,
  Pill,
  ReminderButton as Button,
  ReminderFooter,
  ReminderPanel,
  ReminderStepCard,
  ReminderWizard,
  ReminderWorkspace,
  SummaryCard,
} from '@/components/reminders/reminder-v6-ui'
import { usePageTitle } from '@/components/shell/page-chrome'
export function Issue469ReminderStepEditor({ reminderId }: { reminderId: string }) {
  usePageTitle('リマインダを作成・通知ステップ')
  const router = useRouter()
  const [settings, setSettings] = useState<ReminderDraftSettings | null>(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void api.reminders.getDraft(reminderId).then((response) => {
      if (!response.success) throw new Error(response.error)
      setSettings(response.data.settings)
      setBody(response.data.settings.steps[0]?.messageContent ?? '')
    }).catch(() => setError('リマインダを読み込めませんでした。'))
  }, [reminderId])

  if (!settings) return <p className={error ? 'text-danger p-6 text-sm' : 'text-ink-faint p-6 text-sm'}>{error || '読み込んでいます'}</p>

  const stepRows = settings.steps.map((step, index) => ({
    id: step.stableStepId,
    timing: index === 0 ? '基準日の 1日前 18:00' : index === 1 ? '基準日の 1時間前' : '基準日 当日 09:00',
    title: index === 0 ? '前日のお知らせ' : index === 1 ? '1時間前のお知らせ' : '当日のご案内',
    note: step.messageContent,
  }))

  async function save() {
    setSaving(true)
    setError('')
    try {
      const next = { ...settings!, steps: settings!.steps.map((step, index) => index === 0 ? { ...step, messageContent: body } : step) }
      const response = await api.reminders.saveDraft(reminderId, next)
      if (!response.success) throw new Error(response.error)
      router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=preview`)
    } catch { setError('通知ステップを保存できませんでした。') } finally { setSaving(false) }
  }

  return <div data-design-node="J64xI" className="space-y-3">
    <ReminderWizard current={3} />
    <ReminderWorkspace aside={<div className="grid gap-3">
      <SummaryCard rows={[["対象者", '398人'], ['基準日', '予約日時（Google Meet相談）'], ['通知ステップ', `${settings.steps.length}件`], ['状態', '下書き']]} />
      <LinePreview caption="基準日の 1日前 18:00 に届きます">Kentaさん、明日のGoogle Meet相談のご案内です。{`\n`}日時：8/24（月）18:00{`\n`}参加URL：meet.google.com/xxx-xxxx-xxx{`\n\n`}Google Meetに参加</LinePreview>
      <div className="grid grid-cols-2 gap-2"><Button>テスト送信</Button><Button>通知イメージを見る</Button></div>
    </div>}>
      <ReminderPanel title="通知ステップ" note="基準日を軸に、何回・いつ送るかを並べます。上から順に届きます。" action={<Button>＋ 通知を追加</Button>}>
        <div className="grid min-h-28 gap-2 md:grid-cols-3">{stepRows.map((step, index) => <ReminderStepCard key={step.id} selected={index === 0} number={index + 1} timing={step.timing} title={step.title} note={step.note} />)}</div>
      </ReminderPanel>
      <ReminderPanel title="1通目・前日のお知らせ" note="送るタイミングと文面を決めます。" action={<div className="flex gap-2"><Button>この通知を複製</Button><Button>この通知を削除</Button></div>}>
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="起点"><TextInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="基準日（予約日時）" readOnly /></Field>
            <Field label="ずらす"><TextInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="1日前" readOnly /></Field>
            <Field label="送信時刻"><TextInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="18:00" readOnly /></Field>
            <Field label="送信可能時間の外になったら"><SelectField className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" defaultValue="next" options={[{ value: 'next', label: '翌朝 08:00 に繰り越す' }]} /></Field>
          </div>
          <div className="flex flex-wrap gap-2"><Pill tone="success">名前</Pill><Pill>友だち情報</Pill><Pill>共通情報</Pill><Pill>回答フォーム</Pill><Pill>配信日</Pill><Pill>その他</Pill></div>
          <Field label="本文　必須" note={`${body.length} / 5,000文字`}><TextArea rows={3} className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={body} onChange={(event) => setBody(event.target.value)} /></Field>
          <div className="border-hairline grid grid-cols-2 items-center gap-3 rounded-lg border px-4 py-3 text-xs"><b>この通知の送信後アクション</b><Button>＋ アクションを追加</Button><span className="col-span-2">対応マークを「確認待ち」に変更</span></div>
        </div>
      </ReminderPanel>
      <ReminderPanel title="URLの扱い" note="短縮するとクリック数を計測できます。Meetの参加URLは短縮しない設定です。"><div className="flex items-center justify-between rounded-lg border border-hairline p-3 text-xs"><span>Google Meet 参加URL　<Pill>参加URL（差し込み）</Pill></span><strong>短縮しない</strong></div></ReminderPanel>
      {error ? <p className="text-danger text-xs">{error}</p> : null}
    </ReminderWorkspace>
    <div className="mt-16"><ReminderFooter primary={saving ? '保存中…' : '送信設定へ'} primaryDisabled={saving || !body.trim()} onPrimary={() => void save()} /></div>
  </div>
}

export function Issue469ReminderTestStage({ reminderId }: { reminderId: string }) {
  usePageTitle('リマインダをテスト送信')
  const router = useRouter()
  const [draft, setDraft] = useState<ReminderDraftVersion | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void api.reminders.getDraft(reminderId).then((response) => {
      if (!response.success) throw new Error(response.error)
      setDraft(response.data)
    }).catch(() => setError('下書きを読み込めませんでした。'))
  }, [reminderId])

  async function sendTest() {
    setBusy(true)
    try {
      const response = await api.reminders.testDraft(reminderId, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      setDraft((current) => current ? { ...current, lastTestStatus: 'succeeded', lastTestedAt: response.data.testedAt } : current)
      setConfirmOpen(false)
    } catch { setError('テスト送信に失敗しました。LINE連携と通知内容を確認してください。') } finally { setBusy(false) }
  }

  if (!draft) return <p className={error ? 'text-danger p-6 text-sm' : 'text-ink-faint p-6 text-sm'}>{error || '下書きを読み込んでいます'}</p>

  return <div data-design-node="W98zZQ" className="space-y-3">
    <ReminderWizard current={4} />
    <ReminderWorkspace aside={<div className="grid gap-3">
      <SummaryCard rows={[["本番への影響", 'なし'], ['送信数', '1通'], ['送信先', 'Kenta Kawano'], ['送信方法', 'LINE公式']]} />
      <LinePreview caption="［テスト］いますぐ届きます">［テスト］Kentaさん、明日のGoogle Meet相談のご案内です。{`\n`}日時：8/24（月）18:00{`\n`}参加URL：meet.google.com/test-0000{`\n\n`}Google Meetに参加</LinePreview>
      <div className="grid grid-cols-2 gap-2"><Button onClick={() => setConfirmOpen(true)}>テスト送信</Button><Button>通知イメージを見る</Button></div>
    </div>}>
      <ReminderPanel title="テスト対象" note="自分のLINEへ確認用メッセージを送ります。"><dl className="grid min-h-24 grid-cols-2 gap-4 text-xs"><Metric label="送信先" value="Kenta Kawano" /><Metric label="テスト日時" value="8/23 01:30" /></dl></ReminderPanel>
      <ReminderPanel title="差し込み値の確認" note="テストで使う値と、本番でどこから取るかを並べて確認します。"><table className="w-full border-collapse text-left text-xs"><thead><TableHeadRow><Th>変数</Th><Th>テストで使う値</Th><Th>本番での取得元</Th></TableHeadRow></thead><tbody className="border-hairline border-t"><tr><td className="px-3 py-3">{'{{name}}'}</td><td className="px-3 py-3">Kenta</td><td className="px-3 py-3">友だちのLINE表示名</td></tr><tr className="border-hairline border-t"><td className="px-3 py-3">{'{{meet_datetime}}'}</td><td className="px-3 py-3">8/24（月）18:00</td><td className="px-3 py-3">予約管理の予約日時</td></tr><tr className="border-hairline border-t"><td className="px-3 py-3">{'{{meet_url}}'}</td><td className="px-3 py-3">meet.google.com/test-0000</td><td className="px-3 py-3">予約ごとに発行されるMeet URL</td></tr></tbody></table></ReminderPanel>
      <ReminderPanel title="テスト送信の履歴" note="有効化するには、直近のテストが成功している必要があります。" action={<Pill tone="success">直近のテストは成功</Pill>}><table className="w-full border-collapse text-left text-xs"><thead><TableHeadRow><Th>送信日時</Th><Th>送信した通知・宛先</Th><Th>結果</Th></TableHeadRow></thead><tbody className="border-hairline border-t"><tr><td className="px-3 py-3">8/23 01:30</td><td className="px-3 py-3">1通目・前日のお知らせ ／ Kenta Kawano</td><td className="px-3 py-3"><Pill tone="success">送信できました</Pill></td></tr><tr className="border-hairline border-t"><td className="px-3 py-3">8/22 22:10</td><td className="px-3 py-3">2通目・1時間前のお知らせ ／ Kenta Kawano</td><td className="px-3 py-3"><Pill tone="success">送信できました</Pill></td></tr><tr className="border-hairline border-t"><td className="px-3 py-3">8/22 21:45</td><td className="px-3 py-3">1通目・前日のお知らせ ／ Kenta Kawano</td><td className="px-3 py-3"><Pill tone="warning">変数が空でした</Pill></td></tr></tbody></table></ReminderPanel>
      {error ? <p className="text-danger text-xs">{error}</p> : null}
    </ReminderWorkspace>
    <div className="mt-16"><ReminderFooter status="テスト済み 2026/09/06 18:00" secondary={{ label: 'テスト送信', onClick: () => setConfirmOpen(true) }} primary="最終確認へ" onPrimary={() => router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=confirm`)} /></div>
    <ConfirmDialog open={confirmOpen} title="テスト送信しますか？" description="Kenta Kawanoさんへ確認用メッセージを1通送信します。" confirmLabel="テスト送信" cancelLabel="配信予定へ戻る" busy={busy} onConfirm={() => void sendTest()} onCancel={() => setConfirmOpen(false)} />
  </div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-ink-faint">{label}</dt><dd className="text-ink font-bold">{value}</dd></div>
}
