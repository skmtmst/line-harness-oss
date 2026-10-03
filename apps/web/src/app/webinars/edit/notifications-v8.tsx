'use client'

/*
 * ★V8-B ウェビナー編集④通知（板 `E7iAYs`）。
 *
 * v7 の編集画面（`page.tsx` の `NotificationDesignStep`）と同じ中身。
 * v7 側は触らず、こちらの段から使う。違うのは失敗の言い方だけ——
 * V8 では「取得できません」を使わない（契約試験の決まり）。
 */
import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import WebinarNotifications from '@/components/webinars/webinar-notifications'
import { CheckCircle2, Circle, LoaderCircle, TriangleAlert } from 'lucide-react'
import {
  webinarApi,
  type WebinarEditor,
  type WebinarNotificationOverview,
  type WebinarNotificationSettings,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { notificationPreview } from './preview-body'
import { EditorDetails, SummaryAside } from './edit-v8-shared'
import styles from './notifications-v8.module.css'

type NotificationRowState = 'configured' | 'unset' | 'pending' | 'failed'

const NOTIFICATION_ROW_STATE: Record<
  NotificationRowState,
  { label: string; icon: typeof CheckCircle2; tone: 'success' | 'neutral' | 'pending' | 'danger' }
> = {
  configured: { label: '設定済み', icon: CheckCircle2, tone: 'success' },
  unset: { label: '未設定', icon: Circle, tone: 'neutral' },
  pending: { label: '—（確認中）', icon: LoaderCircle, tone: 'pending' },
  failed: { label: '読み込めませんでした', icon: TriangleAlert, tone: 'danger' },
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

export default function NotificationsStepV8({ webinarId, webinarTitle, registrations, publicUrl, canOpenPublicPage, publicPageReason, onDirtyChange, registerSave }: {
  webinarId: string
  webinarTitle: string
  registrations: number | null
  publicUrl: string | null
  canOpenPublicPage: boolean
  publicPageReason: string
  onDirtyChange?: (dirty: boolean) => void
  registerSave?: (save: (() => Promise<boolean>) | null) => void
}) {
  const [settings, setSettings] = useState<WebinarNotificationSettings | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)
  const [settingsFailed, setSettingsFailed] = useState(false)
  const [notifAttempt, setNotifAttempt] = useState(0)
  const [editor, setEditor] = useState<WebinarEditor | null>(null)
  const [testConfirmOpen, setTestConfirmOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  /*
    通知の取得は子の編集タブ(`WebinarNotifications`)に一本化し、親は
    報告を受けて概要だけ描く。同じ口を親子で2回叩かない。
  */
  const handleNotificationsLoaded = useCallback((data: { settings: WebinarNotificationSettings | null; overview: WebinarNotificationOverview | null } | null) => {
    if (data === null) {
      setSettings(null)
      setSettingsFailed(true)
    } else {
      setSettings(data.settings)
      setSettingsFailed(false)
    }
    setSettingsReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    webinarApi.editor(webinarId)
      .then((editorResponse) => { if (!cancelled) setEditor(editorResponse.data) })
      .catch(() => { if (!cancelled) setEditor(null) })
    return () => { cancelled = true }
  }, [webinarId])

  /*
    テスト送信は実際にLINEへ届く。押す前に、送る相手と文面を確認させる。
    設定が読めていない間は実行可能に見せない。
  */
  const notificationTestDone = editor?.notificationTest?.status === 'passed'
  const testDisabledReason = !settingsReady || settingsFailed
    ? '通知の設定を読み込んでから実行できます'
    : null
  const runNotificationTest = async () => {
    setTestConfirmOpen(false)
    setTesting(true)
    setTestResult('')
    try {
      const response = await webinarApi.testNotifications(webinarId)
      setTestResult(`テスト送信しました。成功 ${response.data.sent}件・失敗 ${response.data.failed}件`)
      /* 結果はエディタの notificationTest に記録される。取り直して印を更新する。 */
      webinarApi.editor(webinarId)
        .then((editorResponse) => setEditor(editorResponse.data))
        .catch(() => undefined)
    } catch (cause) {
      setTestResult(webinarErrorText(cause, 'テスト送信できませんでした。時間をおいてもう一度お試しください。'))
    } finally {
      setTesting(false)
    }
  }


  const registrationState = notificationRowState(settings?.registrationEnabled, settingsReady, settingsFailed)
  const dayBeforeState = notificationRowState(settings?.dayBeforeEnabled, settingsReady, settingsFailed)
  const reminderState = notificationRowState(
    Boolean(settings?.dayBeforeEnabled || settings?.hourBeforeEnabled),
    settingsReady,
    settingsFailed,
  )
  const startState = notificationRowState(settings?.startEnabled, settingsReady, settingsFailed)
  const missedState = notificationRowState(settings?.missedEnabled, settingsReady, settingsFailed)
  const completedState = notificationRowState(settings?.completedEnabled, settingsReady, settingsFailed)

  return (
    <div className={styles.body}>
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">事前案内</h2>
          <p className="text-ink-faint mt-1 text-xs">申込直後・前日・1時間前の案内を設定します。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline">
            <div className="flex items-center justify-between gap-4 px-4 py-4"><div><dt className="text-ink text-sm font-medium">申込完了</dt><dd className="text-ink-faint mt-1 text-xs">申込完了直後に案内を送信</dd></div><NotificationStateBadge state={registrationState} /></div>
            <div className="flex items-center justify-between gap-4 px-4 py-4"><div><dt className="text-ink text-sm font-medium">開催前日</dt><dd className="text-ink-faint mt-1 text-xs">LINEでリマインド</dd></div><NotificationStateBadge state={dayBeforeState} /></div>
          </dl>
        </section>
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card">
          <h2 className="text-ink text-base font-bold">当日・見逃し案内</h2>
          <p className="text-ink-faint mt-1 text-xs">開始前・開始時・未視聴者・見終わった人への案内を設定します。</p>
          <dl className="divide-hairline mt-4 divide-y rounded-control border border-hairline">
            <div className="px-4 py-4"><dt className="text-ink text-sm font-medium">配信タイミング</dt><dd className="text-ink-faint mt-1 text-xs">{deliveryTimingSummary(settings, settingsReady, settingsFailed)}</dd></div>
            <div className="px-4 py-4"><dt className="text-ink text-sm font-medium">見逃し案内</dt><dd className="text-ink-faint mt-1 text-xs">{missedNoticeSummary(settings, settingsReady, settingsFailed)}</dd></div>
            <div className="px-4 py-4"><dt className="text-ink text-sm font-medium">視聴完了のお礼</dt><dd className="text-ink-faint mt-1 text-xs">{completedNoticeSummary(settings, settingsReady, settingsFailed)}</dd></div>
          </dl>
        </section>
        {settingsFailed && (
          <Notice
            tone="danger"
            action={(
              <button
                type="button"
                onClick={() => { setSettingsReady(false); setSettingsFailed(false); setNotifAttempt((count) => count + 1) }}
                className="font-medium underline"
              >
                もう一度読み込む
              </button>
            )}
          >
            通知の設定を読み込めませんでした。
          </Notice>
        )}
        <EditorDetails label="通知ごとの送信設定を編集する"><WebinarNotifications key={notifAttempt} webinarId={webinarId} onLoaded={handleNotificationsLoaded} onDirtyChange={onDirtyChange} registerSave={registerSave} /></EditorDetails>
      </div>
      <SummaryAside rows={[
        ['申込完了', NOTIFICATION_ROW_STATE[registrationState].label],
        ['リマインド', reminderState === 'configured' ? 'リマインド中' : NOTIFICATION_ROW_STATE[reminderState].label],
        ['開始時', NOTIFICATION_ROW_STATE[startState].label],
        ['見逃し案内', NOTIFICATION_ROW_STATE[missedState].label],
        ['視聴完了', NOTIFICATION_ROW_STATE[completedState].label],
        ['対象', registrations === null ? '—（未取得）' : `${formatNumber(registrations)}人`],
      ]} previewBody={editor?.notificationMessages.registration || notificationPreview(null).empty}>
        <div className="flex gap-2"><Button disabled={testing || notificationTestDone || testDisabledReason !== null} title={notificationTestDone ? 'テスト済みです' : testDisabledReason ?? undefined} onClick={() => setTestConfirmOpen(true)} busy={testing} busyLabel="送信中…">{notificationTestDone ? 'テスト送信済み' : 'テストを送る'}</Button>{canOpenPublicPage && publicUrl ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}</div>
        {testResult ? <p className="text-ink-secondary text-xs" role="status">{testResult}</p> : null}
        {!(canOpenPublicPage && publicUrl) && publicPageReason ? <p className="text-ink-faint text-xs">{publicPageReason}</p> : null}
      </SummaryAside>
      {/* 相手と文面を確認してから実送信する。申込者全員には届かない。 */}
      <ConfirmDialog
        open={testConfirmOpen}
        title="通知をテスト送信しますか？"
        description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。"
        confirmLabel="テストを送る"
        busy={testing}
        onCancel={() => { if (!testing) setTestConfirmOpen(false) }}
        onConfirm={() => void runNotificationTest()}
      >
        <p className="text-ink-secondary text-xs">送る文面（開始のお知らせ）：「{webinarTitle}」が始まりました、という案内に参加URLを添えて送ります。</p>
      </ConfirmDialog>
    </div>
  )
}
