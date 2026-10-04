'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  webinarApi,
  type WebinarNotificationOverview,
  type WebinarNotificationSettings,
  type WebinarNotificationSettingsInput,
} from '@/lib/api'
import Button from '@/components/shared/button'
import Toggle from '@/components/shared/toggle'
import HelpTip from '@/components/shared/help-tip'
import Disclosure from '@/components/shared/disclosure'
import './webinar-notifications.css'
import { TimeField } from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { audienceText } from '@/app/webinars/overview-view'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import { formatNumber } from '@/lib/format'

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
    ? formatNumber(value)
    : '—'
}

const HOUR_OPTIONS = [15, 30, 60, 120].map((m) => ({
  value: String(m),
  label: m < 60 ? `${m}分前` : `${m / 60}時間前`,
}))

/*
  未保存の判定に使う欄。サーバーへ送る入力と同じセットで比べる——
  画面にだけある値で「未保存」と出さない。
*/
const SETTINGS_KEYS = [
  'registrationEnabled', 'dayBeforeEnabled', 'dayBeforeTime',
  'hourBeforeEnabled', 'hourBeforeMinutes', 'startEnabled',
  'missedEnabled', 'missedTime', 'missedWindowDays', 'completedEnabled',
] as const

const MISSED_WINDOW_OPTIONS = Array.from({ length: 30 }, (_, index) => ({
  value: String(index + 1),
  label: `${index + 1}日`,
}))

/**
 * まだ保存されていないウェビナーの編集開始値（WEBINAR-09）。
 *
 * **全部切った状態で始める。** 未設定なのに勝手にONへしてしまうと、
 * 気づかないうちに通知が出る。届けたいものだけを本人が選ぶ。
 * 時刻・分はサーバーが受け付ける既定値（保存でそのまま通る値）にする。
 */
const emptySettings = (webinarId: string): WebinarNotificationSettings => ({
  webinarId,
  version: 0,
  registrationEnabled: false,
  dayBeforeEnabled: false,
  dayBeforeTime: '18:00',
  hourBeforeEnabled: false,
  hourBeforeMinutes: 60,
  startEnabled: false,
  missedEnabled: false,
  missedTime: '20:00',
  missedWindowDays: 7,
  completedEnabled: false,
  updatedAt: '',
})

export default function WebinarNotifications({ webinarId, onLoaded, onDirtyChange, registerSave }: {
  webinarId: string
  /*
    親の概要段と子の編集タブで同じ口を2回叩かない。取得はここに一本化し、
    親は報告を受けて概要だけ描く。保存後の取り直しもここが行い、親へ流す。
  */
  onLoaded?: (data: { settings: WebinarNotificationSettings | null; overview: WebinarNotificationOverview | null } | null) => void
  /** 保存していない変更があるかを親へ伝える（段の固定バーが未保存を出すため）。 */
  onDirtyChange?: (dirty: boolean) => void
  /** 親の固定バーから保存を呼べるようにする。true のときだけ保存が完了。 */
  registerSave?: (save: (() => Promise<boolean>) | null) => void
}) {
  const [settings, setSettings] = useState<WebinarNotificationSettings | null>(null)
  /* 最後に読めた・保存できた設定。ここと違う入力が「未保存」。 */
  const [baseline, setBaseline] = useState<WebinarNotificationSettings | null>(null)
  const [overview, setOverview] = useState<WebinarNotificationOverview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const requestGeneration = useRef(0)
  const saveLock = useRef(false)
  const load = useCallback(async () => {
    const request = ++requestGeneration.current
    setState('loading')
    setError('')
    try {
      const res = await webinarApi.notifications(webinarId)
      /*
        **形が違う返事を、そのまま画面へ流さない。** 器だけ違うものが来ると
        `settings.dayBeforeTime` で落ち、この面が白い画面になる。
      */
      if (!res.data || typeof res.data !== 'object') throw new Error('shape')
      if (request !== requestGeneration.current) return
      setSettings(res.data.settings)
      setBaseline(res.data.settings)
      setOverview(res.data.overview ?? null)
      setState('ready')
      onLoaded?.({ settings: res.data.settings, overview: res.data.overview ?? null })
    } catch {
      if (request !== requestGeneration.current) return
      setState('error')
      onLoaded?.(null)
    }
  }, [webinarId, onLoaded])

  useEffect(() => { void load(); return () => { requestGeneration.current += 1 } }, [load])

  const patch = (next: Partial<WebinarNotificationSettingsInput>) =>
    setSettings((prev) => (prev ? { ...prev, ...next } : prev))

  /*
    段を行き来しても入力は残る（親が面を畳まない）。残っている入力が
    保存済みと違うかどうかを親の固定バーへ伝える。
  */
  const dirty = settings !== null && baseline !== null &&
    (baseline.version === 0 || SETTINGS_KEYS.some((key) => settings[key] !== baseline[key]))
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  /** 保存が完了したら true。失敗したら入力を残したまま false を返す。 */
  const save = async (): Promise<boolean> => {
    if (!settings || saveLock.current) return false
    saveLock.current = true
    setSaving(true)
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
        missedWindowDays: settings.missedWindowDays ?? 7,
        completedEnabled: settings.completedEnabled,
      }
      const res = await webinarApi.saveNotifications(webinarId, input)
      setSettings(res.data.settings)
      setBaseline(res.data.settings)
      /* **何が起きたかを数で言う。** 「保存しました」だけでは、予定が
         積まれたのか取り消されたのか分からない。 */
      notifyToast(`保存しました。${res.data.queued}件を予定に入れ、${res.data.cancelled}件を取り消しました。`)
      await load()
      return true
    } catch {
      setError('通知の設定を保存できませんでした。入力を残しました。もう一度お試しください。')
      return false
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  /* 親の固定バーから呼べるよう、いちばん新しい保存操作を登録する。 */
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    if (!registerSave) return
    registerSave(() => saveRef.current())
    return () => registerSave(null)
  }, [registerSave])

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
  /*
   * 正常な「まだ設定が無い」と取得失敗は分けてある（上の error 分岐）。
   * ここは取得に成功したうえで設定行が無い場合。入力欄の無い空状態だけを
   * 返すと新規ウェビナーから通知設定を始められないので、明示的な入口を
   * 置く。押したら全OFFの初期値で編集に入る——勝手に通知を有効化しない。
   */
  if (!settings) {
    return (
      <ListState
        kind="empty"
        title="通知の設定がまだありません"
        description="届けるものを決めて保存すると、申込・前日・開始前の通知が届くようになります。最初は全部オフの状態から始めます。"
        action={(
          <Button
            onClick={() => {
              const initial = emptySettings(webinarId)
              setSettings(initial)
              setBaseline(initial)
              setError('')
            }}
          >
            通知の設定を入力する
          </Button>
        )}
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
        <span className="text-ink-secondary flex items-center gap-2 text-xs">
          送る時刻
          <TimeField
            value={settings.dayBeforeTime}
            onChange={(v) => patch({ dayBeforeTime: v })}
            aria-label="前日のご案内を送る時刻"
          />
        </span>
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
      note: '申し込んだのに見なかった人へ届きます。期限を過ぎたら送りません。',
      on: settings.missedEnabled,
      toggle: () => patch({ missedEnabled: !settings.missedEnabled }),
      extra: (
        <span className="text-ink-secondary flex flex-wrap items-center gap-2 text-xs">
          送る時刻
          <TimeField
            value={settings.missedTime}
            onChange={(v) => patch({ missedTime: v })}
            aria-label="見逃した人への案内を送る時刻"
          />
          期限
          <Select
            aria-label="見逃した人への案内の期限（開催からの日数）"
            value={String(settings.missedWindowDays ?? 7)}
            onChange={(value) => patch({ missedWindowDays: Number(value) })}
            options={MISSED_WINDOW_OPTIONS}
          />
        </span>
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
  const audience = audienceText(overview?.audience)

  return (
    <section className="space-y-4" data-webinar-notifications="true">
      <div>
        <h2 className="text-ink font-bold">通知とリマインド <HelpTip label="通知とリマインドの説明">LINEで送るお知らせです。通知ごとに送るかどうかと時刻を決めます。</HelpTip></h2>
      </div>

      {/*
        送った結果。**設定だけ見ても、実際に届いたかは分からない。**
        待ち・送信済み・失敗・見送り・取消を分けて出す。
        読めていないときは `—`——「失敗 0 件」と「まだ数えていない」を混ぜない。
      */}
      <dl className="flex gap-5">
        {[
          ['送った', overview?.sent],
          ['届かなかった', overview?.failed],
          ['見送り', overview?.skipped],
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
      {/*
        見送りの内訳（#745）。**数だけ出しても、取るべき行動が決まらない。**
        「すでに視聴済み」は正常だが、「対象回が終了済み」は届かないまま
        終わったということで、運用者が気づく必要がある。
        0 件のときは出さない——常に空の枠があると、誰も見なくなる。
      */}
      {available && (overview?.skippedReasons?.length ?? 0) > 0 && (
        <div className="border-hairline rounded-card border p-4" data-testid="webinar-skip-reasons">
          <p className="text-ink text-xs font-medium">見送りの内訳</p>
          <ul className="mt-2 space-y-1">
            {overview!.skippedReasons.map((reason) => (
              <li key={reason.code ?? 'unknown'} className="text-ink-secondary flex justify-between gap-4 text-xs">
                <span>{reason.label}</span>
                <span className="text-ink font-bold tabular-nums">{formatNumber(reason.count)}件</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!available && (
        <p className="text-ink-faint text-xs">送った結果はまだ読めていません。—（未取得）</p>
      )}

      <Disclosure title="その他の送信実績と通知の対象" size="compact"><p className="text-ink-secondary text-xs">予定 {countText(overview?.pending, available)}件・取消 {countText(overview?.cancelled, available)}件・合計 {countText(overview?.total, available)}件</p><p className="text-ink-secondary text-xs">通知の対象：{audience.people}<HelpTip label="通知の対象の説明">{audience.note}</HelpTip></p></Disclosure>
      <fieldset disabled={saving} className="min-w-0">
        <ul className="divide-hairline divide-y">
          {rows.map((row) => (
            <li key={row.key} data-notification-row="true">
              <span className="text-ink flex items-center gap-1 text-sm font-semibold">{row.label}<HelpTip label={`${row.label}の説明`}>{row.note}</HelpTip></span>
              <div className="text-ink-secondary min-w-0 text-xs">{row.extra ?? (row.key === 'registration' ? '申し込んだらすぐ' : row.key === 'start' ? '開始したとき' : '見終わったら')}</div>
              <Toggle checked={row.on} onChange={row.toggle} label={row.label} />
            </li>
          ))}
        </ul>
      </fieldset>

      {error && <Notice tone="danger">{error}</Notice>}

      {!registerSave ? <div className="flex justify-end"><Button onClick={() => void save()} disabled={saving} busy={saving}>通知の設定を保存する</Button></div> : null}
    </section>
  )
}
