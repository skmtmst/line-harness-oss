'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  webinarApi,
  type WebinarNotificationOverview,
  type WebinarNotificationSettings,
  type WebinarNotificationSettingsInput,
} from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'

/**
 * ウェビナーの通知・リマインド（設計 `Ho8z4` 10-1-D）。
 *
 * **5 つの通知はそれぞれ別の目的を持つ。** まとめて「通知する／しない」に
 * すると、申込のお礼だけ止めたいときに前日・当日まで止まる。1 つずつ切る。
 *
 * **送った結果を数で出す。** 設定だけ見ても、実際に届いたかは分からない。
 * 待ち・送信済み・失敗・見送り・取消を分けて出す——「失敗 0 件」と
 * 「まだ数えていない」を混ぜない。
 */

/** 数を出してよいのは読めたときだけ。**読めていないものを 0 と書かない。** */
function countText(value: number | undefined, available: boolean): string {
  return available && typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('ja-JP')
    : '—'
}

const HOUR_OPTIONS = [15, 30, 60, 120].map((m) => ({
  value: String(m),
  label: m < 60 ? `${m}分前` : `${m / 60}時間前`,
}))

export default function WebinarNotifications({ webinarId }: { webinarId: string }) {
  const [settings, setSettings] = useState<WebinarNotificationSettings | null>(null)
  const [overview, setOverview] = useState<WebinarNotificationOverview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const res = await webinarApi.notifications(webinarId)
      /*
        **形が違う返事を、そのまま画面へ流さない。** 器だけ違うものが来ると
        `settings.dayBeforeTime` で落ち、この面が白い画面になる。
      */
      if (!res.data || typeof res.data !== 'object') throw new Error('shape')
      setSettings(res.data.settings)
      setOverview(res.data.overview ?? null)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [webinarId])

  useEffect(() => { void load() }, [load])

  const patch = (next: Partial<WebinarNotificationSettingsInput>) =>
    setSettings((prev) => (prev ? { ...prev, ...next } : prev))

  const save = async () => {
    if (!settings || saving) return
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const input: WebinarNotificationSettingsInput = {
        registrationEnabled: settings.registrationEnabled,
        dayBeforeEnabled: settings.dayBeforeEnabled,
        dayBeforeTime: settings.dayBeforeTime,
        hourBeforeEnabled: settings.hourBeforeEnabled,
        hourBeforeMinutes: settings.hourBeforeMinutes,
        startEnabled: settings.startEnabled,
        missedEnabled: settings.missedEnabled,
        missedTime: settings.missedTime,
        completedEnabled: settings.completedEnabled,
      }
      const res = await webinarApi.saveNotifications(webinarId, input)
      setSettings(res.data.settings)
      /* **何が起きたかを数で言う。** 「保存しました」だけでは、予定が
         積まれたのか取り消されたのか分からない。 */
      setNotice(`保存しました。${res.data.queued}件を予定に入れ、${res.data.cancelled}件を取り消しました。`)
      await load()
    } catch {
      setError('通知の設定を保存できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') return <ListState kind="loading" />
  if (state === 'error') {
    return (
      <ListState
        kind="error"
        title="通知の設定を読み込めませんでした"
        description="通信を確認して、もう一度読み込んでください。"
        action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
      />
    )
  }
  if (!settings) {
    return (
      <ListState
        kind="empty"
        title="通知の設定がまだありません"
        description="下の内容を決めて保存すると、申込・前日・開始前の通知が届くようになります。"
      />
    )
  }

  const rows: Array<{ key: string; label: string; note: string; on: boolean; toggle: () => void; extra?: React.ReactNode }> = [
    {
      key: 'registration',
      label: '申込のお礼',
      note: '申し込んだ直後に届きます。',
      on: settings.registrationEnabled,
      toggle: () => patch({ registrationEnabled: !settings.registrationEnabled }),
    },
    {
      key: 'dayBefore',
      label: '前日のご案内',
      note: '見られるようになる日の前日に届きます。',
      on: settings.dayBeforeEnabled,
      toggle: () => patch({ dayBeforeEnabled: !settings.dayBeforeEnabled }),
      extra: (
        <label className="text-ink-secondary flex items-center gap-2 text-xs">
          送る時刻
          <input
            type="time"
            value={settings.dayBeforeTime}
            onChange={(e) => patch({ dayBeforeTime: e.target.value })}
            className="border-hairline rounded-control border px-2 py-1 text-sm"
          />
        </label>
      ),
    },
    {
      key: 'hourBefore',
      label: '開始前のお知らせ',
      note: '始まる少し前に、参加URLをもう一度送ります。',
      on: settings.hourBeforeEnabled,
      toggle: () => patch({ hourBeforeEnabled: !settings.hourBeforeEnabled }),
      extra: (
        <Select
          aria-label="開始前のお知らせを送るタイミング"
          value={String(settings.hourBeforeMinutes)}
          onChange={(value) => patch({ hourBeforeMinutes: Number(value) })}
          options={HOUR_OPTIONS}
        />
      ),
    },
    {
      key: 'start',
      label: '開始のお知らせ',
      note: '見られるようになった時に届きます。',
      on: settings.startEnabled,
      toggle: () => patch({ startEnabled: !settings.startEnabled }),
    },
    {
      key: 'missed',
      label: '見逃した人への案内',
      note: '申し込んだのに見なかった人へ届きます。',
      on: settings.missedEnabled,
      toggle: () => patch({ missedEnabled: !settings.missedEnabled }),
      extra: (
        <label className="text-ink-secondary flex items-center gap-2 text-xs">
          送る時刻
          <input
            type="time"
            value={settings.missedTime}
            onChange={(e) => patch({ missedTime: e.target.value })}
            className="border-hairline rounded-control border px-2 py-1 text-sm"
          />
        </label>
      ),
    },
    {
      key: 'completed',
      label: '見終わった人へのお礼',
      note: '最後まで見た人へ届きます。',
      on: settings.completedEnabled,
      toggle: () => patch({ completedEnabled: !settings.completedEnabled }),
    },
  ]

  const available = overview !== null

  return (
    <section className="space-y-4" data-design-node="Ho8z4">
      <div>
        <h2 className="text-ink font-bold">通知・リマインド</h2>
        <p className="text-ink-faint mt-1 text-xs">
          申込から見終わったあとまで、届けるものを1つずつ決めます。切ったものは送りません。
        </p>
      </div>

      {/*
        送った結果。**設定だけ見ても、実際に届いたかは分からない。**
        待ち・送信済み・失敗・見送り・取消を分けて出す。
        読めていないときは `—`——「失敗 0 件」と「まだ数えていない」を混ぜない。
      */}
      <dl className="border-hairline grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-hairline sm:grid-cols-3">
        {[
          ['予定', overview?.pending],
          ['送信済み', overview?.sent],
          ['失敗', overview?.failed],
          ['見送り', overview?.skipped],
          ['取消', overview?.cancelled],
          ['合計', overview?.total],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-canvas px-4 py-3">
            <dt className="text-ink-faint text-xs">{String(label)}</dt>
            <dd className="text-ink mt-1 text-lg font-bold tabular-nums">
              {countText(value as number | undefined, available)}
              {available && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
            </dd>
          </div>
        ))}
      </dl>
      {!available && (
        <p className="text-ink-faint text-xs">送った結果はまだ読めていません。—（未取得）</p>
      )}

      <ul className="border-hairline divide-hairline divide-y overflow-hidden rounded-xl border">
        {rows.map((row) => (
          <li key={row.key} className="bg-canvas flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <label className="flex min-w-0 flex-1 items-start gap-3">
              <input
                type="checkbox"
                checked={row.on}
                onChange={row.toggle}
                aria-label={`${row.label}を送る`}
                className="accent-accent mt-0.5"
              />
              <span className="min-w-0">
                <span className="text-ink block text-sm font-semibold">{row.label}</span>
                <span className="text-ink-faint block text-xs">{row.note}</span>
              </span>
            </label>
            {/* 切っているものの細かい設定は出さない。押しても効かない欄を並べない。 */}
            {row.on && row.extra ? <div className="shrink-0">{row.extra}</div> : null}
          </li>
        ))}
      </ul>

      {notice && <p className="bg-success-bg text-success rounded-card px-4 py-3 text-sm">{notice}</p>}
      {error && <p className="bg-danger-bg text-danger rounded-card px-4 py-3 text-sm">{error}</p>}

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '通知の設定を保存'}
        </Button>
      </div>
    </section>
  )
}
