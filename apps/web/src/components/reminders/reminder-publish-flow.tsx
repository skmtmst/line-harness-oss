'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReminderDraftSettings, ReminderDraftVersion, ReminderPreviewResult, ReminderPublishResult, ReminderValidationResult } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import { TableHeadRow, Th } from '@/components/shared/table'
import { LinePreview, Pill, ReminderFooter, ReminderPanel, ReminderWizard, ReminderWorkspace, SummaryCard } from './reminder-v6-ui'
import { usePageTitle } from '@/components/shell/page-chrome'

export type ReminderPublishStage = 'target' | 'preview' | 'test' | 'confirm' | 'done'

export function reminderAudienceCounts(validation: ReminderValidationResult | null) {
  const matched = validation?.audience.matched ?? null
  const excluded = validation?.audience.excluded ?? null
  return {
    matched,
    excluded,
    total: matched == null || excluded == null ? null : matched + excluded,
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function countLabel(value: number | null, unit: string): string {
  return value == null ? `—${unit}` : `${value.toLocaleString('ja-JP')}${unit}`
}

export default function ReminderPublishFlow({ reminderId, stage }: { reminderId: string; stage: ReminderPublishStage }) {
  usePageTitle(stage === 'target' ? 'リマインダを作成・対象と終了条件' : stage === 'preview' ? 'リマインダを作成・配信予定' : stage === 'test' ? 'リマインダをテスト送信' : stage === 'confirm' ? 'リマインダを作成・最終確認' : 'リマインダ・有効化完了')
  const router = useRouter()
  const [draft, setDraft] = useState<ReminderDraftVersion | null>(null)
  const [settings, setSettings] = useState<ReminderDraftSettings | null>(null)
  const [preview, setPreview] = useState<ReminderPreviewResult | null>(null)
  const [validation, setValidation] = useState<ReminderValidationResult | null>(null)
  const [published, setPublished] = useState<ReminderPublishResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testConfirm, setTestConfirm] = useState(false)
  const [testRecipientName, setTestRecipientName] = useState<string | null>(null)

  const go = useCallback((next: ReminderPublishStage) => router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=${next}`), [reminderId, router])
  const loadDraft = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await api.reminders.getDraft(reminderId)
      if (!response.success) throw new Error(response.error)
      setDraft(response.data); setSettings(response.data.settings)
    } catch { setError('下書きを読み込めませんでした。') } finally { setLoading(false) }
  }, [reminderId])

  useEffect(() => { void loadDraft() }, [loadDraft])
  useEffect(() => {
    if (!settings || (stage !== 'preview' && stage !== 'done')) return
    void api.reminders.previewDraft(reminderId).then((response) => { if (response.success) setPreview(response.data); else setError(response.error) }).catch(() => setError('配信予定を確認できませんでした。'))
  }, [reminderId, settings, stage])
  useEffect(() => {
    if (!settings || (stage !== 'target' && stage !== 'confirm' && stage !== 'done')) return
    void api.reminders.validateDraft(reminderId).then((response) => { if (response.success) setValidation(response.data); else setError(response.error) }).catch(() => setError('有効化前チェックを実行できませんでした。'))
  }, [reminderId, settings, stage])

  async function saveTarget() {
    if (!settings) return
    setBusy(true)
    try { const response = await api.reminders.saveDraft(reminderId, settings); if (!response.success) throw new Error(response.error); setDraft(response.data); setSettings(response.data.settings); go('preview') }
    catch { setError('対象と終了条件を保存できませんでした。') } finally { setBusy(false) }
  }
  async function sendTest() {
    setBusy(true); setError('')
    try {
      const response = await api.reminders.testDraft(reminderId, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      setDraft((current) => current ? { ...current, lastTestStatus: 'succeeded', lastTestedAt: response.data.testedAt } : current)
      setTestRecipientName(response.data.recipientName)
      setTestConfirm(false)
    } catch { setError('テスト送信に失敗しました。LINE連携と通知内容を確認してください。') } finally { setBusy(false) }
  }
  async function publishDraft() {
    if (!validation?.valid || draft?.lastTestStatus !== 'succeeded') return
    setBusy(true)
    try { const response = await api.reminders.publishDraft(reminderId); if (!response.success) throw new Error(response.error); setPublished(response.data); go('done') }
    catch { setError('リマインダを有効化できませんでした。') } finally { setBusy(false) }
  }

  if (loading) return <ListState kind="loading" title="下書きを読み込んでいます" />
  if (!draft || !settings) return <ListState kind="error" title="下書きを表示できませんでした" description={error} action={<Button onClick={() => void loadDraft()}>再読み込み</Button>} />

  const current = stage === 'target' ? 2 : stage === 'done' ? 6 : stage === 'confirm' ? 5 : 4
  return (
    <div data-reminder-publish-stage={stage}>
      <ReminderWizard current={current} />
      {error ? <p className="bg-danger-bg text-danger mb-3 rounded-lg p-3 text-sm">{error}</p> : null}
      {stage === 'target' ? <TargetStage settings={settings} validation={validation} onChange={setSettings} onNext={() => void saveTarget()} busy={busy} /> : null}
      {stage === 'preview' ? <PreviewStage settings={settings} preview={preview} onNext={() => go('test')} /> : null}
      {stage === 'test' ? <TestStage draft={draft} recipientName={testRecipientName} onConfirm={() => setTestConfirm(true)} onNext={() => go('confirm')} /> : null}
      {stage === 'confirm' ? <ConfirmStage draft={draft} settings={settings} validation={validation} onPublish={() => void publishDraft()} busy={busy} /> : null}
      {stage === 'done' ? <DoneStage draft={draft} published={published} preview={preview} validation={validation} /> : null}
      <ConfirmDialog open={testConfirm} title="テスト送信しますか？" description="自分のLINEへ確認用メッセージを1通送信します。" confirmLabel="テスト送信" cancelLabel="配信予定へ戻る" busy={busy} onConfirm={() => void sendTest()} onCancel={() => setTestConfirm(false)} />
    </div>
  )
}

export function TargetStage({ settings, validation, onChange, onNext, busy }: { settings: ReminderDraftSettings; validation: ReminderValidationResult | null; onChange: (value: ReminderDraftSettings) => void; onNext: () => void; busy: boolean }) {
  const stop = settings.stopConditions
  const audience = reminderAudienceCounts(validation)
  const stopCount = Object.values(stop).filter((value) => value === true || typeof value === 'number').length
  return <div data-design-node="s7T2dz"><ReminderWorkspace aside={<><SummaryCard rows={[["基準日", '予約日時（Google Meet相談）'], ['対象者', countLabel(audience.matched, '人')], ['通知ステップ', `${settings.steps.length}件`], ['停止条件', `${stopCount}件`]]} /><ReminderPanel title="安全な運用" note="誤送信を防ぐための設定です。"><ul className="text-ink-secondary space-y-2 text-xs"><li>● 基準日が空欄なら開始しない</li><li>● 過去日時の通知は送らない</li><li>● 同じ時刻の重複送信をまとめる</li></ul></ReminderPanel></>}>
    <ReminderPanel title="対象者の条件" note="どの友だちにリマインダを開始するか設定します。"><div className="rounded-lg border border-hairline p-3 text-xs"><b>下書きに保存した対象条件</b><div className="mt-3 grid grid-cols-3 gap-2"><Metric label="条件一致" value={countLabel(audience.total, '人')} /><Metric label="開始予定" value={countLabel(audience.matched, '人')} success /><Metric label="除外" value={countLabel(audience.excluded, '人')} warning /></div><p className="text-info mt-3">{validation ? '公開前チェックの最新結果です。' : '公開前チェックを実行しています。'} 基準日が登録・変更された時点で対象を自動再判定します。</p></div></ReminderPanel>
    <ReminderPanel title="終了・停止条件" note="不要になった通知を自動で止めます。"><div className="divide-y divide-hairline">{[["bookingCancelled",'予約がキャンセルされた','即時停止'],['supportMarkCompleted','対応マークが「完了」になった','残りを停止'],['daysAfterTarget','基準日を過ぎて7日経過','自動終了'],['friendBlocked','友だちがブロックした','即時停止']].map(([key,label,result]) => <label key={key} className="flex items-center gap-3 py-3 text-xs"><input type="checkbox" checked={key === 'daysAfterTarget' ? stop.daysAfterTarget != null : Boolean(stop[key as keyof typeof stop])} onChange={(event) => onChange({ ...settings, stopConditions: { ...stop, [key]: key === 'daysAfterTarget' ? event.target.checked ? 7 : null : event.target.checked } })} /><span className="flex-1 font-medium">{label}</span><Pill tone="success">{result}</Pill></label>)}</div></ReminderPanel>
    <ReminderPanel title="完了後のアクション"><p className="text-xs">対応マークを「フォロー済み」に変更</p></ReminderPanel>
    <ReminderFooter primary={busy ? '保存中…' : '配信予定へ'} primaryDisabled={busy} onPrimary={onNext} />
  </ReminderWorkspace></div>
}

function PreviewStage({ settings, preview, onNext }: { settings: ReminderDraftSettings; preview: ReminderPreviewResult | null; onNext: () => void }) {
  const rows = preview?.items ?? []
  return <div data-design-node="JCz6J"><ReminderWorkspace aside={<><SummaryCard title="予定数" rows={[["対象者", preview ? countLabel(preview.summary.audience,'人') : '—人'], ['今後7日', preview ? countLabel(preview.summary.next7Days,'通') : '—通'], ['今後30日', preview ? countLabel(preview.summary.next30Days,'通') : '—通'], ['重複調整', preview ? countLabel(preview.summary.duplicateCount,'通') : '—通']]} /><ReminderPanel title="担当者通知" note="運用上の問題をSlackへ知らせます。"><ul className="text-xs leading-6"><li>基準日未設定</li><li>通知失敗</li><li>重複・時間外</li><li>対象人数の急増</li></ul></ReminderPanel><LinePreview caption="次は 8/24（月）09:00 に届きます">Kentaさん、明日のGoogle Meet相談のご案内です。{`\n`}日時：8/25（火）10:00{`\n`}参加URL：meet.google.com/xxx-xxxx-xxx{`\n\n`}Google Meetに参加</LinePreview></>}>
    <ReminderPanel title="配信予定プレビュー" note={preview ? `基準日を ${formatDate(preview.targetDate)} とした場合の送信予定です。` : '配信予定を確認しています。'}><div className="mb-3 flex gap-2"><Button variant="primary">今後7日</Button><Button>今後30日</Button><Button>競合のみ</Button></div>{!preview ? <ListState kind="loading" title="配信予定を確認しています" /> : <div className="overflow-hidden rounded-lg border border-hairline"><table className="w-full text-left text-xs"><thead className="bg-canvas-sunken"><TableHeadRow><Th>送信日時</Th><Th>通知</Th><Th>対象</Th><Th>状態</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{rows.map((item) => <tr key={item.stableStepId}><td className="p-2">{formatDateTime(item.scheduledAt)}</td><td><b>{item.label}</b><small className="block text-ink-faint">Google Meet相談 ／ {item.stepNumber}通目</small></td><td>{item.state === 'duplicate' ? '71人' : '82人'}</td><td><Pill tone={item.state === 'duplicate' ? 'warning' : 'success'}>{item.state === 'duplicate' ? '2人が重複' : '予定どおり'}</Pill></td></tr>)}</tbody></table></div>}</ReminderPanel>
    <ReminderPanel title="重複・時間帯の確認" note="送信前に問題になりそうな予定を自動検知します。"><div className="bg-warning-bg text-warning rounded-lg p-3 text-xs"><b>8/26 09:00に2人が重複</b><p>同じ友だちへの同時刻通知を1通にまとめます。</p></div><dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><Metric label="送信可能時間" value="08:00〜21:00" /><Metric label="時間外の扱い" value="翌朝に繰り越す" /><Metric label="通知ステップ" value={`${settings.steps.length}件`} /></dl></ReminderPanel>
    <ReminderFooter primary="テスト送信へ" onPrimary={onNext} />
  </ReminderWorkspace></div>
}

export function TestStage({ draft, recipientName, onConfirm, onNext }: { draft: ReminderDraftVersion; recipientName: string | null; onConfirm: () => void; onNext: () => void }) {
  const testedAt = formatDateTime(draft.lastTestedAt)
  const recipient = recipientName ?? 'テスト送信後に表示'
  return <div data-design-node="W98zZQ"><ReminderWorkspace aside={<><SummaryCard rows={[["本番への影響", 'なし'], ['送信数', '1通'], ['送信先', recipient], ['送信方法', 'LINE公式']]} /><LinePreview caption="［テスト］表示例">［テスト］名前さん、明日のGoogle Meet相談のご案内です。{`\n`}日時：相談の日時{`\n`}参加URL：参加URL{`\n\n`}Google Meetに参加</LinePreview></>}>
    <ReminderPanel title="テスト対象" note="自分のLINEへ確認用メッセージを送ります。"><dl className="grid grid-cols-2 gap-3 text-xs"><Metric label="送信先" value={recipient} /><Metric label="最終テスト日時" value={testedAt} /></dl></ReminderPanel>
    <ReminderPanel title="差し込み値の確認" note="口に保存されていない値は表示例です。本番でどこから取るかを並べて確認します。"><table className="w-full text-left text-xs"><thead><TableHeadRow><Th>変数</Th><Th>テストで使う値（表示例）</Th><Th>本番での取得元</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline"><tr><td className="py-2">名前</td><td>Kenta</td><td>友だちのLINE表示名</td></tr><tr><td className="py-2">相談の日時</td><td>8/24（月）18:00</td><td>予約管理の予約日時</td></tr><tr><td className="py-2">参加URL</td><td>meet.google.com/test-0000</td><td>予約ごとに発行されるMeet URL</td></tr></tbody></table></ReminderPanel>
    <ReminderPanel title="テスト送信の履歴" note="下書きに記録された直近のテストだけを表示します。" action={draft.lastTestStatus === 'succeeded' ? <Pill tone="success">直近のテストは成功</Pill> : undefined}><table className="w-full text-left text-xs"><thead><TableHeadRow><Th>送信日時</Th><Th>送信した通知・宛先</Th><Th>結果</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline"><tr><td className="py-2">{testedAt}</td><td>下書きの通知 ／ {recipient}</td><td><Pill tone={draft.lastTestStatus === 'succeeded' ? 'success' : 'warning'}>{draft.lastTestStatus === 'succeeded' ? '送信できました' : '成功記録なし'}</Pill></td></tr></tbody></table></ReminderPanel>
    <ReminderFooter status={draft.lastTestStatus === 'succeeded' ? `テスト済み ${formatDateTime(draft.lastTestedAt)}` : '下書き保存'} secondary={{ label: 'テスト送信', onClick: onConfirm }} primary="最終確認へ" primaryDisabled={draft.lastTestStatus !== 'succeeded'} onPrimary={onNext} />
  </ReminderWorkspace></div>
}

function ConfirmStage({ draft, settings, validation, onPublish, busy }: { draft: ReminderDraftVersion; settings: ReminderDraftSettings; validation: ReminderValidationResult | null; onPublish: () => void; busy: boolean }) {
  return <div data-design-node="s6Vvp"><ReminderWorkspace aside={<><LinePreview caption="1通目は 基準日の1日前 18:00 に届きます">名前さん、明日のGoogle Meet相談のご案内です。{`\n`}日時：相談の日時{`\n`}参加URL：参加URL{`\n\n`}Google Meetに参加</LinePreview><SummaryCard title="有効化する内容" rows={[["状態", '有効化前'], ['対象者', validation ? countLabel(validation.audience.matched,'人') : '—人'], ['除外', validation ? countLabel(validation.audience.excluded,'人') : '—人'], ['予定通知', '1,194通'], ['担当者通知', 'Slack']]} /></>}>
    <ReminderPanel title="有効化前チェック">{!validation ? <ListState kind="loading" title="有効化前チェックを実行しています" /> : <ul className="space-y-2 text-xs">{validation.checks.map((check) => <li key={check.key} className="flex items-center gap-2"><Pill tone={check.status === 'passed' ? 'success' : check.status === 'warning' ? 'warning' : 'danger'}>{check.status === 'passed' ? '✓' : '!'}</Pill>{check.label}</li>)}</ul>}</ReminderPanel>
    <ReminderPanel title="最終確認" note="有効化すると、基準日の登録・変更に応じて自動で通知が始まります。"><dl className="divide-y divide-hairline text-xs"><Metric label="管理名" value={settings.name} /><Metric label="基準日" value="Google Meet相談日時" /><Metric label="対象" value={validation ? countLabel(validation.audience.matched,'人') : '—人'} /><Metric label="通知ステップ" value="前日・1時間前・当日" /><Metric label="送信可能時間" value="08:00〜21:00" /><Metric label="停止条件" value="予約取消・対応完了" /></dl><p className="bg-warning-bg text-warning mt-3 rounded-lg p-3 text-xs">有効化後は対象者ごとに予定が作成されます。いつでも一時停止できます。</p></ReminderPanel>
    <ReminderFooter secondary={{ label: '戻って修正' }} primary={busy ? '有効化中…' : 'この内容で公開'} primaryDisabled={busy || !validation?.valid || draft.lastTestStatus !== 'succeeded'} onPrimary={onPublish} />
  </ReminderWorkspace></div>
}

function DoneStage({ draft, published, preview, validation }: { draft: ReminderDraftVersion; published: ReminderPublishResult | null; preview: ReminderPreviewResult | null; validation: ReminderValidationResult | null }) {
  return <div data-design-node="PSmHo"><ReminderWorkspace fill aside={<><ReminderPanel title="次にできること" note="稼働中でも安全に管理できます。"><ul className="space-y-2 text-xs"><li>リマインダを一時停止</li><li>内容を編集する</li><li>対象者を確認する</li><li>リマインダを複製して作成</li></ul></ReminderPanel><ReminderPanel title="監視中" note="問題が起きた場合だけ通知します。"><ul className="space-y-2 text-xs"><li>● 送信失敗</li><li>● 対象数の急増</li><li>● 基準日の不整合</li></ul></ReminderPanel><LinePreview caption="最初の通知は 8/24（月）09:00">Kentaさん、明日のGoogle Meet相談のご案内です。{`\n`}日時：8/25（火）10:00{`\n`}参加URL：meet.google.com/xxx-xxxx-xxx{`\n\n`}Google Meetに参加</LinePreview></>}>
    <section className="bg-canvas rounded-card border-hairline border p-6 shadow-sm">
      <div className="text-center"><span className="bg-success-bg text-success mx-auto grid h-10 w-10 place-items-center rounded-full text-xl">✓</span><h2 className="text-ink mt-3 text-base font-bold">リマインダを有効化しました</h2><p className="text-ink-faint mt-1 text-xs">基準日の登録・変更に合わせて、対象者ごとの通知予定を自動作成します。</p></div>
      <dl className="mx-auto mt-5 max-w-xl divide-y divide-hairline text-xs"><Metric label="管理名" value={draft.settings.name} /><Metric label="対象" value={countLabel(published?.audience ?? validation?.audience.matched ?? null,'人')} /><Metric label="通知ステップ" value="前日・1時間前・当日" /><Metric label="次回送信" value={formatDateTime(published?.nextScheduledAt ?? preview?.items[0]?.scheduledAt)} /><Metric label="状態" value="稼働中" /></dl>
      <p className="bg-info-bg text-info mx-auto mt-4 max-w-xl rounded-lg p-3 text-xs">開始・完了・エラーはSlackの同じスレッドへ通知します。</p><div className="mt-5 flex justify-center gap-2"><Button href="/reminders">一覧へ戻る</Button><Button variant="primary">通知予定を確認</Button></div>
    </section>
  </ReminderWorkspace></div>
}

function Metric({ label, value, success = false, warning = false }: { label: string; value: string; success?: boolean; warning?: boolean }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-ink-faint">{label}</dt><dd className={success ? 'text-success font-bold' : warning ? 'text-warning font-bold' : 'text-ink font-bold'}>{value}</dd></div>
}
