'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReminderDraftSettings, ReminderDraftStep, ReminderDraftVersion, ReminderValidationResult } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
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
import { firstReminderStepMessage, reminderPlaceholders } from '@/components/reminders/reminder-labels'
import { useReminderTestRecipient } from '@/components/reminders/use-reminder-test-recipient'
import { TestRecipientGuidance, testRecipientLabel } from '@/components/reminders/test-recipient-guidance'

function formatTestedAt(value: string | null): string {
  if (!value) return 'テスト記録なし'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'テスト記録なし'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

/** カードに出す「いつ届くか」。保存済みの offsetDays/sendAtTime から組み立てる。 */
function stepTimingLabel(step: ReminderDraftStep, deliveryMode: ReminderDraftSettings['deliveryMode']): string {
  if (deliveryMode === 'countdown') {
    const minutes = -(step.offsetMinutes ?? 0)
    if (minutes === 0) return '基準日 ちょうど'
    if (minutes < 0) return `基準日の ${-minutes}分後`
    return minutes % 60 === 0 ? `基準日の ${minutes / 60}時間前` : `基準日の ${minutes}分前`
  }
  const days = -(step.offsetDays ?? 0)
  const dayLabel = days === 0 ? '当日' : days > 0 ? `${days}日前` : `${-days}日後`
  return `基準日 ${dayLabel} ${step.sendAtTime ?? '時刻未設定'}`
}

export function Issue469ReminderStepEditor({ reminderId }: { reminderId: string }) {
  usePageTitle('リマインダを作成・通知ステップ')
  const router = useRouter()
  const [settings, setSettings] = useState<ReminderDraftSettings | null>(null)
  const [savedSettings, setSavedSettings] = useState<ReminderDraftSettings | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [validation, setValidation] = useState<ReminderValidationResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  /*
   * 読み込み・保存の応答は順不同で返る。世代番号で最新の要求だけを
   * 状態へ反映し、遅れた応答が新しい編集を上書きしないようにする。
   */
  const requestSeq = useRef(0)

  const dirty = settings !== null && savedSettings !== null
    && JSON.stringify(settings) !== JSON.stringify(savedSettings)
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const loadDraft = useCallback(async () => {
    const seq = ++requestSeq.current
    try {
      const response = await api.reminders.getDraft(reminderId)
      if (seq !== requestSeq.current) return
      if (!response.success) throw new Error(response.error)
      setSettings(response.data.settings)
      setSavedSettings(response.data.settings)
      setVersionId(response.data.versionId)
      setConflict(false)
      setSelectedStepId((current) => current
        && response.data.settings.steps.some((step) => step.stableStepId === current)
        ? current
        : response.data.settings.steps[0]?.stableStepId ?? null)
    } catch {
      if (seq === requestSeq.current) setError('リマインダを読み込めませんでした。')
    }
  }, [reminderId])

  useEffect(() => { void loadDraft() }, [loadDraft])
  useEffect(() => {
    void api.reminders.validateDraft(reminderId).then((response) => {
      if (response.success) setValidation(response.data)
    }).catch(() => undefined)
  }, [reminderId])

  const updateStep = useCallback((stableStepId: string, patch: Partial<ReminderDraftStep>) => {
    setSettings((current) => current
      ? {
          ...current,
          steps: current.steps.map((step) => step.stableStepId === stableStepId ? { ...step, ...patch } : step),
        }
      : current)
  }, [])

  const addStep = useCallback(() => {
    const step: ReminderDraftStep = {
      stableStepId: crypto.randomUUID(),
      offsetMinutes: 0,
      offsetDays: 0,
      sendAtTime: '09:00',
      messageType: 'text',
      messageContent: '',
    }
    setSettings((current) => current ? { ...current, steps: [...current.steps, step] } : current)
    setSelectedStepId(step.stableStepId)
  }, [])

  const removeStep = useCallback((stableStepId: string) => {
    setSettings((current) => {
      if (!current || current.steps.length <= 1) return current
      const nextSteps = current.steps.filter((step) => step.stableStepId !== stableStepId)
      return { ...current, steps: nextSteps }
    })
    setSelectedStepId((current) => current === stableStepId ? null : current)
  }, [])

  const moveStep = useCallback((stableStepId: string, direction: -1 | 1) => {
    setSettings((current) => {
      if (!current) return current
      const index = current.steps.findIndex((step) => step.stableStepId === stableStepId)
      const next = index + direction
      if (index < 0 || next < 0 || next >= current.steps.length) return current
      const steps = [...current.steps]
      const [moved] = steps.splice(index, 1)
      steps.splice(next, 0, moved)
      return { ...current, steps }
    })
  }, [])

  if (!settings) return <p className={error ? 'text-danger p-6 text-sm' : 'text-ink-faint p-6 text-sm'}>{error || '読み込んでいます'}</p>

  const selectedIndex = settings.steps.findIndex((step) => step.stableStepId === selectedStepId)
  const selectedStep = selectedIndex >= 0 ? settings.steps[selectedIndex] : settings.steps[0]
  const allStepsHaveContent = settings.steps.every((step) => Boolean(step.templateId || step.messageContent.trim()))

  async function save() {
    if (!settings) return
    const seq = ++requestSeq.current
    setSaving(true)
    setError('')
    try {
      const response = await api.reminders.saveDraft(
        reminderId,
        settings,
        versionId ? { expectedVersionId: versionId } : {},
      )
      if (seq !== requestSeq.current) return
      if (!response.success) throw new Error(response.error)
      // サーバー正規化後の形へ両方そろえて、保存直後に dirty が残らないようにする。
      setSettings(response.data.settings)
      setSavedSettings(response.data.settings)
      setVersionId(response.data.versionId)
      router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=preview`)
    } catch (saveError) {
      if (seq !== requestSeq.current) return
      if (saveError instanceof ApiError && saveError.status === 409) {
        setConflict(true)
        setError('この下書きは別の画面で先に更新されました。')
      } else {
        setError(saveError instanceof Error ? saveError.message : '通知ステップを保存できませんでした。')
      }
    } finally {
      if (seq === requestSeq.current) setSaving(false)
    }
  }

  return <div data-design-node="J64xI" className="grid gap-3">
    <ReminderWizard current={3} />
    <ReminderWorkspace aside={<div data-issue546-aside className="grid gap-3">
      <SummaryCard rows={[["対象者", validation?.audience.matched == null ? '検査後に表示' : `${validation.audience.matched.toLocaleString('ja-JP')}人`], ['基準日', '予約日時（Google Meet相談）'], ['通知ステップ', `${settings.steps.length}件`], ['状態', dirty ? '未保存の変更あり' : '下書き']]} />
      <LinePreview caption={`表示例：${stepTimingLabel(selectedStep, settings.deliveryMode)} に届きます`}>{selectedStep.messageContent || '本文を入力すると、ここに表示例が出ます。'}</LinePreview>
    </div>}>
      <ReminderPanel title="通知ステップ" note="基準日を軸に、何回・いつ送るかを並べます。上から順に届きます。">
        <div className="grid min-h-28 gap-2 md:grid-cols-3">{settings.steps.map((step, index) => <ReminderStepCard key={step.stableStepId} selected={step.stableStepId === selectedStep.stableStepId} number={index + 1} timing={stepTimingLabel(step, settings.deliveryMode)} title={`${index + 1}通目のお知らせ`} note={step.messageContent} onClick={() => setSelectedStepId(step.stableStepId)} />)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={addStep} disabled={settings.steps.length >= 50}>通知を追加</Button>
          <Button onClick={() => moveStep(selectedStep.stableStepId, -1)} disabled={selectedIndex <= 0}>前へ移動</Button>
          <Button onClick={() => moveStep(selectedStep.stableStepId, 1)} disabled={selectedIndex < 0 || selectedIndex >= settings.steps.length - 1}>後ろへ移動</Button>
          <Button onClick={() => removeStep(selectedStep.stableStepId)} disabled={settings.steps.length <= 1}>この通知を削除</Button>
        </div>
      </ReminderPanel>
      <ReminderPanel title={`${selectedIndex + 1 || 1}通目のお知らせ`} note="送るタイミングと文面を決めます。">
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="起点"><TextInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value="基準日" readOnly /></Field>
            {settings.deliveryMode === 'countdown' ? (
              <Field label="基準日の何分前" note="後ろにずらすときは負の数"><TextInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" type="number" min={-525600} max={525600} value={String(-(selectedStep.offsetMinutes ?? 0))} onChange={(event) => {
                const minutesBefore = Number(event.target.value)
                if (Number.isInteger(minutesBefore)) updateStep(selectedStep.stableStepId, { offsetMinutes: -minutesBefore })
              }} /></Field>
            ) : (<>
              <Field label="基準日の何日前" note="後ろにずらすときは負の数"><TextInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" type="number" min={-365} max={365} value={String(-(selectedStep.offsetDays ?? 0))} onChange={(event) => {
                const daysBefore = Number(event.target.value)
                if (Number.isInteger(daysBefore)) updateStep(selectedStep.stableStepId, { offsetDays: -daysBefore })
              }} /></Field>
              <Field label="送信時刻"><TextInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={selectedStep.sendAtTime ?? ''} placeholder="HH:MM" onChange={(event) => updateStep(selectedStep.stableStepId, { sendAtTime: event.target.value || null })} /></Field>
            </>)}
            <Field label="送信可能時間の外になったら"><SelectField className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" defaultValue="next" options={[{ value: 'next', label: '翌朝 08:00 に繰り越す' }]} /></Field>
          </div>
          <div className="flex flex-wrap gap-2"><Pill tone="success">名前</Pill><Pill>友だち情報</Pill><Pill>共通情報</Pill><Pill>回答フォーム</Pill><Pill>配信日</Pill><Pill>その他</Pill></div>
          <Field label="本文" required note={`${selectedStep.messageContent.length} / 5,000文字`}><TextArea rows={3} className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={selectedStep.messageContent} onChange={(event) => updateStep(selectedStep.stableStepId, { messageContent: event.target.value })} /></Field>
          <div className="border-hairline rounded-lg border px-4 py-3 text-xs"><b>この通知の送信後アクション</b><span className="mt-1 block">対応マークを「確認待ち」に変更</span></div>
        </div>
      </ReminderPanel>
      <ReminderPanel title="URLの扱い" note="短縮するとクリック数を計測できます。Meetの参加URLは短縮しない設定です。"><div className="flex items-center justify-between rounded-lg border border-hairline p-3 text-xs"><span>Google Meet 参加URL　<Pill>参加URL（差し込み）</Pill></span><strong>短縮しない</strong></div></ReminderPanel>
      {error ? <p className="text-danger text-xs">{error}{conflict ? <button type="button" className="ml-2 underline" onClick={() => void loadDraft()}>最新を読み込み直す</button> : null}</p> : null}
    </ReminderWorkspace>
    <div className="mt-16"><ReminderFooter primary={saving ? '保存中…' : '送信設定へ'} primaryDisabled={saving || !allStepsHaveContent} onPrimary={() => void save()} /></div>
    <ConfirmDialog open={leaveTarget !== null} title="保存していない変更があります" description="このまま移動すると、通知ステップへの変更は失われます。保存せずに移動しますか？" confirmLabel="保存せずに移動" cancelLabel="編集を続ける" onConfirm={confirmLeave} onCancel={cancelLeave} />
    <style jsx global>{`
      [data-design-node='J64xI'] > div:nth-of-type(2) {
        grid-template-columns: minmax(0, 1fr) 390px;
      }
      [data-issue546-aside] > section:first-child {
        min-height: 299px;
      }
      [data-issue546-aside] > section:first-child dl > div {
        padding-block: 20px;
      }
      [data-issue546-aside] > section:nth-child(2) {
        min-height: 389px;
      }
      [data-design-node='J64xI'] textarea {
        min-height: 86px;
        height: 86px;
      }
    `}</style>
  </div>
}

export function Issue469ReminderTestStage({ reminderId }: { reminderId: string }) {
  usePageTitle('リマインダをテスト送信')
  const router = useRouter()
  const [draft, setDraft] = useState<ReminderDraftVersion | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recipientName, setRecipientName] = useState<string | null>(null)
  // 送信前に「今の送信先」を出す。遅い応答が別リマインダの送信先を出さないよう
  // 世代付きで読む（useReminderTestRecipient 内）。
  const testRecipient = useReminderTestRecipient(reminderId)

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
      if (!response.success) {
        // 送信先起因の失敗はパネル側の状態も最新へ揃える。
        if (response.code === 'TEST_RECIPIENT_NOT_CONFIGURED' || response.code === 'TEST_RECIPIENT_NOT_AVAILABLE') {
          void testRecipient.reload()
        }
        setError(response.error || 'テスト送信に失敗しました。LINE連携と通知内容を確認してください。')
        setConfirmOpen(false)
        return
      }
      setDraft((current) => current ? { ...current, lastTestStatus: 'succeeded', lastTestedAt: response.data.testedAt } : current)
      setRecipientName(response.data.recipientName)
      setConfirmOpen(false)
    } catch { setError('テスト送信に失敗しました。LINE連携と通知内容を確認してください。') } finally { setBusy(false) }
  }

  if (!draft) return <p className={error ? 'text-danger p-6 text-sm' : 'text-ink-faint p-6 text-sm'}>{error || '下書きを読み込んでいます'}</p>

  const testedAt = formatTestedAt(draft.lastTestedAt)
  const recipient = testRecipientLabel(testRecipient.view, recipientName)

  return <div data-design-node="W98zZQ" className="space-y-3">
    <ReminderWizard current={4} />
    <ReminderWorkspace aside={<div className="grid gap-3">
      <SummaryCard rows={[["本番への影響", 'なし'], ['送信数', '1通'], ['送信先', recipient], ['送信方法', 'LINE公式']]} />
      <LinePreview caption="テスト送信される1通目の内容">{firstReminderStepMessage(draft.settings) || '本文がありません'}</LinePreview>
      <div className="grid grid-cols-2 gap-2"><Button onClick={() => setConfirmOpen(true)}>テスト送信</Button></div>
    </div>}>
      <ReminderPanel title="テスト対象" note="自分のLINEへ確認用メッセージを送ります。"><dl className="grid min-h-24 grid-cols-2 gap-4 text-xs"><Metric label="送信先" value={recipient} /><Metric label="最終テスト日時" value={testedAt} /></dl><TestRecipientGuidance view={testRecipient.view} accountId={draft.settings.lineAccountId} onRecheck={() => void testRecipient.reload()} /></ReminderPanel>
      <ReminderPanel title="差し込み値の確認" note="本文に書いた差し込みだけを並べ、どこから取るかを確認します。">{reminderPlaceholders(draft.settings, recipientName).length === 0 ? <p className="text-ink-faint px-3 py-3 text-xs">本文に差し込み値はありません。</p> : <table className="w-full border-collapse text-left text-xs"><thead><TableHeadRow><Th>変数</Th><Th>テストで使う値</Th><Th>本番での取得元</Th></TableHeadRow></thead><tbody className="border-hairline border-t">{reminderPlaceholders(draft.settings, recipientName).map((placeholder) => <tr key={placeholder.token} className="border-hairline border-t"><td className="px-3 py-3"><code>{placeholder.token}</code></td><td className="px-3 py-3">{placeholder.testValue}</td><td className="px-3 py-3">{placeholder.source}</td></tr>)}</tbody></table>}</ReminderPanel>
      <ReminderPanel title="テスト送信の履歴" note="下書きに記録された直近のテストだけを表示します。" action={draft.lastTestStatus === 'succeeded' ? <Pill tone="success">直近のテストは成功</Pill> : undefined}><table className="w-full border-collapse text-left text-xs"><thead><TableHeadRow><Th>送信日時</Th><Th>送信した通知・宛先</Th><Th>結果</Th></TableHeadRow></thead><tbody className="border-hairline border-t"><tr><td className="px-3 py-3">{testedAt}</td><td className="px-3 py-3">下書きの通知 ／ {recipient}</td><td className="px-3 py-3"><Pill tone={draft.lastTestStatus === 'succeeded' ? 'success' : 'warning'}>{draft.lastTestStatus === 'succeeded' ? '送信できました' : '成功記録なし'}</Pill></td></tr></tbody></table></ReminderPanel>
      {error ? <p className="text-danger text-xs">{error}</p> : null}
    </ReminderWorkspace>
    <div className="mt-16"><ReminderFooter status={draft.lastTestStatus === 'succeeded' ? `テスト済み ${testedAt}` : '下書き保存'} secondary={{ label: 'テスト送信', onClick: () => setConfirmOpen(true) }} primary="最終確認へ" onPrimary={() => router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=confirm`)} /></div>
    <ConfirmDialog open={confirmOpen} title="テスト送信しますか？" description="自分のLINEへ確認用メッセージを1通送信します。" confirmLabel="テスト送信" cancelLabel="配信予定へ戻る" busy={busy} onConfirm={() => void sendTest()} onCancel={() => setConfirmOpen(false)} />
  </div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-ink-faint">{label}</dt><dd className="text-ink font-bold">{value}</dd></div>
}
