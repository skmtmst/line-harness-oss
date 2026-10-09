'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import WebinarEditV8 from '@/v8/webinar-edit/edit'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><WebinarEditV8 /></Suspense>
}

import VideoMediaLabel from '@/v8/webinar-edit/video-media-label'
import { CheckCircle2, Circle, LoaderCircle, TriangleAlert } from 'lucide-react'
import { type WebinarNotificationSettings } from '@/lib/api'

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

export default Object.assign(Page, { __testing: { NOTIFICATION_ROW_STATE, NotificationStateBadge, VideoMediaLabel, notificationRowState, deliveryTimingSummary, missedNoticeSummary, completedNoticeSummary } })
