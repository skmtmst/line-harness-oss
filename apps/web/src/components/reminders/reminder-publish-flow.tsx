'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { describeReminderTiming } from '@line-crm/shared'
import type { ReminderDraftSettings, ReminderDraftVersion, ReminderPreviewResult, ReminderPublishResult, ReminderValidationResult } from '@line-crm/shared'
import { api } from '@/lib/api'
import { firstReminderStepMessage, reminderPlaceholders, reminderStepTimings, reminderStopSummary, reminderTriggerLabel } from './reminder-labels'
import { useReminderTestRecipient, type ReminderTestRecipientView } from './use-reminder-test-recipient'
import { useReminderTestSend } from './use-reminder-test-send'
import { TestRecipientGuidance, testRecipientDestinationLabel, testRecipientNote, testSendConfirmDescription, type ReminderTestRecipientKind } from './test-recipient-guidance'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
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
  /*
   * REMINDER-08: 予定・事前チェックの「読み込み中／失敗／正常0件」を分ける。
   * 失敗しても preview / validation が null のままだと、画面は永遠に
   * 「確認しています」を出し続ける。失敗は error 状態へ落とし、
   * 再試行の押し口を出す。
   */
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [validationState, setValidationState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [previewRetryToken, setPreviewRetryToken] = useState(0)
  const [validationRetryToken, setValidationRetryToken] = useState(0)
  const [published, setPublished] = useState<ReminderPublishResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testConfirm, setTestConfirm] = useState(false)
  // 送信先はテスト段だけ読む。ほかの段で余計なGETを打たない。
  const testRecipient = useReminderTestRecipient(stage === 'test' ? reminderId : null)
  // 送信状態・冪等キー・遅い応答の破棄は1か所で持つ（DEEP-09/10/11）。
  const testSend = useReminderTestSend(stage === 'test' ? reminderId : null)
  // 読み込み応答は順不同で返る。世代番号で最新の要求だけを状態へ反映する。
  const requestSeq = useRef(0)

  const go = useCallback((next: ReminderPublishStage) => router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=${next}`), [reminderId, router])
  const loadDraft = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true); setError('')
    try {
      const response = await api.reminders.getDraft(reminderId)
      if (seq !== requestSeq.current) return
      if (!response.success) throw new Error(response.error)
      setDraft(response.data); setSettings(response.data.settings)
    } catch { if (seq === requestSeq.current) setError('下書きを読み込めませんでした。') } finally { if (seq === requestSeq.current) setLoading(false) }
  }, [reminderId])

  useEffect(() => {
    // 対象が変わったら前の対象の本文・検査結果・送信結果を持ち越さない。
    setDraft(null); setSettings(null); setPreview(null); setValidation(null); setPublished(null); setTestConfirm(false)
    setPreviewState('idle'); setValidationState('idle'); setPreviewRetryToken(0); setValidationRetryToken(0)
    void loadDraft()
  }, [loadDraft])
  useEffect(() => {
    if (!settings || (stage !== 'preview' && stage !== 'done')) return
    let active = true
    setPreviewState('loading')
    void api.reminders.previewDraft(reminderId).then((response) => {
      if (!active) return
      if (response.success) { setPreview(response.data); setPreviewState('ready') }
      else { setPreviewState('error'); setError(response.error) }
    }).catch(() => { if (active) { setPreviewState('error'); setError('配信予定を確認できませんでした。') } })
    return () => { active = false }
  }, [reminderId, settings, stage, previewRetryToken])
  useEffect(() => {
    if (!settings || (stage !== 'target' && stage !== 'confirm' && stage !== 'done')) return
    let active = true
    setValidationState('loading')
    void api.reminders.validateDraft(reminderId).then((response) => {
      if (!active) return
      if (response.success) { setValidation(response.data); setValidationState('ready') }
      else { setValidationState('error'); setError(response.error) }
    }).catch(() => { if (active) { setValidationState('error'); setError('有効化前チェックを実行できませんでした。') } })
    return () => { active = false }
  }, [reminderId, settings, stage, validationRetryToken])
  const retryPreview = useCallback(() => setPreviewRetryToken((value) => value + 1), [])
  const retryValidation = useCallback(() => setValidationRetryToken((value) => value + 1), [])

  async function saveTarget() {
    if (!settings) return
    setBusy(true)
    try {
      const response = await api.reminders.saveDraft(reminderId, settings)
      if (!response.success) throw new Error(response.error)
      setDraft(response.data); setSettings(response.data.settings)
      /*
       * REMINDER-09: 通常導線は 対象 → 通知ステップ → 送信設定（配信予定）。
       * 通知編集（STEP 3）を飛ばして配信予定へ進むと、操作していない工程が
       * ウィザードで完了済みに見える。保存後は必ず通知編集へ戻す。
       */
      router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}`)
    }
    catch { setError('対象と終了条件を保存できませんでした。') } finally { setBusy(false) }
  }
  async function sendTest() {
    const outcome = await testSend.send()
    if (outcome.kind === 'succeeded') {
      setDraft((current) => current ? { ...current, lastTestStatus: 'succeeded', lastTestedAt: outcome.testedAt } : current)
      setTestConfirm(false)
      return
    }
    if (outcome.kind === 'failed' && outcome.recipientFault) {
      // 送信先起因の失敗はパネル側の状態も最新へ揃え、窓を閉じて設定導線へ出す。
      void testRecipient.reload()
      setTestConfirm(false)
    }
    // 確定失敗・結果不明は窓を開いたままにし、エラーは窓の中に出す。
  }
  async function publishDraft() {
    if (!validation?.valid || draft?.lastTestStatus !== 'succeeded') return
    setBusy(true)
    try { const response = await api.reminders.publishDraft(reminderId); if (!response.success) throw new Error(response.error); setPublished(response.data); go('done') }
    catch { setError('リマインダを有効化できませんでした。') } finally { setBusy(false) }
  }

  // 画面に出ている本文の版と送信先の対象が一致しているときだけ送れる。
  // 切替え直後に前の対象の下書きが残っている間は読み込み中として扱う。
  const subjectDraft = draft && draft.reminderId === reminderId ? draft : null
  const subjectSettings = subjectDraft ? settings : null

  if (loading) return <ListState kind="loading" title="下書きを読み込んでいます" />
  if (!subjectDraft || !subjectSettings) {
    return error
      ? <ListState kind="error" title="下書きを表示できませんでした" description={error} action={<Button onClick={() => void loadDraft()}>再読み込み</Button>} />
      : <ListState kind="loading" title="下書きを読み込んでいます" />
  }

  // 送信の失敗・結果不明は一つの状態で持つ。窓が開いている間は窓の中に出し、
  // 閉じているときだけページの帯に出す。成功・新しい試行の開始で消える。
  const testIssue = testSend.phase.kind === 'failed' || testSend.phase.kind === 'unknown' ? testSend.phase.message : ''
  const sendBusy = testSend.phase.kind === 'sending'

  const current = stage === 'target' ? 2 : stage === 'done' ? 6 : stage === 'confirm' ? 5 : 4
  return (
    <div data-reminder-publish-stage={stage}>
      <ReminderWizard current={current} />
      {(error || (!testConfirm && testIssue)) ? <Notice tone="danger" className="mb-3">{error || testIssue}</Notice> : null}
      {stage === 'target' ? <TargetStage settings={subjectSettings} validation={validation} validationFailed={validationState === 'error'} onRetryValidation={retryValidation} onChange={setSettings} onNext={() => void saveTarget()} busy={busy} /> : null}
      {stage === 'preview' ? <PreviewStage settings={subjectSettings} preview={preview} previewFailed={previewState === 'error'} onRetryPreview={retryPreview} editHref={`/reminders/edit?id=${encodeURIComponent(reminderId)}`} onNext={() => go('test')} /> : null}
      {stage === 'test' ? <TestStage draft={subjectDraft} recipientName={testSend.phase.kind === 'succeeded' ? testSend.phase.recipientName : null} recipientKind={testSend.phase.kind === 'succeeded' ? testSend.phase.recipientKind : null} recipientView={testRecipient.view} onRecipientRecheck={() => void testRecipient.reload()} onConfirm={() => { testSend.beginAttempt(); setTestConfirm(true) }} onNext={() => go('confirm')} /> : null}
      {stage === 'confirm' ? <ConfirmStage draft={subjectDraft} settings={subjectSettings} validation={validation} validationFailed={validationState === 'error'} onRetryValidation={retryValidation} onPublish={() => void publishDraft()} busy={busy} /> : null}
      {stage === 'done' ? <DoneStage draft={subjectDraft} published={published} preview={preview} validation={validation} /> : null}
      <ConfirmDialog open={testConfirm && stage === 'test'} title="テスト送信しますか？" description={testSend.phase.kind === 'unknown' ? '前回の送信結果を確認できていません。再試行しても二重には送られません。' : testSendConfirmDescription(testRecipient.view, testSend.phase.kind === 'succeeded' ? testSend.phase.recipientName : null, testSend.phase.kind === 'succeeded' ? testSend.phase.recipientKind : null)} confirmLabel={testIssue ? 'もう一度送信' : 'テスト送信'} cancelLabel="配信予定へ戻る" busy={sendBusy} error={testIssue} onConfirm={() => void sendTest()} onCancel={() => setTestConfirm(false)} />
    </div>
  )
}

export function TargetStage({ settings, validation, validationFailed = false, onRetryValidation, onChange, onNext, busy }: { settings: ReminderDraftSettings; validation: ReminderValidationResult | null; validationFailed?: boolean; onRetryValidation?: () => void; onChange: (value: ReminderDraftSettings) => void; onNext: () => void; busy: boolean }) {
  const stop = settings.stopConditions
  const audience = reminderAudienceCounts(validation)
  const stopCount = Object.values(stop).filter((value) => value === true || typeof value === 'number').length
  return <div data-design-node="s7T2dz"><ReminderWorkspace aside={<><SummaryCard rows={[["基準日", '予約日時（Google Meet相談）'], ['対象者', countLabel(audience.matched, '人')], ['通知ステップ', `${settings.steps.length}件`], ['停止条件', `${stopCount}件`]]} /><ReminderPanel title="安全な運用" note="誤送信を防ぐための設定です。"><ul className="text-ink-secondary space-y-2 text-xs"><li>● 基準日が空欄なら開始しない</li><li>● 過去日時の通知は送らない</li><li>● 同じ時刻の重複送信をまとめる</li></ul></ReminderPanel></>}>
    <ReminderPanel title="対象者の条件" note="どの友だちにリマインダを開始するか設定します。"><div className="rounded-lg border border-hairline p-3 text-xs"><b>下書きに保存した対象条件</b><div className="mt-3 grid grid-cols-3 gap-2"><Metric label="条件一致" value={countLabel(audience.total, '人')} /><Metric label="開始予定" value={countLabel(audience.matched, '人')} success /><Metric label="除外" value={countLabel(audience.excluded, '人')} warning /></div>{validation
      ? <p className="text-info mt-3">公開前チェックの最新結果です。基準日が登録・変更された時点で対象を自動再判定します。</p>
      : validationFailed
        ? <p className="text-danger mt-3">公開前チェックを実行できませんでした。人数は未取得のままです。<button type="button" className="ml-2 underline" onClick={onRetryValidation}>再読み込み</button></p>
        : <p className="text-info mt-3">公開前チェックを実行しています。基準日が登録・変更された時点で対象を自動再判定します。</p>}</div></ReminderPanel>
    <ReminderPanel title="終了・停止条件" note="不要になった通知を自動で止めます。"><div className="divide-y divide-hairline">{[["bookingCancelled",'予約がキャンセルされた','即時停止'],['supportMarkCompleted','対応マークが「完了」になった','残りを停止'],['daysAfterTarget','基準日を過ぎて7日経過','自動終了'],['friendBlocked','友だちがブロックした','即時停止']].map(([key,label,result]) => <label key={key} className="flex items-center gap-3 py-3 text-xs"><input type="checkbox" checked={key === 'daysAfterTarget' ? stop.daysAfterTarget != null : Boolean(stop[key as keyof typeof stop])} onChange={(event) => onChange({ ...settings, stopConditions: { ...stop, [key]: key === 'daysAfterTarget' ? event.target.checked ? 7 : null : event.target.checked } })} /><span className="flex-1 font-medium">{label}</span><Pill tone="success">{result}</Pill></label>)}</div></ReminderPanel>
    {/* REMINDER-09: 次は通知ステップ（STEP 3）。配信予定は通知を保存してから。 */}
    <ReminderFooter primary={busy ? '保存中…' : '通知ステップへ'} primaryDisabled={busy} onPrimary={onNext} />
  </ReminderWorkspace></div>
}

export function PreviewStage({ settings, preview, previewFailed = false, onRetryPreview, editHref, onNext }: { settings: ReminderDraftSettings; preview: ReminderPreviewResult | null; previewFailed?: boolean; onRetryPreview?: () => void; editHref?: string; onNext: () => void }) {
  const [range, setRange] = useState<'7d' | '30d' | 'conflict'>('7d')
  const items = preview?.items ?? []
  const duplicateGroups = new Map<string, number>()
  for (const item of items) duplicateGroups.set(item.scheduledAt, (duplicateGroups.get(item.scheduledAt) ?? 0) + 1)
  const now = Date.now()
  const rows = items.filter((item) => {
    if (range === 'conflict') return (duplicateGroups.get(item.scheduledAt) ?? 0) > 1
    const at = Date.parse(item.scheduledAt)
    return at > now && at <= now + (range === '7d' ? 7 : 30) * 86_400_000
  })
  const nextItem = items.find((item) => item.state === 'scheduled') ?? null
  const firstDuplicate = items.find((item) => (duplicateGroups.get(item.scheduledAt) ?? 0) > 1) ?? null
  return <div data-design-node="JCz6J"><ReminderWorkspace aside={<><SummaryCard title="予定数" rows={[["対象者", preview ? countLabel(preview.summary.audience,'人') : '—人'], ['今後7日', preview ? countLabel(preview.summary.next7Days,'通') : '—通'], ['今後30日', preview ? countLabel(preview.summary.next30Days,'通') : '—通'], ['重複調整', preview ? countLabel(preview.summary.duplicateCount,'通') : '—通']]} /><LinePreview caption={previewFailed ? '配信予定を確認できませんでした' : nextItem ? `次は ${formatDateTime(nextItem.scheduledAt)} に届きます` : '送信予定はまだありません'} empty={!nextItem}>{nextItem ? firstReminderStepMessage(settings, nextItem.stableStepId) : previewFailed ? '再読み込みすると予定を確認できます。' : '未来の送信予定ができると、ここに最初の通の本文を表示します。'}</LinePreview></>}>
    <ReminderPanel title="配信予定プレビュー" note={preview ? `基準日を ${formatDate(preview.targetDate)} とした場合の送信予定です。` : previewFailed ? '配信予定を確認できませんでした。' : '配信予定を確認しています。'}><div className="mb-3 flex gap-2"><Button variant={range === '7d' ? 'primary' : 'secondary'} onClick={() => setRange('7d')}>今後7日</Button><Button variant={range === '30d' ? 'primary' : 'secondary'} onClick={() => setRange('30d')}>今後30日</Button><Button variant={range === 'conflict' ? 'primary' : 'secondary'} onClick={() => setRange('conflict')}>競合のみ</Button></div>{settings.steps.length === 0 ? <ListState kind="empty" title="送る通知がまだありません" description="通知ステップで本文を作成してから、配信予定を確認してください。" action={editHref ? <Button href={editHref}>通知ステップへ</Button> : undefined} /> : !preview ? (previewFailed ? <ListState kind="error" title="配信予定を確認できませんでした" description="通信または権限を確認して、もう一度お試しください。" onRetry={onRetryPreview} /> : <ListState kind="loading" title="配信予定を確認しています" />) : rows.length === 0 ? <ListState kind="empty" title="条件に合う送信予定はありません" /> : <div className="overflow-hidden rounded-lg border border-hairline"><table className="w-full text-left text-xs"><thead className="bg-canvas-sunken"><TableHeadRow><Th>送信日時</Th><Th>通知</Th><Th>対象</Th><Th>状態</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{rows.map((item) => <tr key={item.stableStepId}><td className="p-2">{formatDateTime(item.scheduledAt)}</td><td><b>{item.label}</b><small className="block text-ink-faint">{settings.name} ／ {item.stepNumber}通目</small></td><td>{countLabel(preview.summary.audience, '人')}</td><td>{item.state === 'duplicate' ? <Pill tone="warning">{`同時刻に${duplicateGroups.get(item.scheduledAt) ?? 0}件`}</Pill> : item.state === 'past' ? <Pill tone="warning">過去の日時</Pill> : <Pill tone="success">予定どおり</Pill>}</td></tr>)}</tbody></table></div>}</ReminderPanel>
    <ReminderPanel title="重複・時間帯の確認" note="送信前に問題になりそうな予定を自動検知します。">{!preview ? (previewFailed ? <ListState kind="error" title="重複を確認できませんでした" onRetry={onRetryPreview} /> : <ListState kind="loading" title="重複を確認しています" />) : preview.summary.duplicateCount > 0 && firstDuplicate ? <Notice tone="warn"><b>{`${formatDateTime(firstDuplicate.scheduledAt)}に${duplicateGroups.get(firstDuplicate.scheduledAt) ?? 0}件の通知が重複`}</b><p>同じ友だちへの同時刻通知を1通にまとめます。</p></Notice> : <p className="text-ink-faint text-xs">重複している送信予定はありません。</p>}<dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><Metric label="基準日" value={preview ? formatDate(preview.targetDate) : previewFailed ? '未取得' : '確認中'} /><Metric label="重複予定" value={preview ? `${preview.summary.duplicateCount.toLocaleString('ja-JP')}件` : previewFailed ? '未取得' : '確認中'} /><Metric label="通知ステップ" value={`${settings.steps.length}件`} /></dl></ReminderPanel>
    {/* REMINDER-08/09: 取得失敗は再試行を出し、通知0件ではテスト送信へ進ませない。 */}
    <ReminderFooter secondary={settings.steps.length === 0 && editHref ? { label: '通知ステップへ戻る', href: editHref } : undefined} primary="テスト送信へ" primaryDisabled={settings.steps.length === 0} onPrimary={onNext} />
  </ReminderWorkspace></div>
}

export function TestStage({ draft, recipientName, recipientKind = null, recipientView, onRecipientRecheck, onConfirm, onNext }: { draft: ReminderDraftVersion; recipientName: string | null; recipientKind?: ReminderTestRecipientKind | null; recipientView: ReminderTestRecipientView; onRecipientRecheck: () => void; onConfirm: () => void; onNext: () => void }) {
  const testedAt = formatDateTime(draft.lastTestedAt)
  // REMINDER-12: 届け先は「自分のLINE」と「登録済みテスト宛先」を区別して出す。
  const destination = testRecipientDestinationLabel(recipientView, recipientName, recipientKind)
  return <div data-design-node="W98zZQ"><ReminderWorkspace aside={<><SummaryCard rows={[["本番への影響", 'なし'], ['送信数', '1通'], ['送信先', destination], ['送信方法', 'LINE公式']]} /><LinePreview caption="テスト送信される1通目の内容">{firstReminderStepMessage(draft.settings) || '本文がありません'}</LinePreview></>}>
    <ReminderPanel title="テスト対象" note={testRecipientNote(recipientView, recipientKind)}><dl className="grid grid-cols-2 gap-3 text-xs"><Metric label="送信先" value={destination} /><Metric label="最終テスト日時" value={testedAt} /></dl><TestRecipientGuidance view={recipientView} accountId={draft.settings.lineAccountId} onRecheck={onRecipientRecheck} /></ReminderPanel>
    <ReminderPanel title="差し込み値の確認" note="本文に書いた差し込みだけを並べ、どこから取るかを確認します。">{reminderPlaceholders(draft.settings, recipientName).length === 0 ? <p className="text-ink-faint text-xs">本文に差し込み値はありません。</p> : <table className="w-full text-left text-xs"><thead><TableHeadRow><Th>変数</Th><Th>テストで使う値</Th><Th>本番での取得元</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{reminderPlaceholders(draft.settings, recipientName).map((placeholder) => <tr key={placeholder.token}><td className="py-2"><code>{placeholder.token}</code></td><td>{placeholder.testValue}</td><td>{placeholder.source}</td></tr>)}</tbody></table>}</ReminderPanel>
    <ReminderPanel title="テスト送信の履歴" note="下書きに記録された直近のテストだけを表示します。" action={draft.lastTestStatus === 'succeeded' ? <Pill tone="success">直近のテストは成功</Pill> : undefined}><table className="w-full text-left text-xs"><thead><TableHeadRow><Th>送信日時</Th><Th>送信した通知・宛先</Th><Th>結果</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline"><tr><td className="py-2">{testedAt}</td><td>下書きの通知 ／ {destination}</td><td><Pill tone={draft.lastTestStatus === 'succeeded' ? 'success' : 'warning'}>{draft.lastTestStatus === 'succeeded' ? '送信できました' : '成功記録なし'}</Pill></td></tr></tbody></table></ReminderPanel>
    <ReminderFooter status={draft.lastTestStatus === 'succeeded' ? `テスト済み ${formatDateTime(draft.lastTestedAt)}` : '下書き保存'} secondary={{ label: 'テスト送信', onClick: onConfirm }} primary="最終確認へ" primaryDisabled={draft.lastTestStatus !== 'succeeded'} onPrimary={onNext} />
  </ReminderWorkspace></div>
}

export function ConfirmStage({ draft, settings, validation, validationFailed = false, onRetryValidation, onPublish, busy }: { draft: ReminderDraftVersion; settings: ReminderDraftSettings; validation: ReminderValidationResult | null; validationFailed?: boolean; onRetryValidation?: () => void; onPublish: () => void; busy: boolean }) {
  const firstStep = settings.steps[0] ?? null
  const plannedDeliveries = validation?.audience.matched == null ? null : validation.audience.matched * settings.steps.length
  return <div data-design-node="s6Vvp"><ReminderWorkspace aside={<><LinePreview caption={firstStep ? `1通目は ${describeReminderTiming(firstStep, settings.deliveryMode)}に届きます` : '通知ステップがありません'} empty={!firstStep}>{firstStep ? firstStep.messageContent : 'ステップを追加すると、ここに本文を表示します。'}</LinePreview><SummaryCard title="有効化する内容" rows={[["状態", '有効化前'], ['対象者', validation ? countLabel(validation.audience.matched,'人') : '—人'], ['除外', validation ? countLabel(validation.audience.excluded,'人') : '—人'], ['予定通知', countLabel(plannedDeliveries,'通')], ['停止条件', reminderStopSummary(settings.stopConditions)]]} /></>}>
    <ReminderPanel title="有効化前チェック">{!validation ? (validationFailed ? <ListState kind="error" title="有効化前チェックを実行できませんでした" description="チェックが通るまで公開できません。通信を確認して、もう一度お試しください。" onRetry={onRetryValidation} /> : <ListState kind="loading" title="有効化前チェックを実行しています" />) : <ul className="space-y-2 text-xs">{validation.checks.map((check) => <li key={check.key} className="flex items-center gap-2"><Pill tone={check.status === 'passed' ? 'success' : check.status === 'warning' ? 'warning' : 'danger'}>{check.status === 'passed' ? '✓' : '!'}</Pill>{check.label}</li>)}</ul>}</ReminderPanel>
    <ReminderPanel title="最終確認" note="有効化すると、基準日の登録・変更に応じて自動で通知が始まります。"><dl className="divide-y divide-hairline text-xs"><Metric label="管理名" value={settings.name} /><Metric label="基準日" value={reminderTriggerLabel(settings.triggerType)} /><Metric label="対象" value={validation ? countLabel(validation.audience.matched,'人') : '—人'} /><Metric label="通知ステップ" value={reminderStepTimings(settings)} /><Metric label="停止条件" value={reminderStopSummary(settings.stopConditions)} /></dl><Notice tone="warn" className="mt-3">有効化後は対象者ごとに予定が作成されます。いつでも一時停止できます。</Notice></ReminderPanel>
    <ReminderFooter secondary={{ label: '戻って修正', href: `/reminders/edit?id=${draft.reminderId}` }} primary={busy ? '有効化中…' : 'この内容で公開'} primaryDisabled={busy || !validation?.valid || draft.lastTestStatus !== 'succeeded'} onPrimary={onPublish} />
  </ReminderWorkspace></div>
}

export function DoneStage({ draft, published, preview, validation }: { draft: ReminderDraftVersion; published: ReminderPublishResult | null; preview: ReminderPreviewResult | null; validation: ReminderValidationResult | null }) {
  const nextScheduledAt = published?.nextScheduledAt ?? preview?.items.find((item) => item.state === 'scheduled')?.scheduledAt ?? null
  return <div data-design-node="PSmHo"><ReminderWorkspace fill aside={<><ReminderPanel title="次にできること" note="稼働中でも安全に管理できます。"><ul className="space-y-2 text-xs"><li>リマインダを一時停止</li><li>内容を編集する</li><li>対象者を確認する</li><li>リマインダを複製して作成</li></ul></ReminderPanel><ReminderPanel title="実行状況の確認" note="詳細画面でいつでも確認できます。"><ul className="space-y-2 text-xs"><li>● 送信の成功・失敗</li><li>● 次回の送信予定</li><li>● 停止した配信</li></ul></ReminderPanel><LinePreview caption={nextScheduledAt ? `最初の通知は ${formatDateTime(nextScheduledAt)}` : '次の送信予定はまだありません'} empty={!nextScheduledAt}>{nextScheduledAt ? firstReminderStepMessage(draft.settings) : '基準日が登録されると、ここに最初の通の本文を表示します。'}</LinePreview></>}>
    <section className="bg-canvas rounded-card border-hairline border p-6 shadow-sm">
      <div className="text-center"><span className="bg-success-bg text-success mx-auto grid h-10 w-10 place-items-center rounded-full text-xl">✓</span><h2 className="text-ink mt-3 text-base font-bold">リマインダを有効化しました</h2><p className="text-ink-faint mt-1 text-xs">基準日の登録・変更に合わせて、対象者ごとの通知予定を自動作成します。</p></div>
      <dl className="mx-auto mt-5 max-w-xl divide-y divide-hairline text-xs"><Metric label="管理名" value={draft.settings.name} /><Metric label="対象" value={countLabel(published?.audience ?? validation?.audience.matched ?? null,'人')} /><Metric label="通知ステップ" value={reminderStepTimings(draft.settings)} /><Metric label="次回送信" value={nextScheduledAt ? formatDateTime(nextScheduledAt) : '予定なし'} /><Metric label="状態" value="稼働中" /></dl>
      <Notice tone="info" className="mx-auto mt-4 max-w-xl">送信の状況と今後の予定は詳細画面でいつでも確認できます。</Notice><div className="mt-5 flex justify-center gap-2"><Button href="/reminders">一覧へ戻る</Button><Button variant="primary" href={`/reminders/detail?id=${draft.reminderId}`}>通知予定を確認</Button></div>
    </section>
  </ReminderWorkspace></div>
}

function Metric({ label, value, success = false, warning = false }: { label: string; value: string; success?: boolean; warning?: boolean }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-ink-faint">{label}</dt><dd className={success ? 'text-success font-bold' : warning ? 'text-warning font-bold' : 'text-ink font-bold'}>{value}</dd></div>
}
