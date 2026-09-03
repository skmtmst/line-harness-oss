'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  ReminderDraftSettings,
  ReminderDraftVersion,
  ReminderPreviewResult,
  ReminderPublishResult,
  ReminderValidationResult,
  Tag,
} from '@line-crm/shared'
import { describeReminderTiming } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import { ChoiceCard } from '@/components/shared/create-page'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { TextInput } from '@/components/shared/form-controls'
import styles from './reminder-publish-flow.module.css'

export type ReminderPublishStage = 'target' | 'preview' | 'test' | 'confirm' | 'done'

const STAGES: Array<{ key: ReminderPublishStage; label: string }> = [
  { key: 'target', label: '対象と停止条件' },
  { key: 'preview', label: '届く予定' },
  { key: 'test', label: 'テスト送信' },
  { key: 'confirm', label: '最終確認' },
  { key: 'done', label: '公開完了' },
]

function safeError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback
  if (error.status === 403) return 'このリマインダを変更する権限がありません。'
  if (error.status === 404) return 'リマインダの下書きが見つかりません。'
  if (error.status === 405) return 'この環境ではこの操作を実行できません。'
  if (error.status === 409) return '別の変更が先に入っています。状態を読み直してください。'
  if (error.status === 422) return '入力内容を確認してください。'
  return fallback
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function countLabel(value: number | null, unit: string): string {
  return value == null ? `—${unit}` : `${value.toLocaleString('ja-JP')}${unit}`
}

export default function ReminderPublishFlow({
  reminderId,
  stage,
}: {
  reminderId: string
  stage: ReminderPublishStage
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<ReminderDraftVersion | null>(null)
  const [settings, setSettings] = useState<ReminderDraftSettings | null>(null)
  const [preview, setPreview] = useState<ReminderPreviewResult | null>(null)
  const [validation, setValidation] = useState<ReminderValidationResult | null>(null)
  const [published, setPublished] = useState<ReminderPublishResult | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const go = useCallback((next: ReminderPublishStage) => {
    router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}&stage=${next}`)
  }, [reminderId, router])

  const loadDraft = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.reminders.getDraft(reminderId)
      if (!response.success) throw new Error(response.error)
      setDraft(response.data)
      setSettings(response.data.settings)
    } catch (loadError) {
      setError(safeError(loadError, '下書きを読み込めませんでした。'))
    } finally {
      setLoading(false)
    }
  }, [reminderId])

  useEffect(() => {
    void loadDraft()
    void api.tags.list().then((response) => {
      if (response.success) setTags(response.data)
    }).catch(() => setTags([]))
  }, [loadDraft])

  useEffect(() => {
    if (!settings || stage !== 'preview') return
    let active = true
    setPreview(null)
    setError('')
    void api.reminders.previewDraft(reminderId)
      .then((response) => {
        if (!active) return
        if (!response.success) throw new Error(response.error)
        setPreview(response.data)
      })
      .catch((previewError) => {
        if (active) setError(safeError(previewError, '届く予定を確認できませんでした。'))
      })
    return () => {
      active = false
    }
  }, [reminderId, settings, stage])

  useEffect(() => {
    if (!settings || stage !== 'confirm') return
    let active = true
    setValidation(null)
    setError('')
    void api.reminders.validateDraft(reminderId)
      .then((response) => {
        if (!active) return
        if (!response.success) throw new Error(response.error)
        setValidation(response.data)
      })
      .catch((validationError) => {
        if (active) setError(safeError(validationError, '公開前チェックを実行できませんでした。'))
      })
    return () => {
      active = false
    }
  }, [reminderId, settings, stage])

  const stageIndex = STAGES.findIndex((item) => item.key === stage)
  async function saveTargetAndContinue() {
    if (!settings) return
    setBusy(true)
    setError('')
    try {
      const response = await api.reminders.saveDraft(reminderId, settings)
      if (!response.success) throw new Error(response.error)
      setDraft(response.data)
      setSettings(response.data.settings)
      go('preview')
    } catch (saveError) {
      setError(safeError(saveError, '対象と停止条件を保存できませんでした。'))
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await api.reminders.testDraft(reminderId, crypto.randomUUID())
      if (!response.success) throw new Error(response.error)
      setDraft((current) => current ? {
        ...current,
        lastTestStatus: 'succeeded',
        lastTestedAt: response.data.testedAt,
      } : current)
      setNotice('テスト送信が届きました。本番公開の前に内容を確認してください。')
    } catch (testError) {
      setDraft((current) => current ? { ...current, lastTestStatus: 'failed' } : current)
      setError(safeError(testError, 'テスト送信に失敗しました。LINE連携と送る内容を確認してください。'))
    } finally {
      setBusy(false)
    }
  }

  async function publishDraft() {
    if (!validation?.valid || draft?.lastTestStatus !== 'succeeded') return
    setBusy(true)
    setError('')
    try {
      const response = await api.reminders.publishDraft(reminderId)
      if (!response.success) throw new Error(response.error)
      setPublished(response.data)
      go('done')
    } catch (publishError) {
      setError(safeError(publishError, '公開できませんでした。公開前チェックをやり直してください。'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <ListState kind="loading" title="下書きを読み込んでいます" />
  }
  if (!settings || !draft) {
    return (
      <ListState
        kind="error"
        title="下書きを表示できませんでした"
        description={error || '状態を読み直してください。'}
        action={<Button onClick={() => void loadDraft()}>再読み込み</Button>}
      />
    )
  }

  return (
    <div className="min-w-0 space-y-4" data-reminder-publish-stage={stage}>
      <ol className="border-hairline bg-canvas flex min-w-0 overflow-hidden rounded-lg border" aria-label="公開までの手順">
        {STAGES.map((item, index) => (
          <li
            key={item.key}
            className={`min-w-0 flex-1 px-3 py-2 text-center text-xs font-medium ${
              index === stageIndex ? 'bg-accent-soft text-accent' : index < stageIndex ? 'text-success' : 'text-ink-faint'
            }`}
            aria-current={index === stageIndex ? 'step' : undefined}
          >
            {index + 1}. {item.label}
          </li>
        ))}
      </ol>

      {error ? <Notice tone="error" message={error} onClose={() => setError('')} /> : null}
      {notice ? <Notice tone="success" message={notice} onClose={() => setNotice('')} /> : null}

      {stage === 'target' ? (
        <TargetStage settings={settings} tags={tags} onChange={setSettings} />
      ) : null}
      {stage === 'preview' ? (
        <PreviewStage preview={preview} settings={settings} />
      ) : null}
      {stage === 'test' ? (
        <TestStage draft={draft} settings={settings} onTest={() => void sendTest()} busy={busy} />
      ) : null}
      {stage === 'confirm' ? (
        <ConfirmStage draft={draft} settings={settings} validation={validation} />
      ) : null}
      {stage === 'done' ? (
        <DoneStage draft={draft} published={published} />
      ) : null}

      {stage === 'target' ? (
        <StickyBar
          status={`下書き v${draft.versionNumber}`}
          actions={(
            <>
              <Button href="/reminders">やめる</Button>
              <Button variant="primary" disabled={busy} onClick={() => void saveTargetAndContinue()}>
                {busy ? '保存中…' : '保存して届く予定へ'}
              </Button>
            </>
          )}
        />
      ) : null}
      {stage === 'preview' ? (
        <StickyBar
          status={preview ? `基準日 ${formatDateTime(preview.targetDate)}` : '届く予定を確認中'}
          actions={(
            <>
              <Button onClick={() => go('target')}>戻る</Button>
              <Button variant="primary" disabled={!preview} onClick={() => go('test')}>テスト送信へ</Button>
            </>
          )}
        />
      ) : null}
      {stage === 'test' ? (
        <StickyBar
          status={draft.lastTestStatus === 'succeeded' ? `テスト済み ${formatDateTime(draft.lastTestedAt)}` : 'テスト送信が必要です'}
          actions={(
            <>
              <Button onClick={() => go('preview')}>戻る</Button>
              <Button
                variant="primary"
                disabled={draft.lastTestStatus !== 'succeeded'}
                onClick={() => go('confirm')}
              >
                最終確認へ
              </Button>
            </>
          )}
        />
      ) : null}
      {stage === 'confirm' ? (
        <StickyBar
          status={validation?.valid ? '公開できます' : '確認が必要な項目があります'}
          actions={(
            <>
              <Button onClick={() => go('test')}>戻る</Button>
              <Button
                variant="primary"
                disabled={busy || !validation?.valid || draft.lastTestStatus !== 'succeeded'}
                onClick={() => void publishDraft()}
              >
                {busy ? '公開中…' : 'この内容で公開'}
              </Button>
            </>
          )}
        />
      ) : null}
    </div>
  )
}

function TargetStage({
  settings,
  tags,
  onChange,
}: {
  settings: ReminderDraftSettings
  tags: Tag[]
  onChange: (settings: ReminderDraftSettings) => void
}) {
  const stop = settings.stopConditions
  return (
    <div className={styles.columns} data-design-node="s7T2dz">
      <Card padding="roomy" className="min-w-0 space-y-6">
        <div>
          <h2 className="text-ink text-base font-semibold">誰を対象にするか</h2>
          <p className="text-ink-faint mt-1 text-xs">起点となる予約・申込に加えて、タグで絞り込めます。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            selected={!settings.targetTagId}
            title="対象になった友だち全員"
            note="予約・申込をした本人に送ります。"
            onClick={() => onChange({ ...settings, targetTagId: null })}
          />
          <ChoiceCard
            selected={Boolean(settings.targetTagId)}
            title="タグでさらに絞り込む"
            note="タグを選ぶまで公開前チェックは通りません。"
            onClick={() => onChange({ ...settings, targetTagId: settings.targetTagId ?? tags[0]?.id ?? null })}
          />
        </div>
        {settings.targetTagId ? (
          <Select
            aria-label="対象のタグ"
            label="対象のタグ"
            size="full"
            value={settings.targetTagId}
            onChange={(value) => onChange({ ...settings, targetTagId: value || null })}
            options={tags.length === 0
              ? [{ value: settings.targetTagId, label: 'タグを読み込めませんでした', disabled: true }]
              : tags.map((tag) => ({ value: tag.id, label: tag.name }))}
          />
        ) : null}

        <div className="border-hairline border-t pt-5">
          <h2 className="text-ink text-base font-semibold">途中で止める条件</h2>
          <p className="text-ink-faint mt-1 text-xs">条件に当てはまった時点で、残りの配信予定を取り消します。</p>
          <div className="mt-4 space-y-3">
            <StopToggle
              checked={stop.bookingCancelled}
              label="予約・イベントがキャンセルされた"
              note="取り消された予約について、その後のLINEを送りません。"
              onChange={(checked) => onChange({ ...settings, stopConditions: { ...stop, bookingCancelled: checked } })}
            />
            <StopToggle
              checked={stop.supportMarkCompleted}
              label="対応マークが完了になった"
              note="対応済み・解決済みになった友だちへの残りのLINEを止めます。"
              onChange={(checked) => onChange({ ...settings, stopConditions: { ...stop, supportMarkCompleted: checked } })}
            />
            <StopToggle
              checked={stop.friendBlocked}
              label="ブロック・友だち解除になった"
              note="送れない状態を繰り返し試さず、登録を止めます。"
              onChange={(checked) => onChange({ ...settings, stopConditions: { ...stop, friendBlocked: checked } })}
            />
            <label className="border-hairline flex items-center justify-between gap-4 rounded-lg border p-3">
              <span>
                <span className="text-ink block text-sm font-medium">基準日から一定日数を過ぎた</span>
                <span className="text-ink-faint block text-xs">古くなった案内をあとから送らないための上限です。</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <TextInput
                  type="number"
                  min={0}
                  max={365}
                  value={stop.daysAfterTarget ?? ''}
                  onChange={(event) => onChange({
                    ...settings,
                    stopConditions: {
                      ...stop,
                      daysAfterTarget: event.target.value === '' ? null : Number(event.target.value),
                    },
                  })}
                  className="w-20"
                />
                <span className="text-ink-faint text-xs">日後</span>
              </span>
            </label>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card padding="default">
          <CardHeader title="この設定で送る相手" />
          <dl className="space-y-3 p-4 text-sm">
            <SummaryRow label="対象" value={settings.targetTagId ? '指定したタグを持つ友だち' : '対象になった友だち全員'} />
            <SummaryRow label="公開前の人数" value="次の画面で実値を確認" />
          </dl>
        </Card>
        <Card padding="default">
          <CardHeader title="止めた記録" />
          <p className="text-ink-faint p-4 text-xs leading-relaxed">
            止めた理由は実行結果へ残ります。公開済みの版は書き換えず、新しく登録される人だけが新版を使います。
          </p>
        </Card>
      </div>
    </div>
  )
}

function StopToggle({ checked, label, note, onChange }: {
  checked: boolean
  label: string
  note: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="border-hairline flex cursor-pointer items-start gap-3 rounded-lg border p-3">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1" />
      <span>
        <span className="text-ink block text-sm font-medium">{label}</span>
        <span className="text-ink-faint block text-xs">{note}</span>
      </span>
    </label>
  )
}

function PreviewStage({ preview, settings }: {
  preview: ReminderPreviewResult | null
  settings: ReminderDraftSettings
}) {
  return (
    <div className={styles.columns} data-design-node="JCz6J">
      <Card padding="roomy" className="min-w-0">
        <CardHeader title="届く予定" meta={`${settings.steps.length}通`} />
        {!preview ? (
          <ListState kind="loading" title="届く予定を数えています" />
        ) : preview.items.length === 0 ? (
          <ListState kind="empty" title="届く予定がありません" description="送る通と基準日を確認してください。" />
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
            {preview.items.map((item) => (
              <div key={item.stableStepId} className={styles.previewRow}>
                <span className="text-ink-faint text-xs">{item.stepNumber}通目</span>
                <span className="text-ink min-w-0 truncate text-sm" title={item.label}>{item.label}</span>
                <span className="text-ink-secondary text-right text-xs">{formatDateTime(item.scheduledAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card padding="default">
          <CardHeader title="対象の見込み" />
          <dl className="space-y-3 p-4 text-sm">
            <SummaryRow label="対象" value={preview ? countLabel(preview.summary.audience, '人') : '—人'} />
            <SummaryRow label="7日以内" value={preview ? countLabel(preview.summary.next7Days, '通') : '—通'} />
            <SummaryRow label="30日以内" value={preview ? countLabel(preview.summary.next30Days, '通') : '—通'} />
            <SummaryRow label="重なり" value={preview ? `${preview.summary.duplicateCount}件` : '—件'} />
          </dl>
        </Card>
        <Card padding="default">
          <CardHeader title="最初のLINE" />
          <p className="text-ink-secondary p-4 text-sm whitespace-pre-wrap">{settings.steps[0]?.messageContent || '—'}</p>
        </Card>
      </div>
    </div>
  )
}

function TestStage({ draft, settings, onTest, busy }: {
  draft: ReminderDraftVersion
  settings: ReminderDraftSettings
  onTest: () => void
  busy: boolean
}) {
  return (
    <div className={styles.columns} data-design-node="W98zZQ">
      <Card padding="roomy" className="min-w-0 space-y-5">
        <div>
          <h2 className="text-ink text-base font-semibold">自分のLINEへテスト送信</h2>
          <p className="text-ink-faint mt-1 text-xs">登録済みのテスト受信先へ、本番と同じ本文・テンプレート・差し込み処理で1通送ります。</p>
        </div>
        <div className="bg-canvas-sunken rounded-card p-4">
          <p className="text-ink-faint text-xs">{settings.name}</p>
          <p className="text-ink bg-canvas mt-3 rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
            {settings.steps[0]?.messageContent || '—'}
          </p>
        </div>
        <Button variant="primary" disabled={busy} onClick={onTest}>
          {busy ? '送信中…' : draft.lastTestStatus === 'succeeded' ? 'もう一度テスト送信' : 'テスト送信する'}
        </Button>
      </Card>
      <Card padding="default">
        <CardHeader title="テストの状態" />
        <dl className="space-y-3 p-4 text-sm">
          <SummaryRow
            label="結果"
            value={draft.lastTestStatus === 'succeeded' ? '届きました' : draft.lastTestStatus === 'failed' ? '届きませんでした' : 'まだ送っていません'}
          />
          <SummaryRow label="確認した日時" value={formatDateTime(draft.lastTestedAt)} />
          <SummaryRow label="本番の登録" value="増えません" />
          <SummaryRow label="配信予定" value="作りません" />
        </dl>
      </Card>
    </div>
  )
}

function ConfirmStage({ draft, settings, validation }: {
  draft: ReminderDraftVersion
  settings: ReminderDraftSettings
  validation: ReminderValidationResult | null
}) {
  return (
    <div className={styles.columns} data-design-node="s6Vvp">
      <Card padding="roomy" className="min-w-0">
        <CardHeader title="公開前の確認" meta={`v${draft.versionNumber}`} />
        {!validation ? (
          <ListState kind="loading" title="公開できるか確認しています" />
        ) : (
          <div className="mt-4 space-y-2">
            {validation.checks.map((check) => (
              <div key={check.key} className="border-hairline flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-ink text-sm font-medium">{check.label}</p>
                  <p className="text-ink-faint mt-0.5 text-xs">{check.message}</p>
                </div>
                <StatusBadge tone={check.status === 'passed' ? 'success' : check.status === 'warning' ? 'warning' : 'danger'}>
                  {check.status === 'passed' ? '確認済み' : check.status === 'warning' ? '注意' : '要確認'}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card padding="default">
          <CardHeader title="公開する内容" />
          <dl className="space-y-3 p-4 text-sm">
            <SummaryRow label="名前" value={settings.name} />
            <SummaryRow label="対象" value={settings.targetTagId ? 'タグで絞り込み' : '対象になった友だち全員'} />
            <SummaryRow label="送る通" value={`${settings.steps.length}通`} />
            <SummaryRow label="最初のタイミング" value={settings.steps[0] ? describeReminderTiming(settings.steps[0], settings.deliveryMode) : '—'} />
            <SummaryRow label="対象人数" value={validation ? countLabel(validation.audience.matched, '人') : '—人'} />
            <SummaryRow label="除外人数" value={validation ? countLabel(validation.audience.excluded, '人') : '—人'} />
          </dl>
        </Card>
        <p className="bg-warning-bg text-warning rounded-card px-4 py-3 text-xs leading-relaxed">
          公開しても、すでに登録済みの友だちが使う版は変わりません。新版は、公開後に新しく対象になった友だちから使われます。
        </p>
      </div>
    </div>
  )
}

function DoneStage({ draft, published }: {
  draft: ReminderDraftVersion
  published: ReminderPublishResult | null
}) {
  const versionNumber = published?.versionNumber ?? draft.versionNumber
  return (
    <div className="mx-auto max-w-3xl" data-design-node="PSmHo">
      <Card padding="roomy" className="text-center">
        <StatusBadge tone="success">公開しました</StatusBadge>
        <h2 className="text-ink mt-4 text-xl font-semibold">リマインダを公開しました</h2>
        <p className="text-ink-faint mt-2 text-sm">これから新しく対象になった友だちには、v{versionNumber} の内容で届きます。</p>
        <dl className="mx-auto mt-6 grid max-w-xl gap-3 text-left sm:grid-cols-3">
          <DoneMetric label="公開版" value={`v${versionNumber}`} />
          <DoneMetric label="対象" value={published ? countLabel(published.audience, '人') : '—人'} />
          <DoneMetric label="次の予定" value={published ? formatDateTime(published.nextScheduledAt) : '—'} />
        </dl>
        {/*
          **行き先の無いリンクを置かない。** 実行結果の画面
          （`/reminders/detail`、設計 7-1-H `GC4St`）はまだ入っていない
          （台帳 Issue #74）。押せる形で置くと行き止まりに当たる。
          何がどうなれば見られるかを文字で書く。
        */}
        <p className="text-ink-faint mt-6 text-center text-xs">
          実行結果の画面はまだ繋がっていません。接続されると、この版が実際に
          いつ誰へ届いたかをここから確認できます。
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Button variant="primary" href="/reminders">一覧へ戻る</Button>
        </div>
      </Card>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-ink-faint shrink-0 text-xs">{label}</dt>
      <dd className="text-ink min-w-0 text-right text-sm font-medium break-words">{value}</dd>
    </div>
  )
}

function DoneMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-canvas-sunken rounded-card p-4">
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className="text-ink mt-1 text-sm font-semibold">{value}</dd>
    </div>
  )
}
