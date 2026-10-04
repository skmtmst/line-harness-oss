'use client'

import Disclosure from '@/components/shared/disclosure'
import CommentsV8 from './comments-v8'
import ParticipantsV8, { type ParticipantExport } from './participants-v8'
import CtaV8 from './cta-v8'
import ReviewV8 from './review-v8'
import NotificationsV8 from './notifications-v8'
import VideoV8 from './video-v8'
import './editor-v8.css'
import { fmtSec } from './participants-shared'
import AnalyticsV8 from './analytics-v8'
import LinePreview from '@/components/shared/line-preview'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { notificationPreview, videoPreview } from './preview-body'
import { ctaCardProblems } from './cta-card-validation'
import {
  STEPS,
  nextLabelOf,
  nextStepOf,
  stepStateOf,
  type StepKey,
} from './edit-steps'
import BasicV8 from './basic-v8'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import { CheckCircle2, Circle, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { MediaItem } from '@line-crm/shared'
import {
  ApiError,
  api,
  fetchApi,
  webinarApi,
  type WebinarCtaCard,
  type Webinar,
  type WebinarAnalytics,
  type WebinarAction,
  type WebinarEditor,
  type WebinarNotificationOverview,
  type WebinarNotificationSettings,
} from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { webinarLoadFailure, type WebinarLoadFailure } from '../webinar-load-failure'
import { formatDateTime, formatNumber } from '@/lib/format'

function fmtSession(epoch: number): string {
  return formatDateTime(epoch * 1000)
}

const inputClass =
  'w-full border border-hairline rounded-control px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-action'

function webinarStatusLabel(status: Webinar['status']): string {
  if (status === 'active') return '公開中'
  if (status === 'draft') return '下書き'
  return 'アーカイブ'
}

type WebinarWithPublication = Webinar & {
  publicationState?: 'period' | 'always' | 'scheduled' | 'ended' | 'unset' | null
  publicationStartsAt?: string | null
  publicationEndsAt?: string | null
}

function deliveryWindow(webinar: Webinar): string {
  /* 5枝の決まりは共有(`components/webinars/publication-label`)。ここは編集画面だけの落としどころ。 */
  const publication = webinar as WebinarWithPublication
  const shared = publicationStateLabel(publication.publicationState, publication.publicationStartsAt, publication.publicationEndsAt)
  if (shared !== null) return shared
  const daily = webinar.schedule.find((rule) => rule.type === 'daily' && rule.time)
  const once = webinar.schedule.find((rule) => rule.type === 'once' && rule.at)
  if (once?.at) return fmtSession(Math.floor(new Date(once.at).getTime() / 1000))
  if (daily?.time) return `毎日 ${daily.time}`
  return '—（公開期間は未設定）'
}

function SummaryAside({
  rows,
  previewBody,
  previewButton,
  previewFirst = false,
  children,
}: {
  rows: Array<[string, string]>
  previewBody: string
  previewButton?: string | null
  previewFirst?: boolean
  children?: ReactNode
}) {
  const summary = (
    <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
        <h2 className="text-ink text-sm font-bold">設定サマリー</h2>
        <dl className="divide-hairline mt-3 divide-y">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-3 text-xs"><dt className="text-ink-faint">{label}</dt><dd className="text-ink text-right font-semibold">{value}</dd></div>
          ))}
        </dl>
    </section>
  )
  const preview = (
    <div className="min-h-[365px] shadow-card">
    <LinePreview
      note="実際のLINE表示に近いプレビューです"
    >
        <div className="bg-canvas text-ink rounded-control p-4 text-sm font-medium leading-relaxed">{previewBody}</div>
        {previewButton ? <div className="bg-accent-deep text-on-accent mx-auto mt-3 w-fit rounded-control px-4 py-2 text-xs font-medium">{previewButton}</div> : null}
    </LinePreview>
    </div>
  )
  return (
    <aside className="space-y-3 xl:w-[390px] xl:shrink-0">
      {previewFirst ? <>{preview}{summary}</> : <>{summary}{preview}</>}
      {children}
    </aside>
  )
}

function EditorDetails({ label, children }: { label: string; children: ReactNode }) {
  return <Disclosure title={label}>{children}</Disclosure>
}

const MEDIA_KIND_LABEL: Record<MediaItem['kind'], string> = {
  image: '画像',
  video: '動画',
  audio: '音声',
  file: 'ファイル',
}

/*
  動画欄の表示名。**URL識別子から `<slug>.mp4` という存在しない
  ファイル名を作らない**(監査 DETAIL-18)。
  ライブラリのメディアを選んでいれば実ファイル名・種別・長さを出す。
  prefix だけの旧形式や、ライブラリで名前を取れないときは
  「設定済みの動画」とだけ書く。
*/
function VideoMediaLabel({ webinar }: { webinar: Webinar }) {
  const mediaId = webinar.videoMediaId ?? null
  const accountId = webinar.accountId ?? null
  const [media, setMedia] = useState<MediaItem | null>(null)

  useEffect(() => {
    setMedia(null)
    if (!mediaId || !accountId) return
    let cancelled = false
    api.media
      .detail(mediaId, accountId)
      .then((res) => {
        if (!cancelled && res.success) setMedia(res.data.item)
      })
      .catch(() => {
        /* 名前が取れなくても偽名は出さない。「設定済みの動画」に落ちる。 */
      })
    return () => {
      cancelled = true
    }
  }, [mediaId, accountId])

  if (!webinar.videoPrefix && !mediaId) return <span>—（未設定）</span>
  if (!media) return <span>設定済みの動画</span>
  return (
    <span className="block min-w-0">
      <span className="block truncate" title={media.filename}>
        {media.filename}
      </span>
      <span className="text-ink-faint mt-0.5 block text-xs font-normal">
        {MEDIA_KIND_LABEL[media.kind]}
        {media.durationMs !== null && media.durationMs > 0
          ? `・${fmtSec(Math.round(media.durationMs / 1000))}`
          : ''}
      </span>
    </span>
  )
}

type NotificationRowState = 'configured' | 'unset' | 'pending' | 'failed'

const NOTIFICATION_ROW_STATE: Record<
  NotificationRowState,
  { label: string; icon: typeof CheckCircle2; tone: 'success' | 'neutral' | 'pending' | 'danger' }
> = {
  configured: { label: '設定済み', icon: CheckCircle2, tone: 'success' },
  unset: { label: '未設定', icon: Circle, tone: 'neutral' },
  pending: { label: '—（確認中）', icon: LoaderCircle, tone: 'pending' },
  failed: { label: '取得できません', icon: TriangleAlert, tone: 'danger' },
}

function notificationRowState(
  value: boolean | undefined,
  ready: boolean,
  failed: boolean,
): NotificationRowState {
  if (!ready) return 'pending'
  if (failed) return 'failed'
  return value ? 'configured' : 'unset'
}

/*
  「当日・見逃し案内」の要約文は、時刻の有無ではなく保存された
  各通知の有効フラグから組み立てる（監査 WEBINAR-10）。
  全OFFで保存しても時刻の既定値は残るので、値だけ見ると
  切った通知まで「送る」と読めてしまう。読み込み中・取得失敗・
  まだ設定が無いのも「送る」ではないので、状態ごとに分ける。
  説明は概要バッジと同じ NOTIFICATION_ROW_STATE の言葉を使う。
*/
function deliveryTimingSummary(
  settings: WebinarNotificationSettings | null,
  ready: boolean,
  failed: boolean,
): string {
  if (!ready) return NOTIFICATION_ROW_STATE.pending.label
  if (failed) return NOTIFICATION_ROW_STATE.failed.label
  if (!settings) return NOTIFICATION_ROW_STATE.unset.label
  const parts: string[] = []
  if (settings.dayBeforeEnabled) parts.push(`前日 ${settings.dayBeforeTime || '—'}`)
  if (settings.hourBeforeEnabled) parts.push(settings.hourBeforeMinutes ? `${settings.hourBeforeMinutes}分前` : '開始前')
  if (settings.startEnabled) parts.push('開始時')
  return parts.length > 0 ? parts.join('／') : '送りません'
}

function missedNoticeSummary(
  settings: WebinarNotificationSettings | null,
  ready: boolean,
  failed: boolean,
): string {
  if (!ready) return NOTIFICATION_ROW_STATE.pending.label
  if (failed) return NOTIFICATION_ROW_STATE.failed.label
  if (!settings) return NOTIFICATION_ROW_STATE.unset.label
  return settings.missedEnabled
    ? `未視聴者へ翌日${settings.missedTime || '—'}に送信（期限${settings.missedWindowDays ?? 7}日）`
    : '送りません'
}

function completedNoticeSummary(
  settings: WebinarNotificationSettings | null,
  ready: boolean,
  failed: boolean,
): string {
  if (!ready) return NOTIFICATION_ROW_STATE.pending.label
  if (failed) return NOTIFICATION_ROW_STATE.failed.label
  if (!settings) return NOTIFICATION_ROW_STATE.unset.label
  return settings.completedEnabled ? '見終わった人へお礼を送信' : '送りません'
}

function NotificationStateBadge({ state }: { state: NotificationRowState }) {
  const view = NOTIFICATION_ROW_STATE[state]
  const Icon = view.icon
  /*
    className は静的に読める字面だけで書く（design-debt 計測が識別子を
    追えないため）。色の対応は NOTIFICATION_ROW_STATE の tone が持ち、
    ここはその言い換えに留める。
  */
  return (
    <span
      className={
        view.tone === 'success'
          ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-success'
          : view.tone === 'neutral'
            ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint'
            : view.tone === 'pending'
              ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary'
              : 'inline-flex items-center gap-1.5 text-xs font-semibold text-danger'
      }
    >
      <Icon aria-hidden="true" size={14} />
      {view.label}
    </span>
  )
}

const ACTION_LABELS: Record<WebinarAction['actionType'], string> = {
  add_tag: 'タグを付ける',
  remove_tag: 'タグを外す',
  start_scenario: 'シナリオを開始する',
  stop_scenario: 'シナリオを停止する',
  resume_scenario: 'シナリオを再開する',
  send_message: 'LINEメッセージまたはテンプレートを送る',
  send_webhook: '外部Webhookへ送る',
  switch_rich_menu: 'リッチメニューを切り替える',
  remove_rich_menu: 'リッチメニューを外す',
}

const TRIGGERS: Array<{ key: WebinarAction['trigger']; label: string }> = [
  { key: 'completed', label: '視聴完了' },
  { key: 'cta_clicked', label: 'CTAクリック' },
  { key: 'unviewed', label: '未視聴' },
]

function actionReferenceKey(type: WebinarAction['actionType']): string | null {
  if (type === 'add_tag' || type === 'remove_tag') return 'tagId'
  if (type === 'start_scenario' || type === 'stop_scenario' || type === 'resume_scenario') return 'scenarioId'
  if (type === 'send_message') return 'templateId'
  if (type === 'send_webhook') return 'webhookId'
  if (type === 'switch_rich_menu') return 'richMenuPageId'
  return null
}

function WebinarActionsTab({ webinarId, editor, onEditorChange }: { webinarId: string; editor: WebinarEditor; onEditorChange: (editor: WebinarEditor) => void }) {
  const [actions, setActions] = useState<WebinarAction[]>([])
  const [trigger, setTrigger] = useState<WebinarAction['trigger']>('completed')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [templateBody, setTemplateBody] = useState(editor.actionPolicy.templateBody)
  const [missingResultPolicy, setMissingResultPolicy] = useState(editor.actionPolicy.missingResultPolicy)

  const load = useCallback(() => {
    setState('loading')
    webinarApi.actions(webinarId)
      .then((response) => { setActions(response.data); setState('ready') })
      .catch(() => setState('error'))
  }, [webinarId])

  useEffect(() => { load() }, [load])

  if (state === 'loading') return <div className="text-ink-faint py-12 text-center text-sm">読み込んでいます</div>
  if (state === 'error') return <div className="text-danger py-12 text-center text-sm">視聴後アクションを読み込めませんでした。<span className="ml-2"><Button onClick={load}>もう一度読み込む</Button></span></div>

  const visible = actions.filter((action) => action.trigger === trigger)
  const update = (index: number, patch: Partial<WebinarAction>) => {
    const target = visible[index]
    setActions((current) => current.map((action) => action === target ? { ...action, ...patch } : action))
  }
  const remove = (index: number) => {
    const target = visible[index]
    setActions((current) => current.filter((action) => action !== target))
  }
  const save = async () => {
    setSaving(true)
    setNotice('')
    try {
      const response = await webinarApi.saveActions(webinarId, actions)
      setActions(response.data)
      const editorResponse = await webinarApi.saveEditor(webinarId, {
        expectedVersion: editor.version,
        actionTemplateBody: templateBody,
        missingResultPolicy,
      })
      onEditorChange(editorResponse.data)
      setNotice('視聴後アクションを保存しました。')
    } catch {
      setNotice('保存できませんでした。状態を読み直して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const completedActions = actions.filter((action) => action.trigger === 'completed')

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="Xjk8q">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">CTA・フォーム</h2>
          <p className="text-ink-faint mt-1 text-xs">視聴完了・CTAクリック・未視聴ごとの処理を設定します。</p>
          <div className="mt-4 flex flex-wrap gap-2">{TRIGGERS.map((item) => <span key={item.key} className="rounded-pill border border-hairline px-3 py-1 text-xs font-semibold text-ink-secondary">{item.label}</span>)}</div>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <div className="flex items-center justify-between gap-3"><h2 className="text-ink text-base font-bold">視聴完了メッセージ</h2><Button disabled>変数を挿入</Button></div>
          <textarea value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} className="border-hairline bg-canvas-sunken text-ink mt-4 min-h-28 w-full rounded-control border p-4 text-sm leading-relaxed" aria-label="視聴完了メッセージ本文" />
          <div className="mt-3 flex flex-wrap gap-2"><Button disabled>資料を受け取る</Button><Button disabled>個別相談を予約</Button><Button disabled>あとで見る</Button></div>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <dl className="divide-hairline divide-y rounded-control border border-hairline">
            <div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">実行タイミング</dt><dd className="text-ink text-sm font-semibold">視聴完了直後</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">同じ視聴への実行</dt><dd className="text-ink text-sm font-semibold">1回だけ</dd></div>
          </dl>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-ink text-base font-bold">配信後の通知・アクション</h2><p className="text-ink-faint mt-1 text-xs">保存済みの実行内容です。</p></div><span className="text-ink-faint text-xs">{completedActions.length}件</span></div>
          <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">{completedActions.length === 0 ? <li className="text-ink-faint p-4 text-sm">まだ設定されていません。</li> : completedActions.map((action, index) => <li key={action.id ?? index} className="text-ink px-4 py-3 text-sm font-semibold">{ACTION_LABELS[action.actionType]}</li>)}</ul>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-sm font-bold">視聴結果を取得できない場合</h2><p className="text-ink-faint mt-1 text-xs">再取得するか、要対応へ追加するか選択できます。</p><div className="mt-3 max-w-sm"><Select aria-label="視聴結果を取得できない場合" value={missingResultPolicy} onChange={(value) => setMissingResultPolicy(value as WebinarEditor['actionPolicy']['missingResultPolicy'])} options={[{ value: 'escalate', label: '要対応へ追加' }, { value: 'retry_next_day', label: '翌日に再取得' }]} /></div></section>
        <EditorDetails label="通知・アクションの詳細を編集する">
        <section className="space-y-4">
      <div><h2 className="text-ink font-bold">視聴後の通知・アクション</h2><p className="text-ink-faint mt-1 text-xs">視聴完了・CTAクリック・未視聴ごとの処理を設定します。</p></div>
      <div className="flex flex-wrap gap-2">
        {TRIGGERS.map((item) => <Button key={item.key} variant={trigger === item.key ? 'primary' : 'secondary'} onClick={() => setTrigger(item.key)}>{item.label}</Button>)}
      </div>
      <div className="border-hairline divide-hairline divide-y overflow-hidden rounded-card border">
        {visible.length === 0 ? <p className="text-ink-faint p-8 text-center text-sm">この条件のアクションはまだありません。</p> : visible.map((action, index) => {
          const referenceKey = actionReferenceKey(action.actionType)
          return (
            <div key={action.id ?? `${trigger}-${index}`} className="bg-canvas grid gap-3 p-4 md:grid-cols-3 md:items-center">
              <Select
                value={action.actionType}
                onChange={(value) => update(index, { actionType: value as WebinarAction['actionType'], config: {} })}
                aria-label="実行するアクション"
                options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
              />
              {referenceKey ? <input value={String(action.config[referenceKey] ?? '')} onChange={(event) => update(index, { config: { [referenceKey]: event.target.value } })} placeholder={`${referenceKey}を入力`} className="border-hairline rounded-control border px-3 py-2 text-sm" /> : <span className="text-ink-faint text-xs">追加設定はありません</span>}
              <Button type="button" onClick={() => remove(index)}>外す</Button>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => setActions((current) => [...current, { trigger, actionType: 'add_tag', config: { tagId: '' } }])}>通知・アクションを追加</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving} busy={saving}>視聴後アクションを保存する</Button>
      </div>
      {notice ? <p className="text-ink-secondary text-sm">{notice}</p> : null}
        </section>
        </EditorDetails>
      </div>
      <SummaryAside rows={[
        ['完了案内', '視聴完了＋ボタン'],
        ['実行時点', '視聴完了直後'],
        ['通知・アクション', completedActions.length > 0 ? `${completedActions.length}件` : '未設定'],
        ['結果未取得時', missingResultPolicy === 'escalate' ? '要対応へ追加' : '翌日に再取得'],
      ]} previewBody={templateBody || '視聴完了メッセージは未設定です。'} previewFirst />
    </div>
  )
}

function PublicPreviewStep({
  webinar,
  editor,
  publicUrl,
  registrations,
  publicPageReason,
  onEditorChange,
}: {
  webinar: Webinar
  editor: WebinarEditor
  publicUrl: string | null
  registrations: number | null
  publicPageReason: string
  onEditorChange: (editor: WebinarEditor) => void
}) {
  const canOpenPublicPage = webinar.status === 'active' && publicUrl !== null
  const [testing, setTesting] = useState(false)
  const [testNotice, setTestNotice] = useState('')
  const testPublicPage = async () => {
    setTesting(true)
    setTestNotice('')
    try {
      const response = await webinarApi.testPublicPage(webinar.id, editor.version)
      onEditorChange(response.data)
      setTestNotice(response.data.publicPage.test?.status === 'passed' ? '公開ページを確認しました。' : '公開ページに未設定があります。')
    } catch (cause) {
      setTestNotice(webinarErrorText(cause, '公開ページを確認できませんでした。'))
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="GB0NR">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-semibold">公開ページ</h2><p className="text-ink-faint mt-1 text-xs">タイトル・説明・申込フォームを最終確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">ページタイトル</dt><dd className="text-ink text-sm font-semibold">{webinar.title}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">公開URL</dt><dd className="text-ink max-w-2xl truncate text-sm font-semibold" title={publicUrl ?? undefined}>{publicUrl ?? '—（LIFF ID未設定）'}</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">説明</dt><dd className="text-ink max-w-2xl text-right text-sm font-semibold">{editor.publicDescription || '—（未設定）'}</dd></div></dl></section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card"><h2 className="text-ink text-base font-semibold">表示内容</h2><p className="text-ink-faint mt-1 text-xs">PC・スマートフォンの表示を確認します。</p><dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline"><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">メイン動画</dt><dd className="text-ink text-sm font-semibold">16:9・自動再生なし</dd></div><div className="flex items-center justify-between gap-4 px-4 py-4"><dt className="text-ink-faint text-xs font-semibold">申込フォーム</dt><dd className="text-ink text-sm font-semibold">{editor.publicPage.form ? `${editor.publicPage.form.name}（${editor.publicPage.form.fields.length}項目）` : '—（未設定）'}</dd></div></dl></section>
      </div>
      <SummaryAside rows={[
        ['状態', webinar.videoPrefix ? '公開準備完了' : '動画未設定'],
        ['公開期間', deliveryWindow(webinar)],
        ['対象', registrations === null ? '—（未取得）' : `${formatNumber(registrations)}人`],
      ]} previewBody={editor.publicDescription || webinar.title}>
        <div className="flex gap-2"><Button disabled={testing || !publicUrl} onClick={() => void testPublicPage()} busy={testing} busyLabel="確認中…">{editor.publicPage.test?.status === 'passed' ? 'ページ確認済み' : 'ページをテスト'}</Button>{canOpenPublicPage ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}</div>
        {testNotice ? <p className="text-ink-secondary text-xs">{testNotice}</p> : null}
        {!canOpenPublicPage ? <p className="text-ink-faint text-xs">{publicPageReason}</p> : null}
      </SummaryAside>
    </div>
  )
}

/**
 * タブの並び。設計（4-8-1）は「どのウェビナーか → いつ見られるようにするか →
 * 見ている途中に出すもの → 見終わったあとの動き」の順に並べている。
 * 実装は分析タブを先頭に置いていたが、編集画面なので設定を先にする。
 */
/**
 * 段の外にあるもの。**設計の5段には無いが、実装が持っている。**
 * 段に混ぜると「作り終えるのに必要な手順」に見えてしまうので、分けて置く。
 */
const EXTRAS = [
  ['comments', 'コメント演出'],
  ['actions', '視聴後アクション'],
  ['preview', '公開プレビュー'],
  ['participants', '参加者'],
  ['analytics', '分析'],
] as const

type ExtraKey = (typeof EXTRAS)[number][0]
type PaneKey = StepKey | ExtraKey

function EditWebinarInner() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const id = searchParams.get('id')
  const { accounts, loading: accountsLoading } = useAccount()
  /*
    読み込んだ中身も失敗も「どのウェビナーの分か」を一緒に持つ。
    別のウェビナーへ切り替えた瞬間から、前のウェビナーの中身も失敗文も画面に出さない。
  */
  const [loadedWebinar, setLoadedWebinar] = useState<{ id: string; webinar: Webinar; editor: WebinarEditor } | null>(null)
  /*
   * D004: 失敗の理由は `webinarLoadFailure` で言い分ける。403 は読み直しても
   * 直らない（権限を足してもらうしかない）、429 は待てば直る、それ以外は
   * 通信を確かめる。同じ「もう一度読み込む」を出すと、権限不足の人は
   * 何度押しても直らない道へ誘われる（一覧 `/webinars` と同じ型）。
   */
  const [loadFailure, setLoadFailure] = useState<{ id: string; failure: WebinarLoadFailure } | null>(null)
  /** 404・空で見つからないとき。取得の失敗（loadFailure）とは分ける。 */
  const [loadMissing, setLoadMissing] = useState<{ id: string } | null>(null)
  /** 失敗したあとの「もう一度読み込む」で取り直すための番号。 */
  const [reloadKey, setReloadKey] = useState(0)
  const [analytics, setAnalytics] = useState<WebinarAnalytics | null>(null)
  const [analyticsState, setAnalyticsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [analyticsId, setAnalyticsId] = useState<string | null>(null)
  /* 取得の世代印。切替後に遅れて届いた前のウェビナーの応答はここで捨てる。 */
  const loadRequestId = useRef(0)
  const [participantExport, setParticipantExport] = useState<ParticipantExport | null>(null)
  const handleParticipantExport = useCallback((value: ParticipantExport | null) => setParticipantExport(value), [])

  const webinar = loadedWebinar && loadedWebinar.id === id ? loadedWebinar.webinar : null
  const editor = loadedWebinar && loadedWebinar.id === id ? loadedWebinar.editor : null
  const loadError = loadFailure && loadFailure.id === id ? loadFailure.failure : null
  const loadMissingNow = loadMissing !== null && loadMissing.id === id
  /* 今のウェビナーの中身も失敗も無い間が読み込み中。切替の1コマ目から前の中身を描かない。 */
  const loading = webinar === null && loadError === null && !loadMissingNow
  const setEditor = useCallback((next: WebinarEditor) => {
    setLoadedWebinar((prev) => (prev && prev.id === id ? { ...prev, editor: next } : prev))
  }, [id])
  /*
    **編集画面なので、開いた直後は設定の1段目**。前は「概要・分析」を先頭に
    置いていたので、直しに来た人が結果の画面から始めることになっていた。
  */
  const requestedPane = searchParams.get('pane')
  const initialPane = ([...STEPS.map((step) => step.key), ...EXTRAS.map(([key]) => key)] as string[]).includes(requestedPane ?? '')
    ? requestedPane as PaneKey
    : 'basic'
  const [pane, setPane] = useState<PaneKey>(initialPane)
  /*
    CTAの印と最終確認が見るカード件数。初期値はエディタ応答の ctaCount、
    CTAの段を開いた後は子タブが保存・再取得した結果を正本にする。
    「どのウェビナーの分か」を一緒に持ち、切替後に前の件数を出さない。
  */
  const [reportedCtaCount, setReportedCtaCount] = useState<{ webinarId: string; count: number } | null>(null)
  const ctaCount = reportedCtaCount && reportedCtaCount.webinarId === id
    ? reportedCtaCount.count
    : (editor?.ctaCount ?? 0)
  const handleCtasReport = useCallback((ctas: WebinarCtaCard[] | null) => {
    setReportedCtaCount({ webinarId: id ?? '', count: ctas?.length ?? 0 })
  }, [id])

  /*
    **段を行き来しても入力を消さないための仕組み。**
    編集の段（基本・動画・通知）は一度開いたら畳まずに隠すだけにし、
    各段は「保存する操作」と「未保存かどうかの報告」を親へ登録する。
    固定バーはこの登録を使って1本だけで保存・未保存表示を行う。
  */
  const [visitedPanes, setVisitedPanes] = useState<ReadonlySet<PaneKey>>(() => new Set([initialPane]))
  const [savablePanes, setSavablePanes] = useState<ReadonlySet<PaneKey>>(new Set())
  const [unsavedPanes, setUnsavedPanes] = useState<ReadonlySet<PaneKey>>(new Set())
  const saveHandlers = useRef(new Map<PaneKey, () => Promise<boolean>>())
  const dirtyReporters = useRef(new Map<PaneKey, (dirty: boolean) => void>())
  const saveRegistrars = useRef(new Map<PaneKey, (save: (() => Promise<boolean>) | null) => void>())
  /* 保存してから段を変える間の押し口。'draft' はその場保存、'next' は保存して次へ。 */
  const [savingForNav, setSavingForNav] = useState<false | 'draft' | 'next'>(false)

  /* 呼ぶたびに新しい関数を渡すと子の登録効果が毎回走る。段ごとに1つだけ作って使い回す。 */
  const dirtyReporterFor = (key: PaneKey): ((dirty: boolean) => void) => {
    let reporter = dirtyReporters.current.get(key)
    if (!reporter) {
      reporter = (dirty: boolean) => {
        setUnsavedPanes((prev) => {
          if (prev.has(key) === dirty) return prev
          const next = new Set(prev)
          if (dirty) next.add(key)
          else next.delete(key)
          return next
        })
      }
      dirtyReporters.current.set(key, reporter)
    }
    return reporter
  }
  const saveRegistrarFor = (key: PaneKey): ((save: (() => Promise<boolean>) | null) => void) => {
    let registrar = saveRegistrars.current.get(key)
    if (!registrar) {
      registrar = (save) => {
        if (save) saveHandlers.current.set(key, save)
        else saveHandlers.current.delete(key)
        setSavablePanes((prev) => {
          const has = save !== null
          if (prev.has(key) === has) return prev
          const next = new Set(prev)
          if (has) next.add(key)
          else next.delete(key)
          return next
        })
      }
      saveRegistrars.current.set(key, registrar)
    }
    return registrar
  }

  /*
    未保存の入力を持ったまま画面の外へ出る操作を止める（DETAIL-04 残存経路）。
    一覧リンク・左メニュー・ブラウザの戻る・再読込を捕まえ、破棄か編集継続かを
    確認する。段の行き来は画面内の移動なのでここには触れない——入力は隠すだけで
    畳まないため失われない。契約は共通の `useUnsavedGuard` と同じ。
  */
  const { leaveTarget, confirmLeave, cancelLeave, disarm } = useUnsavedGuard({
    dirty: unsavedPanes.size > 0,
    busy: savingForNav !== false,
    /*
      段の行き来で変わるのは pane だけ。同じウェビナーの中での戻る・進むは
      離脱ではないので、確認も復元もしない。一覧や別のウェビナーへ出る
      操作はこれまで通り止める（DETAIL-04 の pane 例外）。
    */
    samePage: (destination) =>
      destination.pathname === pathname && destination.searchParams.get('id') === id,
  })
  /*
    離脱の確認はどの段・どの画面状態にいても出す。読み込み失敗や未指定の
    分岐は別ツリーへ早期 return するため、ここで要素化して全経路へ差し込む。
    片方だけに置くと、dirty 中のリンクが黙って止まり「保存せずに移る」を
    選ぶ手段がなくなる。
  */
  const leaveConfirmDialog = (
    <UnsavedLeaveDialog open={leaveTarget !== null} subject="ウェビナーの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
  )

  /*
    段の移動はURLにも残す。再読み込み・ブラウザの戻るで
    同じ段へ戻れるようにする（DETAIL-03/04）。
  */
  const goStep = useCallback((next: PaneKey) => {
    setVisitedPanes((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    setPane(next)
    try {
      window.history?.pushState?.(null, '', `?id=${encodeURIComponent(id ?? '')}&pane=${next}`)
    } catch {
      /* 履歴を持たない環境（試験用の簡易DOM）では画面内の状態だけで動く。 */
    }
  }, [id])

  /* ブラウザの戻るでURLが戻ったときは、その段を開き直す。 */
  useEffect(() => {
    const onPop = () => {
      const requested = new URLSearchParams(window.location.search).get('pane')
      const valid = ([...STEPS.map((step) => step.key), ...EXTRAS.map(([key]) => key)] as string[]).includes(requested ?? '')
      const next = (valid ? requested : 'basic') as PaneKey
      setVisitedPanes((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
      setPane(next)
    }
    window.addEventListener?.('popstate', onPop)
    return () => window.removeEventListener?.('popstate', onPop)
  }, [])

  /* 保存に成功した段の新しい中身を正本にする。一覧へ戻らず画面を続ける。 */
  const handleWebinarSaved = useCallback((next: Webinar) => {
    setLoadedWebinar((prev) => (prev && prev.id === id ? { ...prev, webinar: next } : prev))
  }, [id])

  /* 今の段の保存操作を呼ぶ。保存を持たない段は何もせず成功扱いにする。 */
  const runPaneSave = async (key: PaneKey): Promise<boolean> => {
    const save = saveHandlers.current.get(key)
    return save ? save() : true
  }

  /* 「下書き保存」はその場で保存するだけ。段は変えない。 */
  const handleDraftSave = async () => {
    if (savingForNav !== false) return
    setSavingForNav('draft')
    try {
      await runPaneSave(pane)
    } finally {
      setSavingForNav(false)
    }
  }

  /*
    次の段へ進む押し口。**未保存の入力がある段では保存してから進み、**
    保存に失敗したら入力も今の段もそのまま残す。
  */
  const handlePrimaryAction = async () => {
    if (nextPane === null || savingForNav !== false) return
    if (unsavedPanes.has(pane) && saveHandlers.current.has(pane)) {
      setSavingForNav('next')
      try {
        if (!(await runPaneSave(pane))) return
      } finally {
        setSavingForNav(false)
      }
    }
    goStep(nextPane)
  }

  const paneTitle: Record<PaneKey, string> = {
    basic: 'ウェビナー編集',
    video: '動画と公開期間',
    cta: 'CTA・フォーム',
    notifications: '通知と視聴後のこと',
    review: 'ウェビナー・公開前確認',
    comments: 'コメント演出',
    actions: 'ウェビナー・視聴後通知・アクション',
    preview: '公開ページプレビュー',
    participants: webinar ? `${webinar.title}・参加者管理` : 'ウェビナー参加者管理',
    analytics: 'ウェビナー分析',
  }
  usePageTitle(paneTitle[pane])

  useEffect(() => {
    if (!id) return
    const requestId = ++loadRequestId.current
    /* 切替時は集計も前のウェビナーの分を捨てる（申込数は段をまたいで出る）。 */
    setAnalytics(null)
    setAnalyticsId(null)
    setAnalyticsState('idle')
    Promise.all([webinarApi.get(id), webinarApi.editor(id)])
      .then(([webinarResponse, editorResponse]) => {
        /* 先に世代印を見る。切替後に届いた前の応答はここで終わり。 */
        if (requestId !== loadRequestId.current) return
        /* 読めたら前の失敗文は消す。直ったのに赤い文が残らない。 */
        setLoadFailure(null)
        setLoadMissing(null)
        setLoadedWebinar({ id, webinar: webinarResponse.data, editor: editorResponse.data })
      })
      .catch((err) => {
        if (requestId !== loadRequestId.current) return
        if (err instanceof ApiError && err.status === 404) {
          setLoadFailure(null)
          setLoadMissing({ id })
        } else {
          setLoadMissing(null)
          setLoadFailure({ id, failure: webinarLoadFailure(err) })
        }
      })
    return () => { loadRequestId.current += 1 }
  }, [id, reloadKey])

  /*
    集計は8並列の重い口。基本設定だけ直す人にも毎回走らせない。
    参加者・分析の段を開いたときだけ取り、段を離れて戻ってきても取り直さない。
    失敗は段を離れたら捨て、次に開いたときに取り直す。
  */
  useEffect(() => {
    if (!id) return
    if (pane !== 'participants' && pane !== 'analytics') {
      if (analyticsState === 'error') {
        setAnalytics(null)
        setAnalyticsId(null)
        setAnalyticsState('idle')
      }
      return
    }
    if (analyticsId === id && analyticsState !== 'idle') return
    let cancelled = false
    setAnalyticsState('loading')
    webinarApi.analytics(id)
      .then((response) => {
        if (cancelled) return
        setAnalytics(response.data)
        setAnalyticsId(id)
        setAnalyticsState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setAnalytics(null)
        setAnalyticsId(id)
        setAnalyticsState('error')
      })
    return () => { cancelled = true }
  }, [id, pane, analyticsId, analyticsState])

  if (!id) {
    /*
      U097: 「一覧から選び直すと表示できます」と言うだけでは戻れない。
      一覧へ戻る操作を文のそばに置く。開き先がない3種は ★V7 TargetMissing。
    */
    return (
      <>
        <TargetMissing
          kind="unspecified"
          title="編集するウェビナーが指定されていません"
          description="一覧から編集するウェビナーを選び直してください。"
          backHref="/webinars"
          backLabel="ウェビナー一覧へ戻る"
        />
        {leaveConfirmDialog}
      </>
    )
  }
  if (loading) {
    return (
      <>

        <div className="p-6 text-ink-faint">読み込み中...</div>
        {leaveConfirmDialog}
      </>
    )
  }
  if (loadMissingNow || (!loadError && (!webinar || !editor))) {
    return (
      <>
        <TargetMissing
          kind="not-found"
          title="このウェビナーは見つかりません"
          description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。"
          backHref="/webinars"
          backLabel="ウェビナー一覧へ戻る"
        />
        {leaveConfirmDialog}
      </>
    )
  }
  if (loadError || !webinar || !editor) {
    return (
      <>
        <TargetMissing
          kind="error"
          title={loadError?.title ?? 'ウェビナーを読み込めませんでした'}
          description={loadError?.description ?? '通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。'}
          {...(loadError === null || loadError.retryable
            ? { onRetry: () => setReloadKey((key) => key + 1) }
            : {})}
        />
        {leaveConfirmDialog}
      </>
    )
  }

  const webinarAccount = webinar.accountId
    ? accounts.find((account) => account.id === webinar.accountId)
    : null
  const publicUrl = editor.publicPage.url
  const publicPageReason = accountsLoading
    ? 'LINE公式アカウントを確認しています。'
    : !webinar.accountId || !webinarAccount
      ? 'このウェビナーのLINE公式アカウントを確認できません。'
      : !webinarAccount.liffId
        ? 'LINE公式アカウントにLIFF IDが設定されていません。'
        : webinar.status !== 'active'
          ? '公開すると、友だちが見るページを確認できます。'
          : ''
  const registrations = analytics?.summary.reservations ?? null
  const railPane: StepKey = pane === 'actions'
    ? 'notifications'
    : pane === 'preview'
      ? 'review'
      : STEPS.some((step) => step.key === pane)
        ? pane as StepKey
        : 'basic'
  const showSteps = ['basic', 'video', 'cta', 'notifications', 'actions', 'preview', 'review'].includes(pane)
  const nextPane: PaneKey | null = pane === 'notifications'
    ? 'review'
    : pane === 'actions'
      ? 'preview'
      : pane === 'preview'
        ? 'review'
        : nextStepOf(pane as StepKey)
  const nextPaneLabel = pane === 'notifications'
    ? '確認へ'
    : pane === 'actions'
      ? 'プレビューへ'
      : pane === 'preview'
        ? '公開前確認へ'
        : nextLabelOf(pane as StepKey)
  const canOpenPublicPage = webinar.status === 'active' && publicUrl !== null
  /* 未保存の入力がある段では、次へ進む押し口が保存を引き受けることを文言で示す。 */
  const primaryLabel = nextPaneLabel && unsavedPanes.has(pane) && savablePanes.has(pane)
    ? `保存して${nextPaneLabel}`
    : nextPaneLabel

  return (
    <div className="min-w-0" data-webinar-editor="v8">
      {/* ★V7: 左右の余白は共通の枠が持つ。画面側で幅と横余白を足すと 24px ずれる。 */}
      <nav data-design="Crumb" className="text-action text-xs font-semibold"><Link href="/webinars" className="hover:underline">← ウェビナー一覧</Link></nav>
      <div className="flex items-center justify-between gap-3"><h1 className="text-ink min-w-0 truncate text-xl font-semibold" title={showSteps ? paneTitle[pane] : webinar.title}>{showSteps ? paneTitle[pane] : webinar.title}</h1>{(pane === 'participants' || pane === 'analytics') && participantExport?.available ? <Button onClick={participantExport.download} disabled={participantExport.busy} busy={participantExport.busy} busyLabel="書き出しています…">CSVで書き出す</Button> : null}</div>

      {!showSteps ? <p className="text-ink-secondary text-xs">{editor.deliveryKind === 'on_demand' ? 'オンデマンド・いつでも視聴' : '日時指定'}・{webinarStatusLabel(webinar.status)}（版 {editor.version}）</p> : null}

      {showSteps ? (
        <ol data-design="Steps" className="flex" data-webinar-steps="true">
          {STEPS.map((step) => {
            const state = stepStateOf(step.key, railPane, webinar, ctaCount)
            return (
              <li key={step.key} className="flex items-center gap-2">
                <button
                  type="button"
                  data-qa-open={step.mark}
                  data-design-node={step.node}
                  onClick={() => goStep(step.key)}
                  aria-current={railPane === step.key ? 'step' : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-card px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    state === 'current'
                      ? 'bg-accent-soft text-ink'
                      : 'text-ink-secondary hover:bg-canvas-sunken'
                  }`}
                >
                  {/* 印の描き方は共通の Stepper にそろえる。pane 間の自由な移動はこの画面だけの動き（例外）。 */}
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-xs font-medium ${
                      state === 'done'
                        ? 'bg-accent-deep text-on-accent'
                        : state === 'current'
                          ? 'border-accent text-accent-deep border-2'
                          : 'border-hairline text-ink-faint border'
                    }`}
                    aria-hidden="true"
                  >
                    {state === 'done' ? '✓' : step.no}
                  </span>
                  <span className="min-w-0 truncate">
                    STEP {step.no} {step.title}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : null}

      {/*
        R94: 参加者・分析・コメント演出への常設導線。作る手順の段（STEPS）
        とは別に、公開後の運用で開く面をいつでも選べるようにする。
      */}
      <nav aria-label="参加者・分析・演出へ移動" className="flex" data-webinar-tabs="true">
        {([
          { key: 'basic', label: '設定' },
          { key: 'participants', label: '参加者' },
          { key: 'analytics', label: '分析' },
          { key: 'comments', label: 'コメント演出' },
        ] as const).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => goStep(item.key)}
            aria-current={pane === item.key ? 'page' : undefined}
            className={`rounded-card px-3 py-2 text-xs font-semibold transition-colors ${
              pane === item.key
                ? 'bg-accent-soft text-ink'
                : 'text-ink-secondary hover:bg-canvas-sunken'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/*
        編集の段（基本・動画・通知）は畳まずに隠すだけにする。
        畳むと入力が消えるので、一度開いた段は画面に置いたままにする。
      */}
      {visitedPanes.has('basic') ? (
        <div hidden={pane !== 'basic'}>
          <BasicV8 key={webinar.id} webinar={webinar} editor={editor} onWebinarSaved={handleWebinarSaved} onEditorChange={setEditor} onDirtyChange={dirtyReporterFor('basic')} registerSave={saveRegistrarFor('basic')} />
        </div>
      ) : null}
      {visitedPanes.has('video') ? (
        <div hidden={pane !== 'video'}>

<VideoV8
              webinar={webinar}
              editor={editor}
              publicUrl={publicUrl}
              canOpenPublicPage={canOpenPublicPage}
              publicPageReason={publicPageReason}
              completionLabel={editor.viewingCondition.label || null}
              onWebinarSaved={handleWebinarSaved}
              onDirtyChange={dirtyReporterFor('video')}
              registerSave={saveRegistrarFor('video')}
              onEditorChange={setEditor}
            />
        </div>
      ) : null}
      {visitedPanes.has('cta') ? (
        <div hidden={pane !== 'cta'}>

<CtaV8 webinarId={webinar.id} accountId={webinar.accountId} durationSeconds={webinar.durationSeconds} editor={editor} onEditorChange={setEditor} onCtasReport={handleCtasReport} onDirtyChange={dirtyReporterFor('cta')} registerSave={saveRegistrarFor('cta')} />
        </div>
      ) : null}
      {visitedPanes.has('notifications') ? (
        <div hidden={pane !== 'notifications'}>
          <NotificationsV8 webinarId={webinar.id} webinarTitle={webinar.title} editor={editor} onEditorChange={setEditor} onOpenActions={() => goStep('actions')} onDirtyChange={dirtyReporterFor('notifications')} registerSave={saveRegistrarFor('notifications')} publicUrl={publicUrl} canOpenPublicPage={canOpenPublicPage} publicPageReason={publicPageReason} />
        </div>
      ) : null}
      {pane === 'review' && <ReviewV8 webinar={webinar} editor={editor} registrations={registrations} ctaCount={ctaCount} onPublished={disarm} onEditorChange={setEditor} onBack={() => goStep('notifications')} onTestNotifications={() => goStep('notifications')} publicUrl={publicUrl} canOpenPublicPage={canOpenPublicPage} publicPageReason={publicPageReason} />}
      {visitedPanes.has('comments') ? <div hidden={pane !== 'comments'}><CommentsV8 webinarId={webinar.id} onDirtyChange={dirtyReporterFor('comments')} registerSave={saveRegistrarFor('comments')} /></div> : null}
      {visitedPanes.has('actions') ? (
        <div hidden={pane !== 'actions'}>
          <WebinarActionsTab webinarId={webinar.id} editor={editor} onEditorChange={setEditor} />
        </div>
      ) : null}
      {pane === 'preview' && <PublicPreviewStep webinar={webinar} editor={editor} publicUrl={publicUrl} registrations={registrations} publicPageReason={publicPageReason} onEditorChange={setEditor} />}
      {pane === 'participants' && <ParticipantsV8 webinarId={webinar.id} durationSeconds={webinar.durationSeconds} analytics={analytics} analyticsState={analyticsState} onRetry={() => { setAnalytics(null); setAnalyticsId(null); setAnalyticsState('idle') }} onExportChange={handleParticipantExport} />}
      {pane === 'analytics' && <AnalyticsV8 webinarId={webinar.id} durationSeconds={webinar.durationSeconds} analytics={analytics} analyticsState={analyticsState} onExportChange={handleParticipantExport} onRetry={() => { setAnalytics(null); setAnalyticsId(null); setAnalyticsState('idle') }} />}

      {/* 保存はこの一段だけ。各段の中に別の保存バーは出さない。共通 StickyBar を使い、画面幅いっぱいの fixed 配置でサイドバーに重ねない。 */}
      {showSteps && nextPane && nextPaneLabel ? (
        <StickyBar
          status={unsavedPanes.size > 0 ? '保存していない変更があります' : undefined}
          actions={(
            <>
              <Button href="/webinars">キャンセル</Button>
              <Button disabled={savingForNav !== false || !savablePanes.has(pane)} title={savablePanes.has(pane) ? undefined : 'この段の中の保存ボタンから保存します'} onClick={() => void handleDraftSave()} busy={savingForNav === 'draft'}>下書きを保存</Button>
              <Button variant="primary" disabled={savingForNav !== false} onClick={() => void handlePrimaryAction()} busy={savingForNav === 'next'}>{primaryLabel}</Button>
            </>
          )}
        />
      ) : null}

      {leaveConfirmDialog}
    </div>
  )
}

function EditWebinarPage() {
  return (
    <Suspense
      fallback={
        <>

          <div className="p-6 text-ink-faint">読み込み中...</div>
        </>
      }
    >
      <EditWebinarInner />
    </Suspense>
  )
}

const EditWebinarPageWithTestSupport = Object.assign(EditWebinarPage, {
  __testing: {
    NOTIFICATION_ROW_STATE,
    NotificationStateBadge,
    VideoMediaLabel,
    notificationRowState,
    deliveryTimingSummary,
    missedNoticeSummary,
    completedNoticeSummary,
  },
})

export default EditWebinarPageWithTestSupport
