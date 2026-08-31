'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bell, CalendarClock, CheckCircle2, Clock3, Eye, EyeOff, Play, Send, UserCheck } from 'lucide-react'

import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import {
  webinarApi,
  type Webinar,
  type WebinarNotificationOverview,
  type WebinarNotificationSettingsInput,
} from '@/lib/api'

const DEFAULT_SETTINGS: WebinarNotificationSettingsInput = {
  registrationEnabled: true,
  dayBeforeEnabled: true,
  dayBeforeTime: '20:00',
  hourBeforeEnabled: true,
  hourBeforeMinutes: 60,
  startEnabled: true,
  missedEnabled: true,
  missedTime: '10:00',
  completedEnabled: true,
}

const EMPTY_OVERVIEW: WebinarNotificationOverview = {
  total: 0,
  pending: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
  audience: { people: 0, bookings: 0, definition: 'active_registrations' },
}

function SettingRow({
  icon: Icon,
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  icon: typeof Bell
  title: string
  description: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border-hairline border bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="bg-accent-soft text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-ink text-sm font-semibold">{title}</p>
          <p className="text-ink-faint mt-1 text-xs leading-5">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pl-12 sm:pl-0">
        {children}
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-secondary">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          {enabled ? '送ります' : '送りません'}
        </label>
      </div>
    </div>
  )
}

export default function WebinarNotifications({
  webinar,
  publicUrl,
}: {
  webinar: Webinar
  publicUrl: string | null
}) {
  const [settings, setSettings] = useState<WebinarNotificationSettingsInput>(DEFAULT_SETTINGS)
  const [overview, setOverview] = useState<WebinarNotificationOverview>(EMPTY_OVERVIEW)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [hasSavedSettings, setHasSavedSettings] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const response = await webinarApi.notifications(webinar.id)
      const saved = response.data.settings
      if (saved) {
        setSettings({
          registrationEnabled: saved.registrationEnabled,
          dayBeforeEnabled: saved.dayBeforeEnabled,
          dayBeforeTime: saved.dayBeforeTime,
          hourBeforeEnabled: saved.hourBeforeEnabled,
          hourBeforeMinutes: saved.hourBeforeMinutes,
          startEnabled: saved.startEnabled,
          missedEnabled: saved.missedEnabled,
          missedTime: saved.missedTime,
          completedEnabled: saved.completedEnabled,
        })
        setHasSavedSettings(true)
      } else {
        setSettings(DEFAULT_SETTINGS)
        setHasSavedSettings(false)
      }
      setOverview(response.data.overview)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [webinar.id])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      const response = await webinarApi.saveNotifications(webinar.id, settings)
      setHasSavedSettings(true)
      setNotice({
        tone: 'success',
        message: response.data.queued > 0
          ? `通知設定を保存し、${response.data.queued}件の送信予定を作りました。`
          : '通知設定を保存しました。次の申込から送信予定を作ります。',
      })
      await load()
    } catch {
      setNotice({ tone: 'error', message: '通知設定を保存できませんでした。時間を置いてもう一度お試しください。' })
    } finally {
      setSaving(false)
    }
  }

  const testSend = async () => {
    setTesting(true)
    setNotice(null)
    try {
      const response = await webinarApi.testNotifications(webinar.id)
      setNotice({
        tone: response.data.failed > 0 ? 'error' : 'success',
        message: response.data.failed > 0
          ? `${response.data.sent}人へ送信し、${response.data.failed}人には送れませんでした。`
          : `${response.data.sent}人へ通知イメージをテスト送信しました。`,
      })
    } catch {
      setNotice({
        tone: 'error',
        message: 'テスト送信できませんでした。「設定 → LINEアカウント」のテスト送信先をご確認ください。',
      })
    } finally {
      setTesting(false)
    }
  }

  const enabledCount = useMemo(
    () => Object.entries(settings).filter(([key, value]) => key.endsWith('Enabled') && value).length,
    [settings],
  )

  if (loading) {
    return <ListState kind="loading" title="通知設定を読み込んでいます" />
  }
  if (loadError) {
    return (
      <ListState
        kind="error"
        title="通知設定を読み込めませんでした"
        description="設定は変更されていません。通信状態を確認して、もう一度読み込んでください。"
        action={<Button onClick={() => void load()}>通知設定を再読み込み</Button>}
      />
    )
  }

  return (
    <div data-design-node="Ho8z4" className="space-y-4">
      {notice ? <Notice tone={notice.tone} message={notice.message} onClose={() => setNotice(null)} /> : null}
      {!hasSavedSettings ? (
        <Notice
          tone="validation"
          message="まだ保存されていません。表示中の内容を確認し、下のボタンで通知を有効にしてください。"
        />
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <section className="rounded-card border-hairline border bg-canvas p-4 shadow-sm">
            <h2 className="text-ink text-base font-bold">事前案内</h2>
            <p className="text-ink-faint mt-1 text-xs">申込直後・前日・1時間前の案内を設定します。</p>
            <div className="mt-4 space-y-3">
              <SettingRow
                icon={UserCheck}
                title="申込直後の受付確認"
                description="予約した回と専用の入場リンクを、その場で1回だけ送ります。"
                enabled={settings.registrationEnabled}
                onToggle={(registrationEnabled) => setSettings((current) => ({ ...current, registrationEnabled }))}
              />
              <SettingRow
                icon={CalendarClock}
                title="前日の案内"
                description="開催前日に、予約した回と入場リンクを送ります。"
                enabled={settings.dayBeforeEnabled}
                onToggle={(dayBeforeEnabled) => setSettings((current) => ({ ...current, dayBeforeEnabled }))}
              >
                <input
                  type="time"
                  value={settings.dayBeforeTime}
                  disabled={!settings.dayBeforeEnabled}
                  onChange={(event) => setSettings((current) => ({ ...current, dayBeforeTime: event.target.value }))}
                  aria-label="前日の送信時刻"
                  className="w-28 rounded-control border border-hairline px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-accent"
                />
              </SettingRow>
              <SettingRow
                icon={Clock3}
                title="開始前の案内"
                description="予約した回の開始前に、専用の入場リンクを送ります。"
                enabled={settings.hourBeforeEnabled}
                onToggle={(hourBeforeEnabled) => setSettings((current) => ({ ...current, hourBeforeEnabled }))}
              >
                <select
                  value={settings.hourBeforeMinutes}
                  disabled={!settings.hourBeforeEnabled}
                  onChange={(event) => setSettings((current) => ({ ...current, hourBeforeMinutes: Number(event.target.value) }))}
                  aria-label="開始前の送信時刻"
                  className="v6-select w-32"
                >
                  <option value={30}>30分前</option>
                  <option value={60}>1時間前</option>
                  <option value={180}>3時間前</option>
                </select>
              </SettingRow>
            </div>
          </section>

          <section className="rounded-card border-hairline border bg-canvas p-4 shadow-sm">
            <h2 className="text-ink text-base font-bold">当日・見逃し案内</h2>
            <p className="text-ink-faint mt-1 text-xs">開始時、未視聴、視聴完了の案内を設定します。</p>
            <div className="mt-4 space-y-3">
              <SettingRow
                icon={Play}
                title="開始時の案内"
                description="予約した回が始まった時点で、専用の入場リンクを送ります。"
                enabled={settings.startEnabled}
                onToggle={(startEnabled) => setSettings((current) => ({ ...current, startEnabled }))}
              />
              <SettingRow
                icon={EyeOff}
                title="見逃し案内"
                description="予約した回を見なかった人だけに、翌日もう一度案内します。"
                enabled={settings.missedEnabled}
                onToggle={(missedEnabled) => setSettings((current) => ({ ...current, missedEnabled }))}
              >
                <input
                  type="time"
                  value={settings.missedTime}
                  disabled={!settings.missedEnabled}
                  onChange={(event) => setSettings((current) => ({ ...current, missedTime: event.target.value }))}
                  aria-label="見逃し案内の送信時刻"
                  className="w-28 rounded-control border border-hairline px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-accent"
                />
              </SettingRow>
              <SettingRow
                icon={CheckCircle2}
                title="視聴完了のお礼"
                description="動画を90%以上見た人へ、お礼と再視聴リンクを1回だけ送ります。"
                enabled={settings.completedEnabled}
                onToggle={(completedEnabled) => setSettings((current) => ({ ...current, completedEnabled }))}
              />
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="rounded-card border-hairline border bg-canvas p-4 shadow-sm">
            <h2 className="text-ink text-sm font-bold">設定サマリー</h2>
            <dl className="mt-4 divide-y divide-hairline text-sm">
              <div className="flex justify-between gap-4 py-3"><dt className="text-ink-faint">通知</dt><dd className="text-ink font-semibold">{enabledCount}種類</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-ink-faint">送信待ち</dt><dd className="text-ink font-semibold tabular-nums">{overview.pending}件</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-ink-faint">送信済み</dt><dd className="text-ink font-semibold tabular-nums">{overview.sent}件</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-ink-faint">送れなかったもの</dt><dd className={overview.failed > 0 ? 'text-danger font-semibold tabular-nums' : 'text-ink font-semibold tabular-nums'}>{overview.failed}件</dd></div>
            </dl>
            <p className="text-ink-faint mt-3 text-xs leading-5">日程を選び直したときは、前の回の未送信予定を取り消し、新しい回へ作り直します。</p>
          </section>
          <section className="rounded-card bg-action p-4 text-on-action shadow-sm">
            <h2 className="text-center text-sm font-bold">LINEプレビュー</h2>
            <div className="mt-4 rounded-card bg-canvas p-4 text-sm leading-6 text-ink">
              「{webinar.title}」の開始時刻が近づいたら、予約した回と専用リンクをお送りします。
            </div>
          </section>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void testSend()} disabled={testing || !webinar.accountId}>
              <Send size={16} aria-hidden="true" />
              {testing ? 'テスト送信中' : 'テスト送信'}
            </Button>
            {publicUrl ? (
              <Button href={publicUrl} target="_blank" rel="noreferrer">
                <Eye size={16} aria-hidden="true" />
                公開ページを見る
              </Button>
            ) : (
              <Button disabled title="公開ページを確認するには、公開状態とLIFF設定をご確認ください。">
                <Eye size={16} aria-hidden="true" />
                公開ページを見る
              </Button>
            )}
          </div>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 flex justify-center border-t border-hairline bg-canvas p-4 shadow-v6-card">
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? '通知設定を保存中' : '通知設定を保存'}
        </Button>
      </div>
    </div>
  )
}
